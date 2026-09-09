import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, writeFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {buildPages, PROJECT_ROOT, PUBLIC_ENTRIES} from '../scripts/build-pages.mjs';

async function walk(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), {withFileTypes: true})) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, name));
    else files.push(name);
  }
  return files.sort();
}
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'aureon-pages-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return join(root, '_site');
}

test('Pages stages byte-identical public assets and excludes development files', async t => {
  const outputRoot = await workspace(t);
  const result = await buildPages({outputRoot});
  const files = await walk(outputRoot);
  assert.equal(result.files, files.length);
  for (const file of files.filter(name => name !== 'deployment.json')) {
    assert.ok(PUBLIC_ENTRIES.some(entry => file === entry || file.startsWith(`${entry}/`)), file);
    assert.deepEqual(await readFile(join(outputRoot, file)), await readFile(join(PROJECT_ROOT, file)), file);
  }
  for (const excluded of ['scripts', 'tests', 'test-results', 'docs', '.git', '.github', 'package.json']) {
    await assert.rejects(access(join(outputRoot, excluded)), {code: 'ENOENT'});
  }
  assert.equal(files.filter(name => name.endsWith('.wgsl')).length, 5);
  assert.equal(files.filter(name => name.endsWith('.aureon')).length, 11);
  const deployment = JSON.parse(await readFile(join(outputRoot, 'deployment.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assert.equal(deployment.version, metadata.version);
  assert.equal(deployment.application, 'Aureon Studio + Aureon Ray');
});

test('Pages HTML, module, worker and shader URLs resolve beneath the project subpath', async t => {
  const outputRoot = await workspace(t);
  await buildPages({outputRoot});
  const files = await walk(outputRoot);
  const published = new Set(files);
  const base = 'https://wieslawsoltes.github.io/AureonStudio/';
  let checked = 0;
  for (const file of files.filter(name => /\.(?:html|js)$/.test(name))) {
    const source = await readFile(join(outputRoot, file), 'utf8');
    const refs = file.endsWith('.html')
      ? [...source.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1])
      : [...source.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*["'](\.[^"']+)["']/g)].map(m => m[1]);
    for (const ref of refs) {
      if (/^(?:#|data:|blob:|https?:)/.test(ref)) continue;
      const url = new URL(ref, new URL(file, base));
      assert.ok(url.href.startsWith(base), `${file}: ${ref} escapes the project subpath`);
      const path = decodeURIComponent(url.pathname.slice('/AureonStudio/'.length));
      assert.ok(published.has(path), `${file}: ${ref} resolves to a missing asset ${path}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `Only ${checked} asset references checked`);
});

test('Pages output removes stale files and rejects destructive output directories', async t => {
  const outputRoot = await workspace(t);
  await buildPages({outputRoot});
  await writeFile(join(outputRoot, 'stale.txt'), 'must not survive a rebuild');
  await buildPages({outputRoot});
  await assert.rejects(access(join(outputRoot, 'stale.txt')), {code: 'ENOENT'});
  for (const unsafe of [PROJECT_ROOT, join(PROJECT_ROOT, 'src'), join(PROJECT_ROOT, 'src/_site'), resolve(PROJECT_ROOT, '../not-site')]) {
    await assert.rejects(buildPages({outputRoot: unsafe}), /(?:separate directory|overwrite a source)/);
  }
  assert.equal(relative(PROJECT_ROOT, resolve(PROJECT_ROOT, '_site')), '_site');
});
