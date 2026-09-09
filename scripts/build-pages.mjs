import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_ENTRIES = ['index.html', 'styles.css', 'worker.html', 'src', 'examples', 'LICENSE', '.nojekyll'];

/** Stage only browser assets, not server code, repository metadata or test outputs. */
export async function buildPages({sourceRoot = PROJECT_ROOT, outputRoot = resolve(PROJECT_ROOT, '_site')} = {}) {
  sourceRoot = resolve(sourceRoot);
  outputRoot = resolve(outputRoot);
  if (basename(outputRoot) !== '_site' || outputRoot === sourceRoot || sourceRoot.startsWith(outputRoot + sep)) {
    throw new Error('The disposable Pages output must be a separate directory named _site.');
  }
  const inside = relative(sourceRoot, outputRoot);
  if (!inside.startsWith('..') && inside !== '_site') throw new Error('Refusing to overwrite a source directory.');
  for (const name of PUBLIC_ENTRIES) await stat(resolve(sourceRoot, name));
  await rm(outputRoot, {recursive: true, force: true});
  await mkdir(outputRoot, {recursive: true});
  for (const name of PUBLIC_ENTRIES) await cp(resolve(sourceRoot, name), resolve(outputRoot, name), {recursive: true, dereference: false});
  const {version} = JSON.parse(await readFile(resolve(sourceRoot, 'package.json'), 'utf8'));
  const deployment = {application: 'Aureon Studio + Aureon Ray', version, commit: process.env.GITHUB_SHA || null, hosting: 'GitHub Pages; static browser application only'};
  await writeFile(resolve(outputRoot, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n');
  let files = 0;
  async function count(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in a Pages artifact.');
      if (entry.isDirectory()) await count(resolve(dir, entry.name)); else files++;
    }
  }
  await count(outputRoot);
  return {outputRoot, files, version};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPages();
  console.log(`Staged Aureon ${result.version}: ${result.files} files in ${result.outputRoot}`);
}
