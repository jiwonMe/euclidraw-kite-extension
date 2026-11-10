import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import manifest from '../alid.extension.json';
import metadata from '../extension.json';

const root = new URL('../', import.meta.url);

describe('committed install bundle', () => {
  it('is one self-contained ESM file inside the installer limit', async () => {
    const bundle = await readFile(new URL('dist/plugin.js', root));
    expect(bundle.byteLength).toBeGreaterThan(10_000);
    expect(bundle.byteLength).toBeLessThan(2 * 1024 * 1024);
    const source = bundle.toString('utf8');
    expect(source).not.toMatch(/^\s*import\s+.*\s+from\s+['"]\.\//m);
    expect(source).not.toMatch(/document\.currentScript/);
    expect(source).not.toMatch(/new Function\(/);
  });

  it('matches the manifest hash and package contract', async () => {
    const bundle = await readFile(new URL('dist/plugin.js', root));
    const hash = createHash('sha256').update(bundle).digest('hex');
    expect(hash).toBe(manifest.sha256);
    expect(manifest.id).toBe(metadata.id);
    expect(manifest.version).toBe(metadata.version);
    expect(manifest.apiVersion).toBe(2);
    expect(manifest.entry).toBe('dist/plugin.js');
    expect(manifest.aspectIds).toEqual(['kite.scope', 'kite.member']);
    expect(manifest.capabilities.commands).toEqual(metadata.commands.map(name => `${metadata.id}:${name}`));
    expect(manifest.capabilities.writeAspects).toContain('kite.scope');
  });

  it('imports and exposes the same default spec the source declares', async () => {
    const module = await import(new URL(`dist/plugin.js?v=${Date.now()}`, root).href);
    const spec = module.default;
    expect(spec.id).toBe(metadata.id);
    expect(spec.version).toBe(metadata.version);
    expect(spec.engine).toBe(metadata.engine);
    expect(spec.provides.aspects).toEqual(['kite.scope', 'kite.member']);
    expect(typeof spec.activate).toBe('function');
    expect(spec.aspects.map((aspect: { id: string }) => aspect.id)).toEqual(['kite.scope', 'kite.member']);
  });

  it('keeps a realistic install size', async () => {
    const info = await stat(new URL('dist/plugin.js', root));
    expect(info.size).toBeLessThan(300 * 1024);
  });
});
