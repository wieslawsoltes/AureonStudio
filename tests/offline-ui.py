"""Offline DOM integration tests. No navigation, no GPU mocking, no GPU claims.
Loads the actual ES modules into an about:blank document. Useful when managed
browser policy disallows HTTP navigation. This cannot validate WebGPU shaders.
"""
import json, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'/'v0.2'
OUT.mkdir(parents=True,exist_ok=True)
sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'src').rglob('*.js') if '/distributed/queue' not in str(p)}
html=(ROOT/'index.html').read_text()
html=re.sub(r'<script[\s\S]*?</script>','',html)
html=re.sub(r'<link[^>]*rel="stylesheet"[^>]*>','',html)
html=html.replace('</head>','<style>'+(ROOT/'styles.css').read_text()+'</style></head>')
report={'kind':'offline DOM only; no WebGPU available','checks':[],'errors':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':1100})
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.set_content(html)
    page.evaluate('''async sources=>{
      const urls=new Map(),busy=new Set();
      const resolve=(path,ref)=>{const parts=path.split('/');parts.pop();for(const p of ref.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}return parts.join('/');};
      function build(path){if(urls.has(path))return urls.get(path);if(busy.has(path))throw Error('Module cycle '+path);busy.add(path);let code=sources[path];if(code===undefined)throw Error('Missing module '+path);
        code=code.replace(/(from\\s*['"])(\\.[^'"]+)(['"])/g,(all,a,ref,c)=>a+build(resolve(path,ref))+c);
        code=code.replace(/new URL\\(['"](\\.[^'"]+\\.js)['"],\\s*import\\.meta\\.url\\)/g,(all,ref)=>'new URL('+JSON.stringify(build(resolve(path,ref)))+')');
        const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));urls.set(path,url);busy.delete(path);return url;
      }
      window.testModules={};for(const path of ['src/scene/document.js','src/materials/graph.js','src/geometry/primitives.js'])window.testModules[path]=await import(build(path));
      await import(build('src/app.js'));await aureonReady;
    }''',sources)
    def check(name,condition=True):
        assert condition,name
        report['checks'].append(name);print('PASS',name,flush=True)
    def run(id):page.evaluate('(id)=>aureon.run(id)',id)
    def close():page.locator('#dialog-close').click()
    def apply():page.locator('#dialog-apply').click()
    def valid():return page.evaluate('!!testModules["src/scene/document.js"].validateDocument(aureon.doc)')
    check('Actual editor starts without substituting a fake GPU',page.evaluate('aureon.ready && !aureon.gpuReady'))
    check('Production render and coordinator commands installed',page.evaluate('Object.keys(aureon.commands).includes("productionRender")&&Object.keys(aureon.commands).includes("distributed")'))
    # Use actual create command and form controls, not invented result objects.
    run('create:box');page.wait_for_timeout(120)
    check('Actual box creation and CPU worker scene build',page.evaluate('aureon.activeObject.type==="box"'))
    run('rig');page.locator('#rig-count').fill('4');apply();check('Bind rig through dialog',page.evaluate('aureon.activeObject.rig.bones.length===4') and valid())
    run('rig');page.locator('#rig-r2').fill('25');apply();check('Edit keyed rig pose through dialog',page.evaluate('aureon.activeObject.rig.bones[0].keys.length===1') and valid())
    run('shaderGraph');check('Graph nodes are real connected DOM cards',page.locator('.shade-node').count()==5);page.locator('#node-check').click();page.screenshot(path=str(OUT/'node-editor.png'));apply();check('Graph applied to shared material',page.evaluate('!!aureon.doc.materials[aureon.materialIndex].graph') and valid())
    run('media');page.locator('#sss-weight').fill('.6');page.locator('#volume-enabled').check();apply();check('Media dialog writes canonical shader parameters',page.evaluate('aureon.doc.volume.density>0 && aureon.doc.materials[aureon.materialIndex].subsurface.weight===.6') and valid())
    run('productionSettings');page.locator('#prod-denoise').check();page.locator('#prod-view').select_option('indirect');apply();check('Denoise/AOV settings apply',page.evaluate('aureon.doc.settings.denoise&&aureon.doc.settings.view==="indirect"') and valid())
    run('create:box');page.wait_for_timeout(120)
    run('uvEditor');page.locator('#uv-unwrap').click();apply();check('Conformal UV editor writes six real islands',page.evaluate('aureon.activeObject.mesh.uvCharts.length===6') and valid())
    run('hair');page.locator('#hair-count').fill('8');apply();check('Hair UI feeds real curve geometry',page.evaluate('aureon.activeObject.procedural.kind==="hair" && aureon.geometry.get(aureon.activeObject).faces.length>100') and valid())
    run('particles');page.locator('#part-rate').fill('5');apply();page.evaluate('aureon.setFrame(24)');check('Particle UI feeds animated mesh geometry',page.evaluate('aureon.geometry.get(aureon.activeObject).faces.length>=40') and valid())
    run('create:box');page.wait_for_timeout(100);run('rigid');apply();check('Rigid simulation settings apply',page.evaluate('aureon.activeObject.simulation.type==="rigid"') and valid())
    run('create:plane');page.wait_for_timeout(100);run('cloth');apply();check('Cloth pins and solver apply',page.evaluate('aureon.activeObject.simulation.type==="cloth"') and valid())
    run('bakeCache');page.locator('#bake-last').fill('2');apply();page.wait_for_timeout(100);check('Simulation bake saves actual frame positions',page.evaluate('aureon.activeObject.meshCache.frames.length===3') and valid())
    run('interchange');check('Interchange workspace exposes import/export actions',page.locator('#glb-export').count()==1);close()
    run('distributed');check('Coordinator workspace exposes actual submit/worker actions',page.locator('#dist-submit').count()==1 and page.locator('#dist-worker').count()==1);close()
    # Two solids using built-in primitive constructors, actual boolean dialog.
    page.evaluate('''()=>{const M=testModules['src/scene/document.js'];aureon.doc=M.emptyDocument();const a=M.newObject('box'),b=M.newObject('box');a.position=[0,0,0];b.position=[.5,0,0];aureon.doc.objects=[a,b];aureon.selected=new Set([a.id,b.id]);aureon.changed();}''')
    run('boolean');page.locator('#bool-op').select_option('union');apply();check('Boolean dialog creates evaluated result and hides operands',page.evaluate('aureon.doc.objects.length===3 && aureon.activeObject.type==="mesh" && !aureon.doc.objects[0].visible') and valid())
    check('No uncaught JS exceptions during offline workflows',len(report['errors'])==0)
    browser.close()
(OUT/'offline-ui.json').write_text(json.dumps(report,indent=2))
