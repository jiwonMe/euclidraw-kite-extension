// @vitest-environment jsdom
/**
 * The scope paints every Penrose shape as pure SVG: no `<foreignObject>`, no
 * `url()` references, no scripts. Text is escaped and math is path glyphs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

suite('headless SVG determinism (real SceneVectorCompiler)', () => {
  it('publishes circles, text, math paths and clips as pure vector', async () => {
    host = await startHost();
    await host.run('penrose.studio:insert-scope');
    await settle(host);
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).not.toMatch(/foreignObject|<script|url\(|javascript:/i);
    expect(svg).toContain('<circle');
    expect(svg).toContain('<text');
    // Equation labels are MathJax path glyphs, not DOM nodes.
    expect(svg).toContain('<path');
    expect(svg).toMatch(/Penrose × alid/);
  });

  it('escapes document strings', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const scope = host.world.getCanonical(scopeId, 'penrose.scope');
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      styleDsl: scope.styleDsl.replace('Penrose × alid', '<b>AB</b> & x'),
    });
    await settle(host);
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).toContain('&lt;b&gt;AB&lt;/b&gt; &amp; x');
    expect(svg).not.toContain('<b>AB</b>');
  });

  it('is byte-identical across runs and a reopened peer', async () => {
    host = await startHost();
    await host.run('penrose.studio:insert-scope');
    await settle(host);
    const first = host.compiler.compileToPureSvg(host.world);
    for (let frame = 0; frame < 4; frame++) host.paint();
    expect(host.compiler.compileToPureSvg(host.world)).toBe(first);
    const peer = await startHost();
    peer.world.replaceCanonicalSnapshot(host.wasm.get_canonical_json());
    await settle(peer);
    expect(peer.compiler.compileToPureSvg(peer.world)).toBe(first);
    peer.dispose();
  });

  it('shows a DSL error badge instead of geometry and never throws while exporting', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    // A remote peer wrote a broken Substance program.
    host.world.applyCanonicalTransaction('test:remote', [
      { id: scopeId, aspect: 'penrose.scope', patch: { substanceDsl: 'Point A\nNope(A)' } },
    ], 'remote:peer');
    await settle(host);
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).toContain('Penrose:');
    expect(svg).not.toMatch(/foreignObject/);
  });
});
