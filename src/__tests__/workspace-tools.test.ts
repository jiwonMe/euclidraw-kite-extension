// @vitest-environment jsdom
/**
 * The canvas agent discovers tools through `workspace.tools`. Creation is only
 * possible through an extension-provided planning tool, so these tests cover
 * exactly that path: register → plan → host approval applies the change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const invoke = async (h: Host, id: string, input: Record<string, unknown>) =>
  h.tools.invoke(id, input, new AbortController().signal) as Promise<Record<string, unknown>>;

suite('workspace tools', () => {
  it('registers a create-scope tool and descriptors', async () => {
    host = await startHost();
    const found = host.tools.search('penrose').map((entry: { id: string }) => entry.id);
    expect(found).toContain('penrose.studio:create-scope');
    expect(found).toContain('penrose.studio:list-scopes');
    const descriptions = host.tools.descriptors().map((entry: { aspect: string }) => entry.aspect);
    expect(descriptions).toContain('penrose.scope');
    expect(descriptions).toContain('penrose.member');
  });

  it('creates a blank scope through an approval plan', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const before = host.world.getCanonical(scopeId, 'core.transform');
    expect(before).toBeTruthy();

    const created = await invoke(host, 'penrose.studio:create-scope', { x: 100, y: 640, width: 600, height: 400 });
    const id = String(created.entityId);
    expect(created.changeProposalId).toBeTypeOf('string');
    // Nothing is written during planning.
    expect(host.world.getCanonical(id, 'penrose.scope')).toBeUndefined();
    const ops = created.operations as { id: string; aspect: string }[];
    expect(ops.some(op => op.id === id && op.aspect === 'penrose.scope')).toBe(true);
    expect(ops.some(op => op.aspect === 'penrose.member')).toBe(true);

    const proposal = host.tools.getChangeProposal(String(created.changeProposalId));
    const applied = host.changes.apply(proposal);
    expect(applied.applied).toBe(ops.length);
    expect(host.commits()).toBeGreaterThan(0);

    const scope = host.world.getCanonical(id, 'penrose.scope');
    expect(scope.topologyDigest).not.toBe('');
    expect(scope.varyingValues.length).toBeGreaterThan(0);
    expect(Object.keys(scope.entityBindings).length).toBeGreaterThan(0);
    const transform = host.world.getCanonical(id, 'core.transform');
    expect(transform).toMatchObject({ x: 100, y: 640 });
    const bounds = host.world.getCanonical(id, 'core.bounds');
    expect(bounds).toMatchObject({ width: 600, height: 400 });
    // Placed above the existing scope so it does not overlap in stacking order.
    expect(String(host.world.getCanonical(id, 'core.stacking').order) > String(host.world.getCanonical(scopeId, 'core.stacking').order)).toBe(true);
  }, 120_000);

  it('lists both scopes with their boxes', async () => {
    host = await startHost();
    const first = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const created = await invoke(host, 'penrose.studio:create-scope', { x: 0, y: 520, width: 400, height: 300 });
    host.changes.apply(host.tools.getChangeProposal(String(created.changeProposalId)));
    const list = await invoke(host, 'penrose.studio:list-scopes', {});
    const scopes = list.scopes as { id: string; box: { x: number; y: number; width: number; height: number }; applied: boolean }[];
    expect(scopes.map(entry => entry.id)).toEqual(expect.arrayContaining([first, String(created.entityId)]));
    const second = scopes.find(entry => entry.id === String(created.entityId))!;
    expect(second.box).toMatchObject({ x: 0, y: 520, width: 400, height: 300 });
    expect(second.applied).toBe(true);
  }, 120_000);
});
