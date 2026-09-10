import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const cwd = new URL('..', import.meta.url);
const run = (...args) => spawnSync('python3', ['tests/run-webgpu.py', ...args], {cwd, encoding: 'utf8'});

test('Canonical GPU gate enumerates all four unchanged native browser suites', () => {
  const result = run('--plan', '--software', '--browser', '/tmp/test chromium');
  assert.equal(result.status, 0, result.stderr);
  const commands = JSON.parse(result.stdout);
  assert.deepEqual(commands.map(x => x.suite), ['transport', 'advanced', 'editor', 'authoring']);
  assert.deepEqual(commands.map(x => x.command[1]), ['tests/gpu-regression.py', 'tests/page-runner.py', 'tests/browser.py', 'tests/authoring.py']);
  for (const {command} of commands) {
    assert.ok(command.includes('--software'));
    assert.ok(!command.some(arg => [';', ';;', '&&', '|', '$BROWSER'].includes(arg)));
  }
  assert.ok(commands[0].command.includes('--baseline-only'));
  assert.ok(commands[2].command.includes('/tmp/test chromium'));
});

test('Single-suite CI execution does not omit tests or force software in hardware mode', () => {
  const result = run('--suite', 'advanced', '--plan');
  assert.equal(result.status, 0, result.stderr);
  const commands = JSON.parse(result.stdout);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command[1], 'tests/page-runner.py');
  assert.ok(!commands[0].command.includes('--software'));
  assert.notEqual(run('--suite', 'unknown', '--plan').status, 0);
  const editor = JSON.parse(run('--suite', 'editor', '--plan').stdout)[0].command;
  assert.ok(!editor.includes('--browser'), 'Default editor must use the same Playwright headless browser as other suites');
});

test('Suite runner propagates child failures instead of publishing a passing summary', () => {
  const script = `import importlib.util, subprocess, tempfile, pathlib, json, sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('runner','tests/run-webgpu.py')
r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
with tempfile.TemporaryDirectory() as tmp:
 with patch.object(sys,'argv',['runner','--suite','advanced','--output',tmp]):
  with patch.object(r.subprocess,'run',return_value=subprocess.CompletedProcess(['test'],7)):
   assert r.main()==1
 report=json.loads((pathlib.Path(tmp)/'suite-runner-advanced.json').read_text())
 assert report['status']=='failed' and report['suites'][0]['returncode']==7
`;
  // Only process-runner failure propagation is mocked; no renderer/test is replaced.
  const result = spawnSync('python3', ['-c', script], {cwd, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('Pages requires CPU build plus complete browser and independent codec matrix', () => {
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const gpu = readFileSync(new URL('../.github/workflows/webgpu.yml', import.meta.url), 'utf8');
  assert.match(pages, /needs: \[build, gpu\]/);
  assert.match(gpu, /suite: \[transport, advanced, editor, authoring\]/);
  assert.match(gpu, /python3 tests\/run-webgpu.py --suite "\$SUITE" --software/);
  assert.match(gpu, /node tests\/exr-interoperability.mjs verify/);
  assert.doesNotMatch(gpu, /continue-on-error:\s*true/);
});
