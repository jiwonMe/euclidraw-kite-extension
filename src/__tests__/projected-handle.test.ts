// @vitest-environment jsdom
/**
 * Projected handles: a shape point that is not a direct input (here a 3D point
 * projected to 2D) is still draggable. The worker maps a 2D drag onto the free
 * inputs through the local Jacobian, then re-converges.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', name), 'utf8');
const wait = async (h: Host, ms = 25) => { await new Promise(resolve => setTimeout(resolve, ms)); h.paint(); };
const computed = (h: Host, scopeId: string) => h.world.getComputed(scopeId, 'computed.penrose.layout').computed as { x: number; y: number; id: string }[];

suite('projected handles', () => {
  it('exposes a handle for a computed point and drags it through its free inputs', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('projected.domain'),
      substanceDsl: fixture('projected.substance'),
      styleDsl: fixture('projected.style'),
    });
    await settle(host);
    host.select([scopeId]);
    host.paint();

    const handles = host.gizmoHandles();
    expect(handles).toHaveLength(1);
    expect(handles[0]!.id).toContain(':computed:');
    expect(computed(host, scopeId)).toHaveLength(1);
    const jsonlBefore = host.jsonl(), commitsBefore = host.commits();
    expect(host.press(handles[0]!.x, handles[0]!.y)).toBe(true);
    host.pointer('pointermove', handles[0]!.x + 30, handles[0]!.y - 20);
    await wait(host, 250);
    expect(host.commits()).toBe(commitsBefore);
    expect(host.jsonl()).toBe(jsonlBefore);
    // The handle's world position follows the pointer (screen == world here).
    const during = host.gizmoHandles()[0]!;
    expect(Math.abs(during.x - (handles[0]!.x + 30))).toBeLessThan(1.5);
    expect(Math.abs(during.y - (handles[0]!.y - 20))).toBeLessThan(1.5);

    host.pointer('pointerup', handles[0]!.x + 30, handles[0]!.y - 20);
    await wait(host, 500);
    expect(host.commits()).toBe(commitsBefore + 1);
    const moved = host.gizmoHandles()[0]!;
    expect(Math.hypot(moved.x - handles[0]!.x, moved.y - handles[0]!.y)).toBeGreaterThan(20);

    expect(host.undo()).toBe(true);
    await wait(host, 80);
    const restored = host.gizmoHandles()[0]!;
    expect(Math.hypot(restored.x - handles[0]!.x, restored.y - handles[0]!.y)).toBeLessThan(1e-3);
  });

  it('drags a projected 3D vertex in the perspective triangle example', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('tri3d.domain'),
      substanceDsl: fixture('tri3d.substance'),
      styleDsl: fixture('tri3d.style'),
    });
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const handles = host.gizmoHandles();
    expect(handles.length).toBeGreaterThanOrEqual(10);
    const vertex = handles.find(handle => handle.id.includes('`t`.icon|points|0'));
    expect(vertex).toBeTruthy();
    const before = { x: vertex!.x, y: vertex!.y };
    const commits = host.commits();
    expect(host.press(before.x, before.y)).toBe(true);
    host.pointer('pointermove', before.x + 20, before.y + 10);
    await wait(host, 500);
    expect(host.commits()).toBe(commits);
    const during = host.gizmoHandles().find(handle => handle.id === vertex!.id)!;
    expect(Math.abs(during.x - (before.x + 20))).toBeLessThan(1.5);
    expect(Math.abs(during.y - (before.y + 10))).toBeLessThan(1.5);
    host.pointer('pointerup', before.x + 20, before.y + 10);
    await wait(host, 500);
    expect(host.commits()).toBe(commits + 1);
    expect(host.undo()).toBe(true);
    await wait(host, 80);
    const restored = host.gizmoHandles().find(handle => handle.id === vertex!.id)!;
    expect(Math.hypot(restored.x - before.x, restored.y - before.y)).toBeLessThan(1e-3);
  });
});
