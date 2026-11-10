// @vitest-environment jsdom
/**
 * Drag previews live in the worker/renderer cache only. Exactly one canonical
 * write happens on release, and one Undo restores the pre-drag document.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const wait = async (h: Host, ms = 25) => {
  await new Promise(resolve => setTimeout(resolve, ms));
  h.paint();
};

async function scopeWithMember(h: Host, owner = 'A'): Promise<{ scopeId: string; memberId: string }> {
  const scopeId = await h.run<string>('penrose.studio:insert-scope');
  await settle(h);
  const memberId = (h.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>)[owner]!;
  h.select([memberId]);
  h.paint();
  return { scopeId, memberId };
}

const memberBox = (h: Host, memberId: string) => h.world.getComputed(memberId, 'computed.penrose.member');

suite('gizmo drag + single undo (real kernel + Loro core)', () => {
  it('previews without writing, commits once, and Undo restores exactly', async () => {
    host = await startHost();
    const { memberId } = await scopeWithMember(host);
    const start = memberBox(host, memberId);
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    const jsonlBefore = host.jsonl(), commitsBefore = host.commits(), groupsBefore = host.groups();

    expect(host.press(x, y)).toBe(true);
    for (let step = 1; step <= 6; step++) {
      host.pointer('pointermove', x + step * 10, y + step * 6);
      await wait(host, 8);
      expect(host.commits()).toBe(commitsBefore);
      expect(host.jsonl()).toBe(jsonlBefore);
    }
    host.pointer('pointerup', x + 60, y + 36);
    await wait(host, 800);
    expect(host.commits()).toBe(commitsBefore + 1);
    expect(host.groups()).toBe(groupsBefore + 1);

    const moved = memberBox(host, memberId);
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(20);

    expect(host.undo()).toBe(true);
    await wait(host, 80);
    expect(host.jsonl()).toBe(jsonlBefore);
    const restored = memberBox(host, memberId);
    expect(Math.hypot(restored.x - start.x, restored.y - start.y)).toBeLessThan(1e-6);
  });

  it('Escape cancels a drag without writing', async () => {
    host = await startHost();
    const { memberId } = await scopeWithMember(host);
    const start = memberBox(host, memberId);
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    const commits = host.commits(), before = host.jsonl();
    expect(host.press(x, y)).toBe(true);
    host.pointer('pointermove', x + 50, y + 50);
    await wait(host, 8);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    host.pointer('pointerup', x + 50, y + 50);
    await wait(host, 800);
    expect(host.commits()).toBe(commits);
    expect(host.jsonl()).toBe(before);
    const now = memberBox(host, memberId);
    expect(Math.hypot(now.x - start.x, now.y - start.y)).toBeLessThan(1e-6);
  });
});
