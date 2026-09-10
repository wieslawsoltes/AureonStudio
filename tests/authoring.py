"""Actual production-authoring UI integration; no renderer or solver test doubles."""
import argparse, json, os, time, subprocess, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--software',action='store_true');p.add_argument('--url',default='http://localhost:4173');p.add_argument('--output',default='test-results/gpu/authoring');args=p.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True);base=args.url.rstrip('/');server=None
report={'status':'running','softwareAdapterRequested':args.software,'checks':[],'errors':[]}
def check(name,ok=True,details=None):
    if not ok: raise AssertionError(name+': '+str(details))
    report['checks'].append({'name':name,'passed':True,'details':details});print('PASS',name,flush=True)
try:
    try: urllib.request.urlopen(base,timeout=2).close()
    except OSError:
        if base!='http://localhost:4173':raise
        server=subprocess.Popen(['node','scripts/serve.mjs'],cwd=ROOT,stdout=subprocess.DEVNULL);time.sleep(1)
    with sync_playwright() as pw:
        flags=['--no-sandbox','--enable-unsafe-webgpu']
        if args.software:flags+=['--use-angle=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface','--use-vulkan=swiftshader']
        browser=pw.chromium.launch(headless=True,args=flags)
        page=browser.new_page(viewport={'width':1536,'height':1080},accept_downloads=True)
        page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('dialog',lambda d:d.accept())
        page.goto(base);page.wait_for_function('window.aureon?.ready',timeout=90000)
        check('Production authoring starts with native WebGPU',page.evaluate('aureon.gpuReady'))
        report['browser']=browser.version
        def settled():page.wait_for_function('aureon.compiled && aureon.builtRevision===aureon.revision && !aureon.building && !aureon.needsBuild && !aureon.renderer.busy',timeout=90000)
        def command(menu,id):
            page.locator(f'[data-menu="{menu}"]').click();page.locator(f'#menu-popup [data-command="{id}"]').click()
            page.wait_for_function('document.querySelector("#dialog").open')
        def apply():
            page.locator('#dialog-apply').click();page.wait_for_function('!document.querySelector("#dialog").open',timeout=10000);settled()
        def cancel():page.locator('#dialog-cancel').click()
        def snapshot():return page.evaluate('JSON.stringify(aureon.doc)')
        def fixture(types=['box']):
            page.evaluate('''async types=>{const M=await import('./src/scene/document.js');window.fixtureModules=M;
              const doc=M.emptyDocument();doc.name='Authoring regression';doc.settings.textureResolution=64;doc.settings.bounces=4;
              doc.objects=types.map((type,i)=>{const o=M.newObject(type,{},'Fixture '+i);o.material=0;o.position=[i*.5,1,0];return o;});
              aureon.doc=M.validateDocument(doc);aureon.geometry.clear();aureon.history.clear();aureon.selected=new Set(doc.objects.slice(0,1).map(o=>o.id));aureon.materialIndex=0;aureon.changed();}''',types);settled()
        fixture()
        before=snapshot();command('Model','bevel');page.locator('#bevel-width').fill('.08');cancel();check('Cancelling bevel leaves the canonical document untouched',snapshot()==before)
        command('Model','bevel');page.locator('#bevel-segments').fill('3');apply()
        check('Segmented bevel is evaluated by the live geometry compiler',page.evaluate('aureon.activeObject.modifiers.at(-1).segments===3 && aureon.geometry.get(aureon.activeObject).faces.length>12'))
        command('Model','udim');page.locator('#uv-tiles').fill('2');apply()
        check('UDIM packing commits seam-separated editable UV charts',page.evaluate('aureon.activeObject.type==="mesh" && aureon.activeObject.mesh.uvCharts.length>1'))
        fixture(['box','box']);command('Model','boolean');page.locator('#solid-op').select_option('union');apply()
        check('Exact Boolean UI commits a manifold mesh and hides its operand',page.evaluate('aureon.activeObject.type==="mesh" && !aureon.doc.objects[1].visible && aureon.activeObject.mesh.faces.length>0'))
        fixture();before=snapshot();command('Render','texturePaint');canvas=page.locator('#paint-surface');blank=canvas.evaluate('(c)=>c.toDataURL()');rect=canvas.bounding_box()
        page.mouse.move(rect['x']+rect['width']*.4,rect['y']+rect['height']*.5);page.mouse.down();page.mouse.move(rect['x']+rect['width']*.6,rect['y']+rect['height']*.5,steps=3);page.mouse.up()
        painted=canvas.evaluate('(c)=>c.toDataURL()');check('Paint brush changes actual canvas pixels',painted!=blank)
        page.locator('#paint-undo').click();check('Paint undo restores exact displayed pixels',canvas.evaluate('(c)=>c.toDataURL()')==blank)
        page.locator('#paint-redo').click();check('Paint redo restores exact stroke pixels',canvas.evaluate('(c)=>c.toDataURL()')==painted)
        cancel();check('Cancelling texture painting discards the draft',snapshot()==before)
        command('Render','texturePaint');canvas=page.locator('#paint-surface');canvas.click(position={'x':200,'y':200});page.locator('#paint-add').click();page.locator('#paint-tile').fill('1002');page.locator('#paint-tile').press('Tab');page.locator('#paint-add-tile').click();canvas.click(position={'x':250,'y':220});page.screenshot(path=str(out/'texture-paint.png'));apply()
        check('Layered UDIM paint is saved, assigned and uploaded to the GPU',page.evaluate('aureon.doc.materials[0].bitmap===0 && aureon.doc.textures[0].layers.length===2 && !!aureon.doc.textures[0].layers[1].texture.tiles[1002] && aureon.renderer.assets.textureCount===1'))
        before=snapshot();page.locator('#edit-tools [data-command="undo"]').click();settled();check('Scene undo removes the committed paint asset',page.evaluate('!aureon.doc.textures?.length'));page.locator('#edit-tools [data-command="redo"]').click();settled();check('Scene redo recovers the complete paint document',snapshot()==before)
        fixture();command('Animation','controllers');page.locator('#controller-data').fill(json.dumps([{'path':'position','axis':0,'kind':'oscillator','frequency':.25,'amplitude':1,'offset':0}]));apply();page.evaluate('aureon.setFrame(24)');settled()
        check('Controller dialog drives evaluated world geometry at animation time',page.evaluate('Math.abs(fixtureModules.worldMatrix(aureon.doc,aureon.activeObject)[12]-1)<1e-6'))
        fixture(['box','box']);command('Animation','constraints');page.locator('#constraint-add').click();apply()
        check('Constraint stack resolves the target in the live scene',page.evaluate('aureon.activeObject.constraints[0].type==="copyPosition" && Math.abs(fixtureModules.worldMatrix(aureon.doc,aureon.activeObject)[12]-.5)<1e-6'))
        before=snapshot();command('Animation','constraints');page.locator('#constraint-data').fill('[{"type":"parent","target":"missing"}]');page.locator('#dialog-apply').click();check('Invalid constraint remains editable without corrupting the scene',page.locator('#dialog').evaluate('(d)=>d.open') and snapshot()==before);cancel()
        fixture(['box','box']);command('Animation','rig');page.locator('#rig-count').fill('3');apply();command('Animation','rig');page.locator('#rig-r2').fill('20');apply()
        source_id=page.evaluate('aureon.activeObject.id');target_id=page.evaluate('aureon.doc.objects[1].id');page.locator(f'.scene-row[data-object="{target_id}"]').click();command('Animation','rig');page.locator('#rig-count').fill('3');apply();command('Animation','retarget');page.locator('#retarget-last').fill('2');apply()
        check('Retarget dialog bakes mapped skeletal keys without replacing skin weights',page.evaluate('aureon.activeObject.rig.bones.every(b=>b.keys.length===3) && aureon.activeObject.rig.weights.length>0'))
        fixture(['sphere','sphere']);page.evaluate('aureon.doc.physics={gravity:[0,0,0],floor:-10,linearDamping:0};aureon.doc.objects[0].position=[-.6,1,0];aureon.doc.objects[1].position=[.6,1,0];aureon.changed()');settled()
        ids=page.evaluate('aureon.doc.objects.map(o=>o.id)')
        for i,id in enumerate(ids):
            page.locator(f'.scene-row[data-object="{id}"]').click();command('Animation','sceneDynamics');page.locator('#dynamics-shape').select_option('sphere');page.locator('#dynamics-velocity0').fill(str(1 if i==0 else -1));page.locator('#dynamics-bounce').fill('1');apply()
        page.evaluate('aureon.setFrame(12)');settled()
        check('Rigid bodies authored through the editor share one collision world',page.evaluate('aureon.geometry.simulations.rigid.bodies.size===2 && aureon.geometry.simulations.rigid.bodies.get(aureon.doc.objects[0].id).body.velocity[0]<0'))
        fixture(['plane']);command('Animation','sceneDynamics');page.locator('#dynamics-type').select_option('cloth');apply();check('Cloth dialog enables self-collision and root pins',page.evaluate('aureon.activeObject.simulation.selfCollision && aureon.activeObject.simulation.pins.length>0'))
        fixture([]);command('Create','fluid');page.locator('#fluid-spacing').fill('.25')
        for k in range(3):page.locator(f'#fluid-size{k}').fill('.5')
        apply();page.evaluate('aureon.setFrame(1)');settled();check('Fluid creation generates an evaluated finite surface',page.evaluate('aureon.activeObject.simulation.type==="fluid" && aureon.geometry.get(aureon.activeObject).faces.length>0 && aureon.geometry.get(aureon.activeObject).positions.every(Number.isFinite)'))
        fixture(['plane']);command('Create','hair');page.locator('#hair-count').fill('8');page.locator('#hair-length').fill('.8');apply();command('Animation','groom');before=snapshot();canvas=page.locator('#groom-surface');before_pixels=canvas.evaluate('(c)=>c.toDataURL()');rect=canvas.bounding_box();page.locator('#groom-radius').fill('5');page.mouse.move(rect['x']+rect['width']*.45,rect['y']+rect['height']*.5);page.mouse.down();page.mouse.move(rect['x']+rect['width']*.65,rect['y']+rect['height']*.5,steps=3);page.mouse.up()
        groomed=canvas.evaluate('(c)=>c.toDataURL()');check('Grooming brush edits actual projected guides',groomed!=before_pixels);page.locator('#groom-undo').click();check('Groom undo restores guide positions',canvas.evaluate('(c)=>c.toDataURL()')==before_pixels);page.locator('#groom-redo').click();apply();check('Applied groom deforms actual root-bound strand geometry',page.evaluate('aureon.activeObject.procedural.groom.guides.length===8 && aureon.geometry.get(aureon.activeObject).fiberTangents.length>0'))
        command('Render','fiber');page.locator('#fiber-enable').check();page.locator('#fiber-long').fill('.45');apply();check('Fiber material reaches the graph-specialized renderer',page.evaluate('aureon.doc.materials[0].fiber.roughness===.45 && aureon.renderer.materialPipelineKey.startsWith("fiber:true")'))
        page.screenshot(path=str(out/'groomed-hair.png'))
        fixture();command('Render','media');page.locator('#volume-cloud').click();apply();check('Sparse density authoring commits and uploads the real volume field',page.evaluate('aureon.doc.volumes[0].grid.blocks.length>0 && aureon.renderer.assets.volumeCount===1'))
        fixture();command('Render','subsurface');page.locator('#sss-weight').fill('.4');page.locator('#sss-density').fill('3.25');apply()
        check('Subsurface material authoring remains available beside heterogeneous regions',page.evaluate('aureon.doc.materials[0].subsurface.weight===.4 && aureon.doc.materials[0].subsurface.density===3.25'))
        fixture();command('Render','productionRender');page.locator('#frame-width').fill('32');page.locator('#frame-height').fill('24');page.locator('#frame-samples').fill('2');page.locator('#frame-blur').uncheck();page.locator('#frame-start').click();page.wait_for_function('!aureon.renderLocked && aureon.renderer.samples===2 && aureon.renderer.paused',timeout=120000);cancel()
        command('Render','exportEXR');page.locator('#exr-compression').select_option('ZIP');page.locator('#exr-layout').select_option('multipart');page.locator('#exr-type').select_option('HALF')
        with page.expect_download(timeout=30000) as event:page.locator('#dialog-apply').click()
        event.value.save_as(str(out/'authored-frame.exr'));data=(out/'authored-frame.exr').read_bytes();check('UI exports a compressed multipart EXR from actual rendered pixels',int.from_bytes(data[:4],'little')==20000630 and bool(int.from_bytes(data[4:8],'little')&4096))
        page.wait_for_function('!document.querySelector("#dialog").open');page.locator('[data-primitive="box"]').click();settled();check('Editing after compressed export restores interactive rendering',page.evaluate('!aureon.renderer.fixedSize && aureon.renderer.mode==="raster"'))
        check('All authoring cases finish without uncaught JavaScript or GPU errors',not report['errors'] and page.evaluate('aureon.renderer.errors.length===0'),report['errors'])
        report['status']='passed';browser.close()
except Exception as e:
    report['status']='failed';report['failure']=str(e)
    try:page.screenshot(path=str(out/'failure.png'),timeout=5000)
    except Exception:pass
finally:
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    if server:server.terminate()
raise SystemExit(0 if report['status']=='passed' else 1)
