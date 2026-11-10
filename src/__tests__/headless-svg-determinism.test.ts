// @vitest-environment jsdom
/**
 * PRD §6 / §9.2 Phase 1: `SceneVectorCompiler.compileToPureSvg` publishes every
 * member as pure vector — no `<foreignObject>`, no `url()`, no script — in
 * `core.stacking` order, identically on screen and headless, and byte-stable
 * across runs and peers. Escapes every document string.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

suite('headless SVG determinism (real SceneVectorCompiler)', () => {
  it('publishes every primitive kind as pure vector', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    await host.run('kite.studio:apply-dsl', {
      entityId: scopeId,
      substanceDsl: `${host.world.getCanonical(scopeId, 'kite.scope').substanceDsl}
Line L = A .. Q
Ray R = O .. Q
Arc arc1 = center O r 40 from 200 to 340
Label labAB = "<b>AB</b> & \\"x\\"" at midpoint AB normal 14
Perpendicular(AP, PB)
EqualLength(AP, PB)
`,
    });
    await settle(host);
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).not.toMatch(/foreignObject|<script|url\(|javascript:/i);
    expect(svg).toContain('<circle');
    expect(svg).toContain('<path');
    expect(svg).toContain('<text');
    expect(svg).toContain('&lt;b&gt;AB&lt;/b&gt; &amp; &quot;x&quot;');
    // Right-angle square at P and equal-length ticks are paths too.
    const compiled = host.world.getComputed(scopeId, 'computed.kite.compiledVm');
    const kinds = new Set(compiled.order.map((id: string) => compiled.instances[id].kind));
    for (const kind of ['point', 'segment', 'line', 'ray', 'circle', 'arc', 'polygon', 'angle-mark', 'label-anchor']) expect(kinds.has(kind)).toBe(true);
    const fragments = host.compiler.collectFragments(host.world);
    const memberIds = new Set(Object.values(host.world.getCanonical(scopeId, 'kite.scope').entityBindings));
    const kite = fragments.filter((fragment: { id: string }) => memberIds.has(fragment.id));
    expect(kite.length).toBeGreaterThanOrEqual(compiled.order.length - 1);
    // Single z-axis: fragments are in paint-rank order; members sit above their scope.
    const ranks = fragments.map((fragment: { zOrder: number }) => fragment.zOrder);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const scopeRank = host.world.getPaintRank(scopeId);
    for (const fragment of kite) expect(fragment.zOrder).toBeGreaterThan(scopeRank);
  });

  it('is byte-identical across runs, a reopened peer, and after culling', async () => {
    host = await startHost();
    await host.run('kite.studio:insert-scope');
    await settle(host);
    const first = host.compiler.compileToPureSvg(host.world);
    for (let frame = 0; frame < 5; frame++) host.paint();
    expect(host.compiler.compileToPureSvg(host.world)).toBe(first);
    const peer = await startHost();
    peer.world.replaceCanonicalSnapshot(host.wasm.get_canonical_json());
    await settle(peer);
    expect(peer.compiler.compileToPureSvg(peer.world)).toBe(first);
    peer.dispose();
  });

  it('shows a DSL error badge instead of geometry, and never throws during export', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    // A remote peer wrote a broken DSL (the local editor would refuse to apply it).
    host.world.applyCanonicalTransaction('test:remote', [{ id: scopeId, aspect: 'kite.scope', patch: { substanceDsl: 'Point A = (0, 0)\nNope(A)' } }], 'remote:peer');
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).toContain('Kite:');
    expect(svg).not.toMatch(/foreignObject/);
  });
});
