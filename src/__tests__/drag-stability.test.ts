// @vitest-environment jsdom
/**
 * A large staged diagram (computer architecture) must keep its layout while a
 * single component is dragged: only the dragged owner may move, arrow geometry
 * must stay on canvas, and the frame must not explode the energy.
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

suite('large diagram drag stability', () => {
  it('moves only the dragged component and keeps arrows on canvas', async () => {
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
    const before = componentCentres(host, scopeId);
    const energyBefore = layout(host, scopeId).energy;
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
    expect(Math.max(...others.map(entry => entry.distance))).toBeLessThan(5);
    expect(moved.find(entry => entry.owner === 'MAR')!.distance).toBeGreaterThan(80);
    for (const shape of layout(host, scopeId).shapes) {
      const points = shape.props.start ? [shape.props.start, shape.props.end] : (shape.props.points ?? []);
      for (const point of points as number[][]) {
        expect(Math.abs(point[0]!)).toBeLessThan(2000);
        expect(Math.abs(point[1]!)).toBeLessThan(2000);
      }
    }
    expect(layout(host, scopeId).energy).toBeLessThan(energyBefore * 8 + 1e6);
    expect(host.commits()).toBe(commits);
    host.pointer('pointerup', handle.x + 100, handle.y);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(host.commits()).toBe(commits + 1);
  }, 120_000);
});
