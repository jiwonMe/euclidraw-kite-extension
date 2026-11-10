// @vitest-environment jsdom
/**
 * Re-convergence must happen on every drag frame, not only the first: once the
 * optimizer reports EPConverged, `step` is a no-op until its params restart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', name), 'utf8');

function layout(h: Host, scopeId: string) {
  return h.world.getComputed(scopeId, 'computed.penrose.layout');
}
function centre(h: Host, scopeId: string, owner: string) {
  const shape = layout(h, scopeId).shapes.find((entry: { owner?: string; shapeType: string }) => entry.owner === owner && entry.shapeType === 'Circle');
  const [x, y] = (shape as { props: { center: number[] } }).props.center;
  return { x: x!, y: y! };
}
const label = (h: Host, scopeId: string, owner: string) => {
  const shape = layout(h, scopeId).shapes.find((entry: { owner?: string; shapeType: string }) => entry.owner === owner && entry.shapeType === 'Text');
  const [x, y] = (shape as { props: { center: number[] } }).props.center;
  return { x: x!, y: y! };
};
const distance = (h: Host, scopeId: string) => {
  const a = centre(h, scopeId, 'a'), b = centre(h, scopeId, 'b');
  return Math.hypot(a.x - b.x, a.y - b.y);
};

suite('per-frame drag convergence', () => {
  it('keeps a distance constraint satisfied on every pointermove', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('distance.domain'),
      substanceDsl: fixture('distance.substance'),
      styleDsl: fixture('distance.style'),
    });
    await settle(host);
    expect(Math.abs(distance(host, scopeId) - 100)).toBeLessThan(1);

    host.select([scopeId]);
    host.paint();
    const handle = host.gizmoHandles().find(entry => entry.id.includes(':move:`a`.icon'))!;
    expect(host.press(handle.x, handle.y)).toBe(true);
    for (let step = 1; step <= 5; step++) {
      host.pointer('pointermove', handle.x + step * 8, handle.y);
      await new Promise(resolve => setTimeout(resolve, 60));
      host.paint();
      expect(Math.abs(distance(host!, scopeId) - 100), `frame ${step}`).toBeLessThan(1);
    }
    // Release: a full re-convergence hardens the softened drag state.
    const beforeEnergy = layout(host, scopeId).energy;
    const beforeDrop = centre(host, scopeId, 'a');
    host.pointer('pointerup', handle.x + 40, handle.y);
    await new Promise(resolve => setTimeout(resolve, 400));
    host.paint();
    const afterEnergy = layout(host, scopeId).energy;
    expect(afterEnergy).toBeLessThan(beforeEnergy);
    expect(Math.abs(distance(host, scopeId) - 100)).toBeLessThan(1);
    const afterDrop = centre(host, scopeId, 'a');
    // Polish must not visibly snap the dropped object away from the pointer.
    expect(Math.hypot(afterDrop.x - beforeDrop.x, afterDrop.y - beforeDrop.y)).toBeLessThan(2);
  });

  it('keeps AutoLabel positions live during a drag', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('graph.domain'),
      substanceDsl: fixture('graph.substance'),
      styleDsl: fixture('graph.style'),
    });
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const before = label(host, scopeId, 'Chicago');
    const handle = host.gizmoHandles().find(entry => entry.id.includes(':move:`Chicago`.dot'))!;
    const commits = host.commits();
    expect(host.press(handle.x, handle.y)).toBe(true);
    for (let step = 1; step <= 4; step++) {
      host.pointer('pointermove', handle.x + step * 10, handle.y);
      await new Promise(resolve => setTimeout(resolve, 80));
      host.paint();
    }
    const during = label(host, scopeId, 'Chicago');
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(5);
    expect(host.commits()).toBe(commits);
    host.pointer('pointerup', handle.x + 40, handle.y);
    await new Promise(resolve => setTimeout(resolve, 120));
  });
});
