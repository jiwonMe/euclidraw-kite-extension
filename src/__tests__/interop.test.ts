// @vitest-environment jsdom
/**
 * Host integration: exact member selection, layout bounds, whole-scope
 * clipboard duplication and vector baking.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const bindings = (h: Host, scopeId: string) => h.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>;
const layout = (h: Host, id: string) => h.world.getComputed(id, 'computed.penrose.layout');
const member = (h: Host, id: string) => h.world.getComputed(id, 'computed.penrose.member');

suite('select-suite & connector-wire contracts', () => {
  it('exposes exact member hit testing and refuses the default translate', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const id = bindings(host, scopeId).A!;
    const box = member(host, id);
    const contribution = host.world.getSelectionContribution(id);
    const view = host.world.getPreviewView();
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(contribution.hitTest(id, view, c.x, c.y, 1)).toBeLessThanOrEqual(0);
    expect(contribution.hitTest(id, view, c.x + 400, c.y + 400, 1)).toBe(Infinity);
    expect(contribution.canTransform(id, view)).toBe(false);
  });

  it('feeds computed.layoutBounds from the converged layout', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const id = bindings(host, scopeId).c!;
    const bounds = host.world.getComputed(id, 'computed.layoutBounds');
    expect(bounds.width).toBeGreaterThan(10);
    expect(bounds.height).toBeGreaterThan(10);
    const geometry = member(host, id);
    expect(geometry.width).toBeGreaterThan(10);
    expect(host.world.getComputed(id, 'computed.effectiveBounds').width).toBeGreaterThan(0);
  });
});

suite('clipboard', () => {
  it('copy-pastes a whole scope with remapped members and the same layout', async () => {
    host = await startHost({ clipboard: true });
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const before = layout(host, scopeId);
    host.select([scopeId, ...Object.values(bindings(host, scopeId))]);
    await host.run('clipboard:duplicate');
    await settle(host);
    const scopes = host.world.listEntityIds().filter((id: string) => host!.world.getCanonical(id, 'penrose.scope'));
    expect(scopes.length).toBe(2);
    const copy = scopes.find((id: string) => id !== scopeId)!;
    const copied = layout(host, copy);
    expect(copied).toBeTruthy();
    // Same shape data, different entity ids and a translated frame.
    expect(copied.shapes.length).toBe(before.shapes.length);
    const copiedMembers = host.world.listEntityIds().filter((id: string) => host!.world.getCanonical(id, 'penrose.member')?.scopeId === copy);
    expect(copiedMembers.length).toBe(Object.keys(bindings(host, scopeId)).length);
    for (const id of copiedMembers) expect(member(host, id).width).toBeGreaterThan(0);
  });
});

suite('bake-to-vector', () => {
  it('bakes geometry into vector.path and removes the scope', async () => {
    host = await startHost({ vectorPath: true });
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([scopeId]);
    await host.run('penrose.studio:bake-to-vector');
    expect(host.world.getCanonical(scopeId, 'penrose.scope')).toBeUndefined();
    const paths = host.world.listEntityIds().filter((id: string) => host!.world.getCanonical(id, 'vector.path'));
    // Points, circle, labels: circles/polygons bake; text/equation/image do not.
    expect(paths.length).toBeGreaterThanOrEqual(4);
  });
});
