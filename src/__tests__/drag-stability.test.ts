// @vitest-environment jsdom
/**
 * A large staged diagram (computer architecture) must keep a valid layout while
 * a single component is dragged. Penrose only optimizes the *current* stage, so
 * dragging from the final (arrow) stage used to skip the `disjoint` constraints
 * in the geometry stage and the dragged shape ploughed through its neighbours.
 * The drag stage unions both stages: neighbours move aside instead of
 * overlapping, arrows stay on canvas, and the frame must not explode the energy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', name), 'utf8');
const layout = (h: Host, scopeId: string) => h.world.getComputed(scopeId, 'computed.penrose.layout');
function componentCentres(h: Host, scopeId: string) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const shape of layout(h, scopeId).shapes) {
    if (shape.owner && shape.shapeType === 'Circle') {
      const [x, y] = shape.props.center as number[];
      out[shape.owner] = { x: x!, y: y! };
    }
  }
  return out;
}
/** Overlapping component boxes (gap < 0), as owner pairs. */
function overlaps(h: Host, scopeId: string) {
  const rects = layout(h, scopeId).shapes.filter(
    (shape: { owner?: string; shapeType: string }) => shape.owner && shape.shapeType === 'Rectangle',
  );
  const pairs: string[] = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      const ax = (a.props.center as number[])[0]!, ay = (a.props.center as number[])[1]!;
      const bx = (b.props.center as number[])[0]!, by = (b.props.center as number[])[1]!;
      const gapX = Math.max(0, Math.abs(ax - bx) - ((a.props.width as number) + (b.props.width as number)) / 2);
      const gapY = Math.max(0, Math.abs(ay - by) - ((a.props.height as number) + (b.props.height as number)) / 2);
      if (Math.hypot(gapX, gapY) < 0.5) pairs.push(`${a.owner}/${b.owner}`);
    }
  }
  return pairs;
}

suite('large diagram drag stability', () => {
  it('reflows neighbours instead of overlapping them', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('sys.domain'),
      substanceDsl: fixture('sys.substance'),
      styleDsl: fixture('sys.style'),
    });
    await settle(host);
    // A canvas change resizes the scope box so the diagram is not squeezed.
    const bounds = host.world.getCanonical(scopeId, 'core.bounds');
    expect(bounds.width).toBeCloseTo(1000, 0);
    expect(bounds.height).toBeCloseTo(1000, 0);
    host.select([scopeId]);
    host.paint();
    const before = componentCentres(host, scopeId);
    const commits = host.commits();
    const handle = host.gizmoHandles().find(entry => entry.id.includes('`MAR`.icon'))!;
    expect(handle).toBeTruthy();
    expect(host.press(handle.x, handle.y)).toBe(true);
    for (let step = 1; step <= 4; step++) {
      host.pointer('pointermove', handle.x + step * 25, handle.y);
      await new Promise(resolve => setTimeout(resolve, 200));
      host.paint();
    }
    const after = componentCentres(host, scopeId);
    const moved = Object.entries(before).map(([owner, start]) => ({
      owner,
      distance: Math.hypot(after[owner]!.x - start.x, after[owner]!.y - start.y),
    }));
    const others = moved.filter(entry => entry.owner !== 'MAR');
    expect(moved.find(entry => entry.owner === 'MAR')!.distance).toBeGreaterThan(80);
    // Neighbours make room for the dragged box, but must not be flung across
    // the canvas.
    expect(Math.max(...others.map(entry => entry.distance))).toBeLessThan(300);
    expect(overlaps(host, scopeId)).toEqual([]);
    for (const shape of layout(host, scopeId).shapes) {
      const points = shape.props.start ? [shape.props.start, shape.props.end] : (shape.props.points ?? []);
      for (const point of points as number[][]) {
        expect(Math.abs(point[0]!)).toBeLessThan(2000);
        expect(Math.abs(point[1]!)).toBeLessThan(2000);
      }
    }
    // The drag stage carries the geometry penalties, so energy is not comparable
    // across stages; keep the diagram inside its canvas instead.
    for (const centre of Object.values(after)) {
      expect(Math.abs(centre.x)).toBeLessThan(700);
      expect(Math.abs(centre.y)).toBeLessThan(700);
    }
    expect(host.commits()).toBe(commits);
    host.pointer('pointerup', handle.x + 100, handle.y);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(host.commits()).toBe(commits + 1);
    expect(overlaps(host, scopeId)).toEqual([]);
  }, 120_000);

  it('drag a tall bus without crushing the layout', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('sys.domain'),
      substanceDsl: fixture('sys.substance'),
      styleDsl: fixture('sys.style'),
    });
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const handle = host.gizmoHandles().find(entry => entry.id.includes('`BUS`.icon'))!;
    expect(handle).toBeTruthy();
    expect(host.press(handle.x, handle.y)).toBe(true);
    for (let step = 1; step <= 4; step++) {
      host.pointer('pointermove', handle.x + step * 30, handle.y - step * 15);
      await new Promise(resolve => setTimeout(resolve, 200));
      host.paint();
      expect(overlaps(host, scopeId)).toEqual([]);
    }
    host.pointer('pointerup', handle.x + 120, handle.y - 60);
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(overlaps(host, scopeId)).toEqual([]);
  }, 180_000);
});
