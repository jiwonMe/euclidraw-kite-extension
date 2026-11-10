// @vitest-environment jsdom
/**
 * Handles are shown for every free optimization input in the document, not only
 * for the selected member, and pinned inputs lose their handle.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const bindings = (h: Host, scopeId: string) => h.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>;
const center = (h: Host, memberId: string) => {
  const box = h.world.getComputed(memberId, 'computed.penrose.member');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

suite('focus-free gizmos', () => {
  it('shows handles without a selection and for every free owner', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([]);
    host.paint();
    const ids = host.gizmoHandles().map(handle => handle.id).sort();
    expect(ids).toEqual([
      `penrose:${scopeId}:move:\`A\`.icon`,
      `penrose:${scopeId}:move:\`B\`.icon`,
      `penrose:${scopeId}:move:\`C\`.icon`,
      `penrose:${scopeId}:move:\`c\`.icon`,
    ]);
    for (const handle of host.gizmoHandles()) expect(host.hitTest(handle.x, handle.y)).toBe(true);
  });

  it('hides the handle of a pinned object and restores it when unpinned', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const a = bindings(host, scopeId).A!;
    const b = bindings(host, scopeId).B!;
    const pa = center(host, a), pb = center(host, b);
    expect(host.hitTest(pa.x, pa.y)).toBe(true);

    host.select([a]);
    await host.run('penrose.studio:toggle-pin');
    host.paint();
    expect(host.hitTest(pa.x, pa.y)).toBe(false);
    expect(host.hitTest(pb.x, pb.y)).toBe(true);

    host.select([a]);
    await host.run('penrose.studio:toggle-pin');
    host.paint();
    expect(host.hitTest(pa.x, pa.y)).toBe(true);
  });
});
