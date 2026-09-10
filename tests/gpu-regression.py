"""Real Chromium/WebGPU regression runner, including deliberate startup failures.

--software explicitly uses SwiftShader for correctness, never speed claims.
A blocked browser, missing adapter, failed shader or timeout is a failing test.
"""
from __future__ import annotations
import argparse
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
parser.add_argument('--software', action='store_true')
parser.add_argument('--output', default=str(ROOT/'test-results/gpu'))
args = parser.parse_args()
base = args.url.rstrip('/')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report = {'status':'running', 'softwareAdapterRequested':args.software, 'checks':[], 'errors':[]}
server = None

def check(name, condition, details=None):
    if not condition:
        raise AssertionError(name + (': '+str(details) if details else ''))
    report['checks'].append({'name':name, 'passed':True, 'details':details})
    print('PASS', name, flush=True)

try:
    try:
        urllib.request.urlopen(base, timeout=2).close()
    except OSError:
        if base != 'http://localhost:4173':
            raise RuntimeError('Start a server at the requested URL before running these tests')
        server = subprocess.Popen(['node','scripts/serve.mjs'], cwd=ROOT, stdout=subprocess.DEVNULL)
        for attempt in range(50):
            try:
                urllib.request.urlopen(base, timeout=1).close(); break
            except OSError:
                if attempt == 49: raise
                time.sleep(.2)
    with sync_playwright() as p:
        flags=['--no-sandbox', '--enable-unsafe-webgpu']
        if args.software:
            flags += ['--use-angle=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface','--use-vulkan=swiftshader']
        browser=p.chromium.launch(headless=True, args=flags, **({'executable_path':args.browser} if args.browser else {}))
        report['browserVersion']=browser.version
        page=browser.new_page(viewport={'width':1280,'height':900})
        page.on('pageerror',lambda e: report['errors'].append(str(e)))
        page.on('console',lambda m: print('BROWSER',m.type,m.text,flush=True) if m.type=='error' or m.text.startswith('GPU phase:') else None)
        page.goto(base+'/tests/production-gpu.html')
        try:
            page.wait_for_function('window.done===true',timeout=300000)
        finally:
            report['production']=page.evaluate('window.report || null')
            try: page.screenshot(path=str(out/'production.png'),timeout=5000)
            except Exception as capture_error: report['captureWarning']=str(capture_error)
        check('Production shader, transport, example scene and AOV suite',report['production']['status']=='passed',report['production'].get('failure'))
        page.goto(base+'/')
        page.wait_for_function('window.aureon?.ready',timeout=60000)
        check('Editor initializes WebGPU',page.evaluate('aureon.gpuReady'))
        page.wait_for_function('aureon.compiled && !aureon.needsBuild && !aureon.building && !aureon.renderer.busy',timeout=60000)
        check('Editor rasterizes the complete demonstration scene',page.evaluate('aureon.compiled.triangles.length/32===8138 && aureon.renderer.errors.length===0'))
        page.screenshot(path=str(out/'editor.png'))
        page.close()
        # Failure injection still invokes the actual compiler and startup path.
        bad=browser.new_page()
        bad.on('pageerror',lambda e: report['errors'].append(str(e)))
        bad.route('**/src/render/pathtrace.wgsl',lambda route: route.fulfill(status=200,content_type='text/plain',body='fn invalid()->u32{return 2u*3u^4u;}'))
        bad.goto(base+'/');bad.wait_for_function('window.aureon?.ready',timeout=60000)
        state=bad.evaluate('({ready:aureon.gpuReady,disposed:aureon.renderer.disposed,title:document.querySelector("#gpu-error h2").textContent,label:document.querySelector("#gpu-label").textContent,stage:aureon.renderer.initializationError?.stage,errors:aureon.renderer.errors,diagnostics:aureon.renderer.initializationError?.diagnostics})')
        check('Invalid WGSL is labeled Shader error, not GPU unavailable',not state['ready'] and state['label']=='Shader error' and state['stage']=='shader',state)
        check('Failed startup releases the device and captures validation errors',state['disposed'] and not state['errors'])
        check('Compiler diagnostic maps to the failing file and source line',state['diagnostics'][0]['file']=='pathtrace.wgsl' and state['diagnostics'][0]['line']==1)
        bad.locator('[data-primitive="box"]').click()
        check('Scene editing remains available after shader startup failure',bad.evaluate('aureon.doc.objects.length===11'))
        bad.screenshot(path=str(out/'shader-error.png'));bad.close()
        missing=browser.new_page()
        missing.on('pageerror',lambda e: report['errors'].append(str(e)))
        missing.route('**/src/render/denoise.wgsl',lambda route: route.fulfill(status=404,content_type='text/plain',body='Not found'))
        missing.goto(base+'/');missing.wait_for_function('window.aureon?.ready',timeout=60000)
        check('A missing shader file is a loading error, not missing hardware',missing.evaluate('!aureon.gpuReady && aureon.renderer.initializationError.stage==="asset" && aureon.renderer.initializationError.message.includes("HTTP 404") && aureon.renderer.disposed'))
        missing.close()
        check('No uncaught JavaScript errors in renderer and failure recovery tests',not report['errors'],report['errors'])
        advanced=browser.new_page()
        advanced.on('pageerror',lambda e: report['errors'].append(str(e)))
        advanced.goto(base+'/tests/advanced-gpu.html')
        try: advanced.wait_for_function('window.done===true',timeout=300000)
        finally:
            report['advanced']=advanced.evaluate('window.report || null')
            try: advanced.screenshot(path=str(out/'advanced.png'),timeout=5000)
            except Exception as capture_error: report['captureWarning']=str(capture_error)
        if report['advanced']['status']!='passed':raise RuntimeError('Advanced GPU regression failed: '+str(report['advanced'].get('failure')))
        if report['errors']:raise RuntimeError('Uncaught advanced test errors: '+str(report['errors']))
        browser.close()
    report['status']='passed'
except Exception as error:
    report['status']='failed';report['failure']=str(error)
finally:
    (out/'diagnostics.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    if server: server.terminate()
raise SystemExit(0 if report['status']=='passed' else 1)
