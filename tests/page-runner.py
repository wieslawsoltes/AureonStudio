"""Run an independently reported native WebGPU test page and retain evidence."""
import argparse,json,subprocess,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--page',default='tests/advanced-gpu.html');p.add_argument('--output',default='test-results/gpu/advanced');p.add_argument('--software',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=Path(a.output);out.mkdir(parents=True,exist_ok=True);server=None
result={'status':'failed','errors':[],'softwareAdapterRequested':a.software}
try:
    try:urllib.request.urlopen('http://localhost:4173',timeout=1).close()
    except OSError:server=subprocess.Popen(['node','scripts/serve.mjs'],cwd=root,stdout=subprocess.DEVNULL);time.sleep(1)
    with sync_playwright() as p:
        flags=['--no-sandbox','--enable-unsafe-webgpu']
        if a.software:flags+=['--use-angle=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface','--use-vulkan=swiftshader']
        b=p.chromium.launch(headless=True,args=flags);page=b.new_page();result['browserVersion']=b.version
        page.on('pageerror',lambda e:result['errors'].append(str(e)));page.on('console',lambda m:print(m.text,flush=True))
        page.goto('http://localhost:4173/'+a.page)
        try:page.wait_for_function('window.done===true',timeout=300000)
        finally:
            result['page']=page.evaluate('window.report||null')
            try:page.screenshot(path=str(out/'render.png'),timeout=5000)
            except Exception as e:result['captureWarning']=str(e)
        assert result['page']['status']=='passed',result['page'].get('failure')
        assert len(result['page']['checks'])>=10,'Suite executed too few checks'
        assert not result['errors'],result['errors'];result['status']='passed';b.close()
except Exception as e:result['failure']=str(e)
finally:
    (out/'report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
    if server:server.terminate()
raise SystemExit(0 if result['status']=='passed' else 1)
