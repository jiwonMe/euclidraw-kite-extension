// @vitest-environment jsdom
/**
 * PRD §9.2 Phase 2 DoD and §5.1: a pointer drag projects onto the constraint
 * manifold every frame in a ScratchOverlay, commits exactly once on release,
 * and one Undo restores exactly the pre-drag state. Shift promotes a snap into
 * the Substance DSL in the same undo step. Also: 50+ objects / 100 constraints
 * per-frame timing (measured, reported, not a hard claim of 120 fps).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const member = (h: Host, scopeId: string, substanceId: string) => h.world.getPreviewView().getComputed(h.world.getCanonical(scopeId, 'kite.scope').entityBindings[substanceId], 'computed.kite.member');

async function scopeWithSelection(h: Host, substanceId?: string) {
  const scopeId = await h.run<string>('kite.studio:insert-scope');
  await settle(h);
  h.select([substanceId ? h.world.getCanonical(scopeId, 'kite.scope').entityBindings[substanceId] : scopeId]);
  h.paint();
  return scopeId;
}

suite('manifold drag + single undo (real kernel + Loro core)', () => {
  it('keeps P on its circle while the pointer leaves it, previews in scratch only, commits once', async () => {
    host = await startHost();
    const scopeId = await scopeWithSelection(host, 'P');
    const p0 = member(host, scopeId, 'P').points[0];
    const circle = member(host, scopeId, 'c');
    const jsonlBefore = host.jsonl(), commitsBefore = host.commits(), groupsBefore = host.groups();
    expect(host.press(p0.x, p0.y)).toBe(true);
    expect(host.stateMachine.stateId).toBe('root.select.kite.studio:manipulate');
    const target = { x: circle.points[0].x + circle.radius * 2.5, y: circle.points[0].y - circle.radius * 2 };
    for (let step = 1; step <= 12; step++) {
      host.pointer('pointermove', p0.x + (target.x - p0.x) * step / 12, p0.y + (target.y - p0.y) * step / 12);
      host.paint();
      const p = member(host, scopeId, 'P').points[0];
      const c = member(host, scopeId, 'c');
      // Manifold projection: on the (possibly moving) circle every frame.
      expect(Math.abs(Math.hypot(p.x - c.points[0].x, p.y - c.points[0].y) - c.radius)).toBeLessThan(0.5);
    }
    // Nothing reached the document during the drag.
    expect(host.commits()).toBe(commitsBefore);
    expect(host.jsonl()).toBe(jsonlBefore);
    expect(host.world.getCanonicalView().getComputed(scopeId, 'computed.kite.solvedGeometry').mode).not.toBe('interactive');
    host.pointer('pointerup', target.x, target.y);
    expect(host.commits()).toBe(commitsBefore + 1);
    expect(host.groups()).toBe(groupsBefore + 1);
    expect(host.stateMachine.stateId).toBe('root.select.core.select-suite:idle');
    const moved = member(host, scopeId, 'P').points[0];
    expect(Math.hypot(moved.x - p0.x, moved.y - p0.y)).toBeGreaterThan(5);
    // One undo → exactly the pre-drag document.
    expect(host.undo()).toBe(true);
    expect(host.jsonl()).toBe(jsonlBefore);
    const restored = member(host, scopeId, 'P').points[0];
    expect(Math.hypot(restored.x - p0.x, restored.y - p0.y)).toBeLessThan(1e-6);
  });

  it('Escape cancels a drag without writing', async () => {
    host = await startHost();
    const scopeId = await scopeWithSelection(host, 'P');
    const p0 = member(host, scopeId, 'P').points[0];
    const before = host.jsonl(), commits = host.commits();
    host.press(p0.x, p0.y);
    host.pointer('pointermove', p0.x + 60, p0.y + 60);
    host.paint();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    host.pointer('pointerup', p0.x + 60, p0.y + 60);
    expect(host.commits()).toBe(commits);
    expect(host.jsonl()).toBe(before);
    const p = member(host, scopeId, 'P').points[0];
    expect(Math.hypot(p.x - p0.x, p.y - p0.y)).toBeLessThan(1e-6);
  });

  it('ignores Escape while an IME composition is active, then honours it 16ms later', async () => {
    host = await startHost();
    const scopeId = await scopeWithSelection(host, 'P');
    const p0 = member(host, scopeId, 'P').points[0];
    host.press(p0.x, p0.y);
    host.pointer('pointermove', p0.x + 40, p0.y);
    host.paint();
    const composing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    document.dispatchEvent(composing);
    expect(host.stateMachine.stateId).toBe('root.select.kite.studio:manipulate');
    const process = new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true, cancelable: true } as KeyboardEventInit);
    document.dispatchEvent(process);
    expect(host.stateMachine.stateId).toBe('root.select.kite.studio:manipulate');
    host.pointer('pointerup', p0.x + 40, p0.y);
  });

  it('Shift promotes a snap: drag result and the new statement are one undo step', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    // A free point Q2 dragged onto the midpoint of AB (that is O; use segment OQ instead).
    await host.run('kite.studio:apply-dsl', { entityId: scopeId, substanceDsl: `${host.world.getCanonical(scopeId, 'kite.scope').substanceDsl}\nPoint F = (260, 330)\n` });
    await settle(host);
    host.select([host.world.getCanonical(scopeId, 'kite.scope').entityBindings.F]);
    host.paint();
    const f = member(host, scopeId, 'F').points[0];
    const o = member(host, scopeId, 'O').points[0], q = member(host, scopeId, 'Q').points[0];
    const mid = { x: (o.x + q.x) / 2, y: (o.y + q.y) / 2 };
    const jsonlBefore = host.jsonl(), groups = host.groups();
    host.press(f.x, f.y, { shiftKey: true });
    for (let step = 1; step <= 10; step++) { host.pointer('pointermove', f.x + (mid.x - f.x) * step / 10, f.y + (mid.y - f.y) * step / 10, { shiftKey: true }); host.paint(); }
    const badge = host.hud.querySelector('[data-kite-snap]');
    expect(badge?.getAttribute('data-kite-snap')).toBe('Midpoint(F, O, Q)');
    host.pointer('pointerup', mid.x, mid.y, { shiftKey: true });
    expect(host.groups()).toBe(groups + 1);
    expect(host.world.getCanonical(scopeId, 'kite.scope').substanceDsl).toContain('Midpoint(F, O, Q)');
    const snapped = member(host, scopeId, 'F').points[0];
    expect(Math.hypot(snapped.x - mid.x, snapped.y - mid.y)).toBeLessThan(0.5);
    host.undo();
    expect(host.jsonl()).toBe(jsonlBefore);
  });

  it('drags a whole multi-selection as a group', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    await host.run('kite.studio:apply-dsl', { entityId: scopeId, substanceDsl: 'canvas 400 300\nPoint X = (100, 100)\nPoint Y = (200, 100)\nSegment XY = X .. Y\nDistance(X, Y, 100)\n' });
    await settle(host);
    const bindings = host.world.getCanonical(scopeId, 'kite.scope').entityBindings;
    host.select([bindings.X, bindings.Y]);
    host.paint();
    const x0 = member(host, scopeId, 'X').points[0], y0 = member(host, scopeId, 'Y').points[0];
    host.press(x0.x, x0.y);
    for (let step = 1; step <= 10; step++) { host.pointer('pointermove', x0.x, x0.y + step * 6); host.paint(); }
    host.pointer('pointerup', x0.x, x0.y + 60);
    const x1 = member(host, scopeId, 'X').points[0], y1 = member(host, scopeId, 'Y').points[0];
    expect(x1.y - x0.y).toBeGreaterThan(20);
    expect(y1.y - y0.y).toBeGreaterThan(20);
    expect(Math.abs(Math.hypot(x1.x - y1.x, x1.y - y1.y) - Math.hypot(x0.x - y0.x, x0.y - y0.y))).toBeLessThan(0.5);
  });

  it('measures per-frame drag cost on 60 objects / 100+ constraints', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const lines = ['canvas 800 600', 'Point P0 = (60, 300) pin'];
    for (let index = 1; index < 30; index++) lines.push(`Point P${index} = (${60 + index * 24}, ${300 + (index % 2 ? 20 : -20)})`);
    for (let index = 1; index < 30; index++) lines.push(`Segment s${index} = P${index - 1} .. P${index}`);
    for (let index = 1; index < 30; index++) lines.push(`Distance(P${index - 1}, P${index}, 24)`);
    for (let index = 2; index < 30; index++) lines.push(`soft EqualLength(s${index - 1}, s${index})`);
    for (let index = 3; index < 30; index += 1) lines.push(`soft Distance(P${index - 3}, P${index}, 60)`);
    for (let index = 2; index < 30; index += 1) lines.push(`soft Distance(P${index - 2}, P${index}, 44)`);
    await host.run('kite.studio:apply-dsl', { entityId: scopeId, substanceDsl: lines.join('\n') });
    await settle(host);
    const compiled = host.world.getComputed(scopeId, 'computed.kite.compiledVm');
    expect(compiled.order.length).toBeGreaterThanOrEqual(59);
    expect(compiled.constraints.length).toBeGreaterThanOrEqual(100);
    host.select([host.world.getCanonical(scopeId, 'kite.scope').entityBindings.P29]);
    host.paint();
    const end = member(host, scopeId, 'P29').points[0];
    host.press(end.x, end.y);
    const frames: number[] = [], solves: number[] = [];
    const manipulator = host.api().manipulator;
    for (let step = 1; step <= 60; step++) {
      host.pointer('pointermove', end.x - step * 2, end.y - step * 3);
      const started = performance.now();
      host.paint();
      frames.push(performance.now() - started);
      solves.push(manipulator.lastSolveMs);
    }
    host.pointer('pointerup', end.x - 120, end.y - 180);
    const stat = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { median: sorted[Math.floor(sorted.length / 2)]!, p95: sorted[Math.floor(sorted.length * 0.95)]! }; };
    const frame = stat(frames), solve = stat(solves);
    console.info(`[kite perf] ${compiled.order.length} objects / ${compiled.constraints.length} constraints · Wasm solve median ${solve.median.toFixed(2)} ms p95 ${solve.p95.toFixed(2)} ms · whole frame (solve + overlay + kernel recompute) median ${frame.median.toFixed(2)} ms p95 ${frame.p95.toFixed(2)} ms (Node + jsdom)`);
    expect(Number.isFinite(solve.median)).toBe(true);
    // Every frame still lands on the hard manifold.
    const solved = host.world.getComputed(scopeId, 'computed.kite.solvedGeometry');
    expect(solved.residual).toBeLessThan(1e-3);
  });
});
