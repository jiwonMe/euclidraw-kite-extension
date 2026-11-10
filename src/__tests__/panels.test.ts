// @vitest-environment jsdom
/**
 * The diagnostics panel's actions must work from the panel itself: explode the
 * explicit scope id, give visible feedback, and recover when the worker has no
 * session yet (a freshly opened document).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

function mountDiagnostics(h: Host) {
  const panel = h.workbench.getSnapshot().panels.find((entry: { panelId: string }) => entry.panelId === 'penrose.panel.diagnostics');
  const element = document.createElement('div');
  const context = {
    world: h.world,
    getSelectedIds: () => h.selection(),
    onSelectionChange: () => () => {},
    onWorldMutated: (callback: () => void) => h.world.subscribe(callback),
    executeCommand: (symbol: string, args: unknown) => h.commands.execute(symbol, args),
  };
  const dispose = panel.mount(element, context);
  return { element, dispose, button: (label: string) => [...element.querySelectorAll('button')].find(node => node.textContent === label) as HTMLButtonElement };
}

suite('diagnostics panel actions', () => {
  it('reprojects the selected scope and reports completion', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    host.select([scopeId]);
    const panel = mountDiagnostics(host);
    const commits = host.commits();
    panel.button('다시 수렴').click();
    await new Promise(resolve => setTimeout(resolve, 250));
    await settle(host);
    expect(host.commits()).toBe(commits + 1);
    expect(panel.element.textContent).toContain('다시 수렴 완료');
    panel.dispose?.();
  });

  it('reprojects a freshly reopened document with no worker session', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const partner = await startHost();
    partner.world.replaceCanonicalSnapshot(host.wasm.get_canonical_json());
    partner.select([scopeId]);
    const commits = partner.commits();
    await partner.run('penrose.studio:reproject', { scopeId });
    await settle(partner);
    expect(partner.commits()).toBe(commits + 1);
    expect(partner.world.getComputed(scopeId, 'computed.penrose.layout')).toBeTruthy();
    partner.dispose();
  });
});
