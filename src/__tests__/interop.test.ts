// @vitest-environment jsdom
/**
 * PRD §7: select-suite, connector-wire (layout bounds), clipboard (whole-scope
 * remap, induced subgraph), bake-to-vector, markdown-card labels, minibuffer
 * (nested completingRead) and the Space 2B popover. Real kernel + Loro core.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const bindings = (h: Host, scopeId: string) => h.world.getCanonical(scopeId, 'kite.scope').entityBindings as Record<string, string>;
const member = (h: Host, id: string) => h.world.getPreviewView().getComputed(id, 'computed.kite.member');

suite('select-suite & connector-wire contracts', () => {
  it('exposes exact member selection geometry and refuses the default translate', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const id = bindings(host, scopeId).P!;
    const contribution = host.world.getSelectionContribution(id);
    const view = host.world.getPreviewView();
    const p = member(host, id).points[0];
    expect(contribution.hitTest(id, view, p.x, p.y, 1)).toBe(0);
    expect(contribution.hitTest(id, view, p.x + 40, p.y, 1)).toBe(Infinity);
    expect(contribution.canTransform(id, view)).toBe(false);
    const segment = bindings(host, scopeId).AB!;
    const [a, b] = member(host, segment).points;
    expect(host.world.getSelectionContribution(segment).hitTest(segment, view, (a.x + b.x) / 2, (a.y + b.y) / 2 + 0.5, 1)).toBeLessThan(1);
    // The scope frame itself stays an ordinary transformable box.
    expect(host.world.getSelectionContribution(scopeId)).toBeUndefined();
  });

  it('member layout bounds follow the solver every frame (connector-wire input)', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const id = bindings(host, scopeId).P!;
    host.select([id]); host.paint();
    const before = host.world.getPreviewView().getComputed(id, 'computed.layoutBounds');
    const p = member(host, id).points[0];
    host.press(p.x, p.y);
    host.pointer('pointermove', p.x + 80, p.y - 120); host.paint();
    const during = host.world.getPreviewView().getComputed(id, 'computed.layoutBounds');
    expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(5);
    host.pointer('pointerup', p.x + 80, p.y - 120);
    // A connector bound to the member's EntityId reads the same box.
    const effective = host.world.getComputed(id, 'computed.effectiveBounds');
    expect(effective.width).toBeGreaterThan(0);
  });
});

suite('clipboard', () => {
  it('copy-pastes a whole scope with remapped ids and identical geometry, one undo step', async () => {
    host = await startHost({ clipboard: true });
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    host.select([scopeId, ...Object.values(bindings(host, scopeId))]);
    await host.run('clipboard:duplicate');
    await settle(host);
    const scopes = host.world.listEntityIds().filter((id: string) => host!.world.getCanonical(id, 'kite.scope'));
    expect(scopes.length).toBe(2);
    const copy = scopes.find((id: string) => id !== scopeId)!;
    const solved = host.world.getComputed(copy, 'computed.kite.solvedGeometry');
    expect(solved.mode).toBe('cold');
    expect(solved.residual).toBeLessThan(1e-4);
    const compiled = host.world.getComputed(copy, 'computed.kite.compiledVm');
    for (const id of Object.values(compiled.bindings) as string[]) {
      expect(id).not.toBe(bindings(host, scopeId)[host.world.getCanonical(id, 'kite.member').substanceId]);
      expect(host.world.getCanonical(id, 'kite.member').scopeId).toBe(copy);
    }
    // Same shape, translated.
    const original = member(host, bindings(host, scopeId).P!).points[0];
    const pasted = member(host, compiled.bindings.P).points[0];
    const offset = { x: pasted.x - original.x, y: pasted.y - original.y };
    const a0 = member(host, bindings(host, scopeId).A!).points[0], a1 = member(host, compiled.bindings.A).points[0];
    expect(Math.abs(a1.x - a0.x - offset.x)).toBeLessThan(1e-6);
    expect(Math.abs(a1.y - a0.y - offset.y)).toBeLessThan(1e-6);
    // The next edit stores the remapped bindings.
    await host.run('kite.studio:reproject', { entityId: copy });
    const stored = host.world.getCanonical(copy, 'kite.scope');
    expect(stored.entityBindings.P).toBe(compiled.bindings.P);
    expect(Object.keys(stored.convergedSeeds)).toContain(compiled.bindings.P);
  });

  it('extracts an induced subgraph into a new independent scope', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    host.select([bindings(host, scopeId).c!, bindings(host, scopeId).Q!]);
    const created = await host.run<string>('kite.studio:extract-subgraph');
    await settle(host);
    const scope = host.world.getCanonical(created, 'kite.scope');
    const compiled = host.world.getComputed(created, 'computed.kite.compiledVm');
    expect(compiled.ok).toBe(true);
    // c needs its centre O and its through-point A; O = MidpointOf(A, B) loses B, so it stays a free point.
    expect(new Set(compiled.order)).toEqual(new Set(['A', 'O', 'c', 'Q']));
    expect(scope.substanceDsl).toContain('On(Q, c)');
    expect(scope.substanceDsl).not.toContain('Segment');
    expect(host.world.getComputed(created, 'computed.kite.solvedGeometry').residual).toBeLessThan(1e-4);
  });
});

suite('bake-to-vector & markdown-card labels', () => {
  it('bakes to vector.path + markdown.card in one undo step and removes the solver dependency', async () => {
    host = await startHost({ vectorPath: true, markdown: true });
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const before = host.jsonl();
    host.select([scopeId]);
    const created = await host.run<string[]>('kite.studio:bake-to-vector');
    expect(created.length).toBeGreaterThan(8);
    expect(host.world.getCanonical(scopeId, 'kite.scope')).toBeUndefined();
    expect(host.world.listEntityIds().some((id: string) => host!.world.getCanonical(id, 'kite.member'))).toBe(false);
    const paths = created.filter(id => host!.world.getCanonical(id, 'vector.path'));
    const cards = created.filter(id => host!.world.getCanonical(id, 'markdown.card'));
    expect(paths.length).toBeGreaterThan(5);
    expect(cards.map(id => host!.world.getCanonical(id, 'markdown.card').body)).toContain('∠APB = 90°');
    expect(host.undo()).toBe(true);
    expect(host.jsonl()).toBe(before);
  });

  it('places card labels (markdown-card / MathJax) along the angle bisector and follows drags', async () => {
    host = await startHost({ markdown: true });
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    const card = bindings(host, scopeId).labThales!;
    expect(host.world.getCanonical(card, 'markdown.card').body).toBe('∠APB = 90°');
    const t0 = host.world.getCanonical(card, 'core.transform');
    const p = member(host, bindings(host, scopeId).P!).points[0];
    host.select([bindings(host, scopeId).P!]); host.paint();
    host.press(p.x, p.y);
    for (let step = 1; step <= 8; step++) { host.pointer('pointermove', p.x + step * 12, p.y + step * 6); host.paint(); }
    host.pointer('pointerup', p.x + 96, p.y + 48);
    const t1 = host.world.getCanonical(card, 'core.transform');
    expect(Math.hypot(t1.x - t0.x, t1.y - t0.y)).toBeGreaterThan(5);
  });
});

suite('minibuffer & Space 2B', () => {
  it('kite: constrain-tangent prompts for a line, then a circle (nested completingRead)', async () => {
    host = await startHost({ minibuffer: true });
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    await host.run('kite.studio:apply-dsl', { entityId: scopeId, substanceDsl: `${host.world.getCanonical(scopeId, 'kite.scope').substanceDsl}\nPoint T1 = (60, 40)\nPoint T2 = (460, 40)\nLine t = T1 .. T2\n` });
    await settle(host);
    host.select([scopeId]);
    host.answer = (prompt, labels) => prompt.endsWith('원 선택') ? 'c' : prompt.endsWith('선 선택') ? 't' : labels[0];
    await host.run('kite.studio:constrain-tangent');
    expect(host.completions.map(entry => entry.prompt)).toEqual(['접선 · 접할 선 선택', '접선 · 원 선택']);
    // Domain says Tangent(Line, Circle): segments are not offered.
    expect(host.completions[0]!.labels).toEqual(['t']);
    expect(host.world.getCanonical(scopeId, 'kite.scope').substanceDsl).toContain('Tangent(t, c)');
    // The document holds the converged result at once…
    expect(host.world.getCanonicalView().getComputed(scopeId, 'computed.kite.solvedGeometry').residual).toBeLessThan(1e-3);
    // …while the screen eases toward it for ~180 ms in a ScratchOverlay (PRD §5.2).
    expect(host.world.getPreviewView().getComputed(scopeId, 'computed.kite.solvedGeometry').residual).toBeGreaterThan(1);
    await new Promise(resolve => setTimeout(resolve, 220));
    host.paint();
    expect(host.world.getPreviewView().getComputed(scopeId, 'computed.kite.solvedGeometry').residual).toBeLessThan(1e-3);
  });

  it('commands carry Hangul initial-consonant aliases for fuzzy search', async () => {
    host = await startHost();
    const titles = host.commands.list().filter((command: { id: string }) => command.id.startsWith('kite.studio:'));
    expect(titles.length).toBe(host.manifest.capabilities.commands.length);
    const tangent = titles.find((command: { id: string }) => command.id === 'kite.studio:constrain-tangent');
    expect(`${tangent.title} ${tangent.summary}`).toMatch(/ㅈㅅ/);
    expect(`${tangent.title} ${tangent.summary}`).toMatch(/tangent/);
  });

  it('the Space 2B popover offers selection-specific constraints and applies one in one click', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    host.select([bindings(host, scopeId).AP!, bindings(host, scopeId).PB!]);
    host.paint();
    const bar = host.hud.querySelector('[data-role="kite-space2b"]') as HTMLElement;
    expect(bar.style.display).toBe('flex');
    const labels = [...bar.querySelectorAll('button')].map(button => button.textContent);
    expect(labels).toContain('⊥ 직교');
    expect(labels).toContain('// 평행');
    const groups = host.groups();
    (bar.querySelector('[data-kite-action^="Perpendicular"]') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(host.groups()).toBe(groups + 1);
    expect(host.world.getCanonical(scopeId, 'kite.scope').substanceDsl).toContain('Perpendicular(AP, PB)');
    host.select([bindings(host, scopeId).P!, bindings(host, scopeId).Q!, bindings(host, scopeId).c!]);
    host.paint();
    expect([...bar.querySelectorAll('button')].map(button => button.textContent)).toContain('⌀ 지름의 양 끝점');
  });

  it('Space 2A draws the locus guide, constraint badges and the stress heatmap', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('kite.studio:insert-scope');
    await settle(host);
    host.select([bindings(host, scopeId).Q!]); host.paint();
    const q = member(host, bindings(host, scopeId).Q!).points[0];
    host.press(q.x, q.y);
    host.pointer('pointermove', q.x + 30, q.y + 30); host.paint();
    expect(host.hud.querySelector('[data-kite-locus="Q"]')).toBeTruthy();
    expect(host.hud.querySelector('[data-kite-locus="Q"]')?.getAttribute('stroke')).toBe('#6A6CD9');
    expect(host.hud.querySelectorAll('[data-kite-badge]').length).toBeGreaterThan(0);
    host.pointer('pointerup', q.x + 30, q.y + 30);
    // Over-constrain: AB is fixed (A, B pinned) — demand another length.
    await host.run('kite.studio:apply-dsl', { entityId: scopeId, substanceDsl: `${host.world.getCanonical(scopeId, 'kite.scope').substanceDsl}\nDistance(A, B, 100)\n` });
    await settle(host);
    host.select([scopeId]); host.paint();
    expect(host.hud.innerHTML).toContain('#FF4800');
  });
});
