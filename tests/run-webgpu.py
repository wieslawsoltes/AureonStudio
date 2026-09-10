"""Canonical local/CI browser suite runner. Never parse shell or workflow source.

Each suite executes its existing real-browser tests as an argument vector. A
nonzero exit, timeout, or failed launch fails the invocation. The default runs all
four suites sequentially; CI runs the same commands in isolated matrix jobs.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SUITES = ("transport", "advanced", "editor", "authoring")


def command_for(suite: str, *, software: bool, output: Path, browser: str) -> list[str]:
    runners = {
        "transport": ["tests/gpu-regression.py", "--baseline-only"],
        "advanced": ["tests/page-runner.py"],
        "editor": ["tests/browser.py", "--browser", browser],
        "authoring": ["tests/authoring.py"],
    }
    command = [sys.executable, *runners[suite], "--output", str(output / suite)]
    if software:
        command.append("--software")
    return command


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("all", *SUITES), default="all")
    parser.add_argument("--software", action="store_true")
    parser.add_argument("--browser", help="Executable for the legacy editor runner")
    parser.add_argument("--output", default="test-results/gpu")
    parser.add_argument("--plan", action="store_true", help="Print argument vectors without executing tests")
    args = parser.parse_args()
    suites = SUITES if args.suite == "all" else (args.suite,)
    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output
    browser = args.browser or "<playwright-chromium>"
    if "editor" in suites and not args.plan and not args.browser:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.executable_path
    commands = [{"suite": suite, "command": command_for(
        suite, software=args.software, output=output, browser=browser
    )} for suite in suites]
    if args.plan:
        print(json.dumps(commands, indent=2))
        return 0
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "softwareAdapterRequested": args.software, "suites": []}
    report_path = output / ("suite-runner-" + args.suite + ".json")
    failed = False
    try:
        for item in commands:
            print("Executing:", json.dumps(item["command"]), flush=True)
            result = subprocess.run(item["command"], cwd=ROOT, timeout=900, check=False)
            report["suites"].append({**item, "returncode": result.returncode})
            failed = result.returncode != 0
            if failed:
                break
    except (OSError, subprocess.TimeoutExpired) as error:
        failed = True
        report["failure"] = str(error)
    finally:
        report["status"] = "failed" if failed else "passed"
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
