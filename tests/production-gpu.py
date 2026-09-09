"""Execute the real-GPU test page; policy/adapter failures are never passes.
Serve the repository first: npm start. No security policy is altered.
"""
import argparse,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--url',default='http://localhost:4173');p.add_argument('--browser',default=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'));p.add_argument('--headed',action='store_true');args=p.parse_args()
out=ROOT/'test-results/v0.2';out.mkdir(parents=True,exist_ok=True)
report={'release':'0.2.0','status':'not-run','checks':[]}
try:
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch(executable_path=args.browser,headless=not args.headed,args=['--no-sandbox'])
        page=browser.new_page();page.goto(args.url.rstrip('/')+'/tests/production-gpu.html')
        page.wait_for_function('window.done===true',timeout=180000);report=page.evaluate('window.report');browser.close()
except Exception as e:
    report.update(status='blocked' if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e) else 'failed',reason=str(e))
finally:
    (out/'gpu-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed' else 2)
