"""Real browser integration tests. No mocked GPU, scene compiler, or file decoder.

Requires Python Playwright and a WebGPU-capable Chromium. The --software switch
explicitly opts into SwiftShader for correctness testing, not performance claims.
"""
from __future__ import annotations
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://localhost:4173')
parser.add_argument('--browser', default=os.environ.get('CHROMIUM_PATH'))
parser.add_argument('--headed', action='store_true')
parser.add_argument('--software', action='store_true')
parser.add_argument('--output', default=str(ROOT / 'test-results'))
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
server = None
try:
    urllib.request.urlopen(args.url, timeout=2).close()
except OSError:
    server = subprocess.Popen(['node', 'scripts/serve.mjs'], cwd=ROOT, stdout=subprocess.DEVNULL)
    time.sleep(1)

report = {'started': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'softwareAdapterRequested': args.software, 'checks': [], 'errors': []}

def check(name, condition=True, details=None):
    assert condition, name
    report['checks'].append({'name': name, 'passed': True, 'details': details})
    print('PASS', name, flush=True)

try:
    with sync_playwright() as p:
        flags = ['--no-sandbox', '--enable-unsafe-webgpu']
        if args.software:
            flags += ['--use-angle=swiftshader', '--enable-features=Vulkan', '--disable-vulkan-surface', '--use-vulkan=swiftshader']
        browser = p.chromium.launch(headless=not args.headed, args=flags, **({'executable_path': args.browser} if args.browser else {}))
        report['browserVersion'] = browser.version
        context = browser.new_context(viewport={'width': 1536, 'height': 1024}, device_scale_factor=1, accept_downloads=True)
        page = context.new_page()
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto(args.url)
        page.wait_for_function('window.aureon?.ready', timeout=45000)
        check('Native WebGPU initialization and all WGSL pipelines', page.evaluate('aureon.gpuReady'))
        def settled():
            page.wait_for_function('aureon.compiled && aureon.builtRevision === aureon.revision && !aureon.building && !aureon.needsBuild && !aureon.renderer.busy', timeout=45000)
        def check_presentation(name):
            # Queue completion alone does not prove the canvas reached the compositor.
            page.wait_for_function('aureon.renderer.colorTexture && aureon.renderer.scene && !aureon.renderer.busy && !aureon.dirty && aureon.renderer.scene.triangles.length === aureon.compiled.triangles.length', timeout=45000)
            page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            reference = page.evaluate('''async()=>{
                const image=await aureon.renderer.capturePNG();
                return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(image);});
            }''')
            screenshot = page.locator('#gpu-canvas').screenshot(path=str(out / (name + '-canvas.png')))
            metrics = page.evaluate('''async({reference,presented})=>{
                const read=async url=>{
                    const image=await createImageBitmap(await (await fetch(url)).blob());
                    const c=new OffscreenCanvas(64,64),ctx=c.getContext('2d');
                    // The central image excludes viewport labels and corner overlays.
                    ctx.drawImage(image,image.width*.12,image.height*.2,image.width*.76,image.height*.6,0,0,64,64);
                    const data=ctx.getImageData(0,0,64,64).data;image.close();return data;
                };
                const [a,b]=await Promise.all([read(reference),read(presented)]);
                let error=0,mean=0,second=0,n=0;
                for(let i=0;i<a.length;i++)if(i%4!==3){const v=a[i]/255;error+=Math.abs(a[i]-b[i])/255;mean+=v;second+=v*v;n++;}
                mean/=n;return {meanAbsoluteError:error/n,referenceMean:mean,referenceVariance:second/n-mean*mean};
            }''', {'reference': reference, 'presented': 'data:image/png;base64,' + base64.b64encode(screenshot).decode()})
            check(name + ' canvas presentation matches retained GPU pixels', metrics['meanAbsoluteError'] < .08 and metrics['referenceVariance'] > .002, metrics)
        def command(menu, name):
            page.locator(f'[data-menu="{menu}"]').click()
            page.locator(f'#menu-popup [data-command="{name}"]').click()
        def field(name, value):
            locator = page.locator(f'[data-field="{name}"]')
            locator.fill(str(value))
            locator.press('Tab')
        settled()
        report['adapter'] = page.evaluate('({vendor:aureon.renderer.info.vendor,architecture:aureon.renderer.info.architecture,description:aureon.renderer.info.description})')
        check('Demo compiles and renders 8,138 real triangles', page.evaluate('aureon.compiled.triangles.length/32') == 8138)
        check_presentation('Modeling')
        page.screenshot(path=str(out / 'modeling.png'), full_page=True)

        # Create with an actual UI button, inspect its numeric transform, undo/redo.
        page.locator('[data-primitive="box"]').click()
        settled()
        box_id = page.evaluate('aureon.activeObject.id')
        check('Primitive creation through the UI', page.evaluate('aureon.doc.objects.length === 11 && aureon.activeObject.type === "box"'))
        field('object.name', 'Workflow box')
        field('object.position.0', 3)
        settled()
        check('Inspector transform edits reach the compiled scene', page.evaluate('aureon.activeObject.position[0] === 3'))
        check('Transform edit uses BVH refitting', page.evaluate('aureon.compiled.updateKind === "refit"'))
        page.locator('#edit-tools [data-command="undo"]').click()
        settled()
        check('Undo restores the canonical transform', page.evaluate('aureon.activeObject.position[0] === 0'))
        page.locator('#edit-tools [data-command="redo"]').click()
        settled()
        check('Redo restores the edited transform', page.evaluate('aureon.activeObject.position[0] === 3'))

        # Non-destructive stack and reorder.
        page.locator('#modifier-select').select_option('subdivide')
        page.locator('#modifier-select').select_option('twist')
        settled()
        check('Two modifiers evaluate without mutating primitive parameters', page.evaluate('aureon.activeObject.type === "box" && aureon.activeObject.modifiers.length === 2 && aureon.geometry.get(aureon.activeObject).faces.length === 24'))
        page.locator('[data-mod-up="1"]').click()
        settled()
        check('Modifier reordering changes the actual stack', page.evaluate('aureon.activeObject.modifiers[0].type === "twist"'))
        command('Model', 'collapseStack')
        settled()
        check('Collapse bakes evaluated polygon geometry', page.evaluate('aureon.activeObject.type === "mesh" && aureon.activeObject.modifiers.length === 0'))

        # A viewport ray selects a visible polygon on the isolated framed object.
        page.locator('#fit-button').click()
        page.locator('#selection-mode').select_option('face')
        page.locator('[data-tool="select"]').click()
        box = page.locator('#gpu-canvas').bounding_box()
        page.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2)
        check('Viewport ray picking selects a real polygon', page.evaluate('aureon.selectedFace >= 0 && aureon.activeObject.name === "Workflow box"'))
        faces_before = page.evaluate('aureon.geometry.get(aureon.activeObject).faces.length')
        command('Model', 'extrude')
        page.locator('#polygon-value').fill('0.4')
        page.locator('#dialog-apply').click()
        settled()
        check('Polygon extrusion creates connected side faces', page.evaluate('aureon.geometry.get(aureon.activeObject).faces.length') > faces_before)
        command('Model', 'inset')
        page.locator('#polygon-value').fill('0.2')
        page.locator('#dialog-apply').click()
        settled()
        check('Polygon inset adds an actual face ring', page.evaluate('aureon.geometry.get(aureon.activeObject).faces.length') > faces_before + 4)

        # UV projection plus dragging an actual UV coordinate.
        command('Model', 'uvEditor')
        page.locator('[data-project="xy"]').click()
        canvas = page.locator('.uv-surface').bounding_box()
        # First projected coordinate; mirrored editor formula is part of its documented coordinate system.
        uv = page.evaluate('async()=>{const {planarUV,cloneMesh}=await import("./src/geometry/mesh.js");return planarUV(cloneMesh(aureon.geometry.get(aureon.activeObject)),[0,1]).uvs.slice(0,2)}')
        px = canvas['x']+(80+uv[0]*540)*canvas['width']/720
        py = canvas['y']+(450-uv[1]*400)*canvas['height']/500
        page.mouse.move(px, py)
        page.mouse.down()
        page.mouse.move(px+17, py-11, steps=4)
        page.mouse.up()
        page.locator('#dialog-apply').click()
        settled()
        check('UV editor applies projected and edited mesh coordinates', page.evaluate('aureon.activeObject.mesh.uvs.length === aureon.activeObject.mesh.positions.length/3*2'))

        # Material assignment / procedural material parameters.
        page.locator('[data-material="4"]').click()
        page.locator('[data-field="material.pattern"]').select_option('checker')
        settled()
        check('Material library assignment and procedural pattern edits', page.evaluate('aureon.activeObject.material === 4 && aureon.doc.materials[4].pattern === "checker"'))

        # Drag a translation handle and test transaction rollback.
        page.locator('#selection-mode').select_option('object')
        page.locator('[data-tool="move"]').click()
        before = page.evaluate('aureon.activeObject.position[0]')
        h = page.locator('#gizmo [data-axis="x"]').evaluate('(e)=>({x1:+e.getAttribute("x1"),y1:+e.getAttribute("y1"),x2:+e.getAttribute("x2"),y2:+e.getAttribute("y2")})')
        viewport = page.locator('#viewport').bounding_box()
        x = viewport['x']+h['x1']*.25+h['x2']*.75
        y = viewport['y']+h['y1']*.25+h['y2']*.75
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+35,y,steps=5);page.mouse.up()
        settled()
        check('Interactive gizmo commits a real object transform', abs(page.evaluate('aureon.activeObject.position[0]')-before) > .01)
        page.locator('#edit-tools [data-command="undo"]').click()
        settled()
        check('Gizmo drag is one undoable transaction', abs(page.evaluate('aureon.activeObject.position[0]')-before) < 1e-8)

        # Keyframing and actual interpolation, plus curve dialog.
        page.locator('[data-tab="object"]').click()
        page.locator('#set-key').click()
        page.locator('#frame-number').fill('60');page.locator('#frame-number').press('Tab')
        field('object.position.1', 3)
        page.locator('#set-key').click()
        page.locator('#frame-number').fill('30');page.locator('#frame-number').press('Tab')
        settled()
        check('Timeline evaluates transform keys', page.evaluate('aureon.activeObject.keys.length === 2 && Math.abs(aureon.activeObject.position[1]-2)<1e-6'))
        page.locator('#curve-button').click()
        check('Curve editor displays the actual animation channels', page.locator('.curve-surface').is_visible())
        page.locator('#curve-channel').select_option('position.0')
        page.locator('#dialog-apply').click()
        page.locator('#playback [data-command="play"]').click()
        page.wait_for_timeout(300)
        check('Timeline playback changes frame', page.evaluate('aureon.playing && aureon.doc.animation.frame !== 30'))
        page.locator('#playback [data-command="play"]').click()
        settled()

        # File download, restoration through the real file-input path, imports, recovery.
        with page.expect_download() as info:
            command('File','save')
        scene_path=out/'workflow.aureon'
        info.value.save_as(scene_path)
        stored=json.loads(scene_path.read_text())
        check('Scene JSON preserves geometry, modifiers, materials and keys', any(o['id']==box_id and len(o['keys'])==2 for o in stored['objects']))
        page.locator('[data-primitive="sphere"]').click();settled()
        page.locator('#file-input').set_input_files(str(scene_path));settled()
        check('Native scene input restores saved state', page.evaluate('aureon.doc.objects.length') == len(stored['objects']))
        obj_path=out/'triangle.obj';obj_path.write_text('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
        page.locator('#file-input').set_input_files(str(obj_path));settled()
        check('OBJ import decodes a real polygon through the UI', page.evaluate('aureon.activeObject.type === "mesh" && aureon.activeObject.mesh.faces.length === 1'))
        page.evaluate('aureon.autosave()')
        check('IndexedDB recovery persists a validated local document', page.evaluate('async()=>{const {loadRecovery}=await import("./src/io/storage.js");const r=await loadRecovery();return r.document.objects.length===aureon.doc.objects.length;}'))

        # Fresh demo for integrator tests, including ideal dielectric branches and thin lens.
        page.evaluate('async()=>{const {demoDocument}=await import("./src/scene/document.js");aureon.doc=demoDocument();aureon.geometry.clear();aureon.selected.clear();aureon.doc.objects[4].material=6;aureon.doc.camera.aperture=.02;aureon.doc.settings.resolution=.25;aureon.doc.settings.samples=12;aureon.changed();}')
        settled()
        page.locator('#render-button').click()
        page.wait_for_function('aureon.renderer.samples >= 12 && !aureon.renderer.busy',timeout=120000)
        metrics=page.evaluate('async()=>{const h=await aureon.renderer.readHDR();let sum=0,max=0,finite=true,positive=0;for(let i=0;i<h.data.length;i+=4){for(let k=0;k<3;k++){const v=h.data[i+k];finite&&=Number.isFinite(v);sum+=v;max=Math.max(max,v);if(v>0)positive++;}}return {width:h.width,height:h.height,finite,mean:sum/(h.width*h.height*3),max,positive,samples:aureon.renderer.samples};}')
        report['render']=metrics
        check('Compute path tracing, glass, depth of field and HDR readback', metrics['finite'] and metrics['mean']>0 and metrics['max']>1, metrics)
        with page.expect_download() as info:
            command('File','exportPNG')
        png_path=out/'render.png';info.value.save_as(png_path)
        check('PNG export produces an actual image file', png_path.read_bytes().startswith(b'\x89PNG') and png_path.stat().st_size>1000)
        pixels=page.evaluate("""async encoded=>{const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+encoded)).blob());const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let sum=0,min=255,max=0;for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3;sum+=v;min=Math.min(min,v);max=Math.max(max,v);}return {mean:sum/(c.width*c.height),range:max-min};}""",base64.b64encode(png_path.read_bytes()).decode())
        check('PNG contains rendered pixels, not a black presentation surface',pixels['mean']>10 and pixels['range']>20,pixels)

        with page.expect_download() as info:
            command('File','exportHDR')
        pfm_path=out/'render.pfm';info.value.save_as(pfm_path)
        check('PFM export preserves float32 linear radiance', pfm_path.read_bytes().startswith(b'PF\n') and pfm_path.stat().st_size>metrics['width']*metrics['height']*12)
        check_presentation('Path-tracing')
        page.screenshot(path=str(out/'path-tracing.png'),full_page=True)

        page.evaluate('aureon.renderer.paused=true;aureon.doc.camera.yaw+=.1;aureon.cameraChanged()')
        check('Camera edits invalidate accumulated radiance', page.evaluate('aureon.renderer.samples === 0'))
        page.evaluate('aureon.renderer.paused=false;aureon.doc.settings.samples=2;aureon.dirty=true')
        page.wait_for_function('aureon.renderer.samples>=2 && !aureon.renderer.busy',timeout=45000)

        # A retained production result must not strand the interactive viewport
        # at export resolution or leave its shutter-time snapshot bound.
        def production_snapshot():
            page.evaluate("""async()=>{
              aureon.renderLocked=true;
              while(aureon.building||aureon.renderer.busy)await new Promise(r=>setTimeout(r,10));
              const {renderProduction}=await import('./src/render/production.js');
              const snapshot=structuredClone(aureon.doc);snapshot.objects=[];
              try{await renderProduction(aureon.renderer,snapshot,{width:32,height:24,samples:2,shutter:[0,0]});aureon.renderer.paused=true;aureon.dirty=false;}
              finally{aureon.renderLocked=false;}
            }""")
        production_snapshot()
        page.evaluate('aureon.toggleRender(false)');settled()
        check('Back to modeling restores viewport size and canonical scene after production rendering',page.evaluate('!aureon.renderer.fixedSize && aureon.renderer.mode==="raster" && aureon.renderer.scene.triangles.length===aureon.compiled.triangles.length && aureon.renderer.scene.triangles.length>0'))
        production_snapshot()
        page.evaluate('aureon.doc.settings.samples=2;aureon.doc.camera.yaw+=.05;aureon.cameraChanged()');settled()
        page.wait_for_function('aureon.renderer.samples>=2 && !aureon.renderer.busy',timeout=45000)
        check('Camera edits exit a paused production snapshot and render the editable scene',page.evaluate('!aureon.renderer.fixedSize && !aureon.renderer.paused && aureon.renderer.scene.triangles.length>0'))

        # Empty buffers, zero lights and an environment-only path are not mocked.
        page.evaluate('aureon.doc.objects=[];aureon.selected.clear();aureon.geometry.clear();aureon.changed()')
        settled()
        page.wait_for_function('aureon.renderer.samples>=2 && !aureon.renderer.busy',timeout=45000)
        check('Empty scene and zero mesh lights render safely', page.evaluate('aureon.compiled.triangles.length === 0 && aureon.renderer.errors.length === 0'))
        check('Zero uncaptured GPU validation errors', page.evaluate('aureon.renderer.errors.length === 0'), page.evaluate('aureon.renderer.errors'))
        check('Zero uncaught browser exceptions', not report['errors'], report['errors'])
        browser.close()
        report['passed']=True
except Exception as e:
    report['passed']=False
    report['failure']=repr(e)
    raise
finally:
    (out/'browser-report.json').write_text(json.dumps(report,indent=2))
    if server:server.terminate()
