// @vitest-environment jsdom
/**
 * Gizmos are an affordance for the current selection: nothing selected means
 * no handles; a selected scope shows every free input in it; a selected member
 * shows only that owner. Pinned inputs and read-only scopes stay without one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const bindings = (h: Host, scopeId: string) => h.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>;
const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', name), 'utf8');
const center = (h: Host, memberId: string) => {
  const box = h.world.getComputed(memberId, 'computed.penrose.member');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const dots = (h: Host) => h.hud.querySelectorAll('[data-role="penrose-gizmos"] circle').length;
const boxes = (h: Host) => h.hud.querySelectorAll('[data-role="penrose-gizmos"] rect').length;

suite('selection-scoped gizmos', () => {
  it('shows nothing without a selection, everything for a scope, one for a member', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([]);
    host.paint();
    expect(host.gizmoHandles()).toHaveLength(0);
    expect(dots(host)).toBe(0);

    host.select([scopeId]);
    host.paint();
    expect(host.gizmoHandles().map(handle => handle.id).sort()).toEqual([
      `penrose:${scopeId}:move:\`A\`.icon`,
      `penrose:${scopeId}:move:\`B\`.icon`,
      `penrose:${scopeId}:move:\`C\`.icon`,
      `penrose:${scopeId}:move:\`c\`.icon`,
    ]);
    expect(dots(host)).toBe(4);
    for (const handle of host.gizmoHandles()) expect(host.hitTest(handle.x, handle.y)).toBe(true);

    host.select([bindings(host, scopeId).A!]);
    host.paint();
    expect(host.gizmoHandles().map(handle => handle.id)).toEqual([`penrose:${scopeId}:move:\`A\`.icon`]);
    expect(dots(host)).toBe(1);
    const point = center(host, bindings(host, scopeId).A!);
    expect(host.hitTest(point.x, point.y)).toBe(true);
  });

  it('shows every free vertex of the staged multigraph when its scope is selected', async () => {
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
    const handles = host.gizmoHandles();
    // Seven vertices, each with a free dot centre and a free label centre.
    expect(handles.length).toBe(14);
    expect(dots(host) + boxes(host)).toBe(14);
    // Labels are outlined boxes; the dot carries a round grip.
    expect(boxes(host)).toBe(7);
    expect(dots(host)).toBe(7);
    for (const handle of handles) expect(host.hitTest(handle.x, handle.y)).toBe(true);

    host.select([bindings(host, scopeId).Chicago!]);
    host.paint();
    expect(host.gizmoHandles().length).toBe(2);
    expect(dots(host) + boxes(host)).toBe(2);
  });

  it('uses a box gizmo for text and a round one for points', async () => {
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
    const registry = (host.gizmos as { handles?: { id: string; shape: string; radiusScreenPx?: number; widthScreenPx?: number; heightScreenPx?: number }[] }).handles ?? [];
    const text = registry.find(handle => handle.id.includes(':move:`Chicago`.text'));
    const dot = registry.find(handle => handle.id.includes(':move:`Chicago`.dot'));
    expect(text?.shape).toBe('rect');
    expect(dot?.shape).toBe('circle');
    // The box tracks the label extent: wider than tall, and padded.
    expect(text!.widthScreenPx!).toBeGreaterThan(text!.heightScreenPx!);
    expect(text!.widthScreenPx!).toBeGreaterThan(20);
    // The HUD paints exactly one dashed outline for it.
    expect(host.hud.querySelectorAll('[data-role="penrose-gizmos"] rect').length).toBe(7);
  });

  it('keeps handles aligned when the selected scope moves', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const handleOf = () => host!.gizmoHandles().find(handle => handle.id.includes(':move:`A`.icon'))!;
    const before = handleOf();
    host.world.applyCanonicalTransaction('test:move', [
      { id: scopeId, aspect: 'core.transform', patch: { x: 800, y: 400, rotation: 0 } },
    ]);
    host.paint();
    const after = handleOf();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(300);
    expect(host.hitTest(after.x, after.y)).toBe(true);
    expect(host.hitTest(before.x, before.y)).toBe(false);
  });

  it('follows the scope transform previewed by the host drag', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const handleOf = () => host!.gizmoHandles().find(handle => handle.id.includes(':move:`A`.icon'))!;
    const before = handleOf();
    // select-suite moves a scope through a scene ScratchOverlay until release.
    const scratch = host.world.createScratchOverlay('test:scope-drag');
    scratch.set(scopeId, 'core.transform', { x: 900, y: 500, rotation: 0 });
    host.paint();
    const during = handleOf();
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(300);
    expect(host.hitTest(during.x, during.y)).toBe(true);
    scratch.dispose();
    host.paint();
    const after = handleOf();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });

  it('paints handles in HUD-local coordinates, not client coordinates', async () => {
    host = await startHost({ clientOffset: { x: 120, y: 80 } });
    const rect = { x: 120, y: 80, left: 120, top: 80, right: 920, bottom: 680, width: 800, height: 600, toJSON: () => ({}) } as DOMRect;
    host.hud.getBoundingClientRect = () => rect;
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([scopeId]);
    host.paint();
    const handles = host.gizmoHandles();
    const circles = [...host.hud.querySelectorAll('[data-role="penrose-gizmos"] circle')];
    expect(circles.length).toBe(handles.length);
    for (const circle of circles) {
      const x = Number(circle.getAttribute('cx'));
      expect(handles.some(handle => Math.abs(handle.x - x) < 0.6)).toBe(true);
    }
  });

  it('moves the dragged handle with the pointer before the worker answers', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([bindings(host, scopeId).A!]);
    host.paint();
    const handle = host.gizmoHandles()[0]!;
    expect(host.press(handle.x, handle.y)).toBe(true);
    host.pointer('pointermove', handle.x + 40, handle.y + 20);
    await new Promise(resolve => setTimeout(resolve, 250));
    host.paint();
    const circle = host.hud.querySelector('[data-role="penrose-gizmos"] circle')!;
    const x = Number(circle.getAttribute('cx'));
    const y = Number(circle.getAttribute('cy'));
    expect(Math.abs(x - (handle.x + 40))).toBeLessThan(0.6);
    expect(Math.abs(y - (handle.y + 20))).toBeLessThan(0.6);
    host.pointer('pointerup', handle.x + 40, handle.y + 20);
    await new Promise(resolve => setTimeout(resolve, 600));
    await settle(host);
  });

  it('hides the handle of a pinned object and restores it when unpinned', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const a = bindings(host, scopeId).A!;
    const b = bindings(host, scopeId).B!;
    host.select([scopeId]);
    host.paint();
    const pa = center(host, a), pb = center(host, b);
    expect(host.hitTest(pa.x, pa.y)).toBe(true);
    expect(host.hitTest(pb.x, pb.y)).toBe(true);

    host.select([a]);
    await host.run('penrose.studio:toggle-pin');
    host.paint();
    expect(host.hitTest(pa.x, pa.y)).toBe(false);
    expect(dots(host)).toBe(0);

    host.select([b]);
    host.paint();
    expect(host.hitTest(pb.x, pb.y)).toBe(true);

    host.select([a]);
    await host.run('penrose.studio:toggle-pin');
    host.paint();
    expect(host.hitTest(pa.x, pa.y)).toBe(true);
  });
});
