import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { validateConfig } from './validate-config.mjs';

export const root = new URL('../', import.meta.url);
export const ASPECT_IDS = ['penrose.scope', 'penrose.member'];

export async function readConfig() {
  return validateConfig(JSON.parse(await readFile(new URL('extension.json', root), 'utf8')));
}

/**
 * The install manifest for the single bundle in `outDir`. `build` commits it next
 * to dist/; `dev` keeps it in memory for an output directory that is never committed.
 */
export async function createInstallManifest(outDir = new URL('dist/', root)) {
  const metadata = await readConfig();
  const files = await readdir(outDir);
  if (files.length !== 1 || files[0] !== 'plugin.js') throw new Error('The installer expects one self-contained dist/plugin.js bundle.');
  const bundle = await readFile(new URL('plugin.js', outDir));
  const manifest = {
    apiVersion: 2,
    id: metadata.id,
    version: metadata.version,
    engine: metadata.engine,
    dependencies: { ...metadata.dependencies },
    optionalDependencies: { ...metadata.optionalDependencies },
    conflicts: [...metadata.conflicts],
    provides: { services: [...metadata.provides.services], aspects: [...ASPECT_IDS], hsmSlots: [...metadata.provides.hsmSlots] },
    title: metadata.title,
    summary: metadata.summary,
    entry: 'dist/plugin.js',
    sha256: createHash('sha256').update(bundle).digest('hex'),
    aspectIds: [...ASPECT_IDS],
    capabilities: {
      readAspects: [...ASPECT_IDS, 'core.transform', 'core.bounds', 'core.stacking', 'markdown.card', 'vector.path'],
      writeAspects: [...ASPECT_IDS, 'core.transform', 'core.bounds', 'core.stacking', 'markdown.card', 'vector.path'],
      services: ['canvas.active-tool-surface', 'canvas.frames', 'canvas.tool-input', 'canvas.surface', 'canvas.interaction', 'canvas.selection', 'ui.completingRead', 'ui.workbench'],
      commands: metadata.commands.map(name => `${metadata.id}:${name}`),
    },
  };
  return { manifest, manifestText: `${JSON.stringify(manifest, null, 2)}\n`, bundle };
}

export async function writeInstallManifest() {
  const { manifest, manifestText } = await createInstallManifest();
  await writeFile(new URL('alid.extension.json', root), manifestText);
  return manifest;
}
