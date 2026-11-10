// @vitest-environment jsdom
/**
 * Angle gizmo: a derived Line tip whose dominant response to a free input is a
 * rotation gets a second grip that rotates around the opposite endpoint. This
 * is detected from the Jacobian, not from the style, so any diagram with
 * angle-driven arrows (rays, normals, …) gets it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const ray = (name: string) => readFileSync(`/tmp/penrose/packages/examples/src/ray-tracing/${name}`, 'utf8');

async function openRayScene(): Promise<{ host: Host; scopeId: string }> {
  const h = await startHost();
  const scopeId = await h.run<string>('penrose.studio:insert-scope');
  await settle(h);
  await h.run('penrose.studio:apply-dsl', {
    scopeId,
    domainDsl: ray('ray-tracing.domain'),
    substanceDsl: ray('path-trace.substance'),
    styleDsl: ray('ray-tracing.style'),
  });
  await new Promise(resolve => setTimeout(resolve, 6000));
  h.select([scopeId]);
  h.paint();
  return { host: h, scopeId };
}

suite('angle gizmo', () => {
  it('exposes a rotation grip for angle-driven rays but not for translations', async () => {
    const opened = await openRayScene();
    host = opened.host;
    const ids = host.gizmoHandles().map(handle => handle.id);
    expect(ids.some(id => id.includes(':rotate:`r1`.icon|end|0'))).toBe(true);
    expect(ids.some(id => id.includes(':rotate:16:0.normalArrow|end|0'))).toBe(true);
    // The camera's viewfinder is a rigid offset of a free point: no angle grip.
    expect(ids.some(id => id.includes(':rotate:10:0.viewfinder|center|0'))).toBe(false);
  }, 180_000);

  it('rotates the ray without moving its origin or changing its length', async () => {
    const opened = await openRayScene();
    host = opened.host;
    const { scopeId } = opened;
    const endId = '`r1`.icon|end|0';
    const startId = '`r1`.icon|start|0';
    const layout = () => host!.world.getComputed(scopeId, 'computed.penrose.layout');
    const handleAt = (id: string) => layout().computed.find((handle: { id: string }) => handle.id === id);

    const world = (suffix: string) => host!.gizmoHandles().find(handle => handle.id.includes(suffix))!;
    const point0 = world(`:computed:${endId}`);
    const grip0 = world(`:rotate:${endId}`);
    // The rotation pivot is the far end of the segment; the grip is its midpoint.
    const pivot = { x: 2 * grip0.x - point0.x, y: 2 * grip0.y - point0.y };
    const vector = { x: point0.x - pivot.x, y: point0.y - pivot.y };
    const radius = Math.hypot(vector.x, vector.y);
    const angle = Math.atan2(vector.y, vector.x);
    const origin0 = world(`:computed:${startId}`);

    expect(host.press(grip0.x, grip0.y)).toBe(true);
    host.pointer('pointermove', pivot.x + radius * Math.cos(angle + 0.5), pivot.y + radius * Math.sin(angle + 0.5));
    await new Promise(resolve => setTimeout(resolve, 600));
    host.paint();

    const point1 = world(`:computed:${endId}`);
    const grip1 = world(`:rotate:${endId}`);
    const pivot1 = { x: 2 * grip1.x - point1.x, y: 2 * grip1.y - point1.y };
    const angle1 = Math.atan2(point1.y - pivot1.y, point1.x - pivot1.x);
    expect(Math.abs(angle1 - angle - 0.5)).toBeLessThan(0.12);
    expect(Math.hypot(point1.x - pivot1.x, point1.y - pivot1.y)).toBeCloseTo(radius, 0);
    const origin1 = world(`:computed:${startId}`);
    expect(Math.hypot(origin1.x - origin0.x, origin1.y - origin0.y)).toBeLessThan(0.5);

    const commits = host.commits();
    host.pointer('pointerup', point1.x, point1.y);
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(host.commits()).toBe(commits + 1);
    // Release must keep the angle instead of snapping back.
    const point2 = world(`:computed:${endId}`);
    const grip2 = world(`:rotate:${endId}`);
    const pivot2 = { x: 2 * grip2.x - point2.x, y: 2 * grip2.y - point2.y };
    const angle2 = Math.atan2(point2.y - pivot2.y, point2.x - pivot2.x);
    expect(Math.abs(angle2 - angle - 0.5)).toBeLessThan(0.12);
    expect(handleAt(endId)).toBeTruthy();
  }, 180_000);
});
