import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateConfig } from './validate-config.mjs';

export const root = new URL('../', import.meta.url);

export async function readConfig() {
  return validateConfig(JSON.parse(await readFile(new URL('extension.json', root), 'utf8')));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function assertContract(spec, metadata) {
  if (!spec || typeof spec !== 'object') throw new Error('dist/plugin.js must default-export a package spec.');
  for (const key of ['id', 'version', 'engine']) if (spec[key] !== metadata[key]) throw new Error(`plugin ${key} (${spec[key]}) does not match extension.json (${metadata[key]}).`);
  for (const key of ['dependencies', 'optionalDependencies', 'conflicts']) {
    if (!same(spec[key] ?? (key === 'conflicts' ? [] : {}), metadata[key])) throw new Error(`plugin ${key} does not match extension.json.`);
  }
  const expectedAspects = ['kite.scope', 'kite.member'];
  if (!same([...(spec.provides?.aspects ?? [])].sort(), expectedAspects.slice().sort())) throw new Error('plugin provides the wrong aspect IDs.');
  if (!same([...(spec.provides?.services ?? [])].sort(), [...metadata.provides.services].sort())) throw new Error('plugin services do not match extension.json.');
}

/**
 * The install manifest for the single bundle in `outDir`. `build` commits it next
 * to dist/; `dev` keeps it in memory for an output directory that is never committed.
 */
export async function createInstallManifest(outDir = new URL('dist/', root)) {
  const metadata = await readConfig();
  const files = await readdir(outDir);
  if (files.length !== 1 || files[0] !== 'plugin.js') throw new Error('The installer expects one self-contained dist/plugin.js bundle.');
  const bundlePath = new URL('plugin.js', outDir);
  const bundle = await readFile(bundlePath);
  const spec = (await import(`${pathToFileURL(fileURLToPath(bundlePath)).href}?v=${Date.now()}`)).default;
  assertContract(spec, metadata);
  const commands = metadata.commands.map(name => `${metadata.id}:${name}`);
  const aspects = [...spec.provides.aspects];
  const manifest = {
    apiVersion: 2,
    id: metadata.id,
    version: metadata.version,
    engine: metadata.engine,
    dependencies: { ...metadata.dependencies },
    optionalDependencies: { ...metadata.optionalDependencies },
    conflicts: [...metadata.conflicts],
    provides: {
      services: [...spec.provides.services],
      aspects,
      hsmSlots: [...spec.provides.hsmSlots],
    },
    title: metadata.title,
    summary: metadata.summary,
    entry: 'dist/plugin.js',
    sha256: createHash('sha256').update(bundle).digest('hex'),
    aspectIds: aspects,
    capabilities: {
      readAspects: [...aspects, 'core.transform', 'core.bounds', 'core.stacking'],
      writeAspects: [...aspects, 'core.transform', 'core.bounds', 'core.stacking'],
      services: ['canvas.active-tool-surface', 'canvas.surface', 'canvas.interaction', 'canvas.selection', 'canvas.frames', 'canvas.tool-input'],
      commands,
    },
  };
  return { manifest, manifestText: `${JSON.stringify(manifest, null, 2)}\n`, bundle };
}

export async function writeInstallManifest() {
  const { manifest, manifestText } = await createInstallManifest();
  await writeFile(new URL('alid.extension.json', root), manifestText);
  return manifest;
}
