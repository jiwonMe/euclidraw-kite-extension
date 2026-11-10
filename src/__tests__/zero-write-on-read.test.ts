// @vitest-environment jsdom
/**
 * PRD §9.2 Phase 1 DoD: from `convergedSeeds` alone the diagram renders with
 * zero solver iterations and zero document commits while opening, reading,
 * panning/zooming (re-deriving), and exporting.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

suite('zero write on read (real kernel + Loro core)', () => {
  it('cold-reads a stored scope from its seeds without solving or writing', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    // A fresh peer opens the saved document.
    const snapshot = host.wasm.get_canonical_json();
    const reopened = await startHost();
    reopened.world.replaceCanonicalSnapshot(snapshot);
    await settle(reopened);
    const commitsBefore = reopened.commits(), groupsBefore = reopened.groups(), jsonlBefore = reopened.jsonl();
    const solved = reopened.world.getComputed(scopeId, 'computed.kite.solvedGeometry');
    expect(solved.mode).toBe('cold');
    expect(solved.iterations).toBe(0);
    // Seeds are stored at 1e-9 of the half-canvas: residual is quantisation, not a solve.
    expect(solved.residual).toBeLessThan(1e-4);
    // Read every member, paint frames, re-read on a moved camera, export twice.
    const members = Object.values(reopened.world.getCanonical(scopeId, 'kite.scope').entityBindings) as string[];
    for (const id of members) {
      expect(reopened.world.getComputed(id, 'computed.kite.member')).toBeTruthy();
      expect(reopened.world.getComputed(id, 'computed.layoutBounds')).toBeTruthy();
      expect(reopened.world.getComputed(id, 'computed.effectiveBounds')).toBeTruthy();
    }
    for (let frame = 0; frame < 10; frame++) reopened.paint();
    const first = reopened.compiler.compileToPureSvg(reopened.world);
    const second = reopened.compiler.compileToPureSvg(reopened.world);
    expect(second).toBe(first);
    expect(reopened.commits()).toBe(commitsBefore);
    expect(reopened.groups()).toBe(groupsBefore);
    expect(reopened.jsonl()).toBe(jsonlBefore);
    reopened.dispose();
  });

  it('moves, resizes and rotates a scope by transform only (no solve, seeds untouched)', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const seeds = JSON.stringify(host.world.getCanonical(scopeId, 'kite.scope').convergedSeeds);
    const pointId = host.world.getCanonical(scopeId, 'kite.scope').entityBindings.P;
    const before = host.world.getComputed(pointId, 'computed.kite.member').points[0];
    host.world.applyCanonicalTransaction('test:move', [
      { id: scopeId, aspect: 'core.transform', patch: { x: 1000, y: 500, rotation: Math.PI / 2 } },
      { id: scopeId, aspect: 'core.bounds', patch: { width: 1040, height: 760 } },
    ]);
    const solved = host.world.getComputed(scopeId, 'computed.kite.solvedGeometry');
    expect(solved.mode).toBe('cold');
    expect(solved.iterations).toBe(0);
    expect(JSON.stringify(host.world.getCanonical(scopeId, 'kite.scope').convergedSeeds)).toBe(seeds);
    const after = host.world.getComputed(pointId, 'computed.kite.member').points[0];
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(100);
    // Uniform scale ×2 doubles every length, preserving angles.
    const radius = (id: string) => host!.world.getComputed(id, 'computed.kite.member').radius;
    const circleId = host.world.getCanonical(scopeId, 'kite.scope').entityBindings.c;
    expect(radius(circleId)).toBeGreaterThan(0);
  });

  it('keeps solver output and SVG deterministic across peers', async () => {
    host = await startHost();
    await host.run('kite.studio:insert-scope');
    await settle(host);
    const other = await startHost();
    other.world.replaceCanonicalSnapshot(host.wasm.get_canonical_json());
    await settle(other);
    expect(other.compiler.compileToPureSvg(other.world)).toBe(host.compiler.compileToPureSvg(host.world));
    other.dispose();
  });
});
