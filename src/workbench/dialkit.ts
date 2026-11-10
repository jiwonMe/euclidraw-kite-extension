import { mountSlider } from 'dialkit/vanilla';
import dialkitCss from 'dialkit/vanilla/styles.css?inline';
import type { Param } from '../dsl/compile.ts';

/**
 * DialKit inline sliders for Style `param`s (PRD §8.1). DialKit emits every
 * drag step through `onChange` with no begin/commit; like the host's own
 * DialKit adapter, one gesture is opened on the first change and committed on
 * pointer release or blur, so a whole drag is a single undo step. Escape
 * cancels it.
 *
 * DialKit's stylesheet is scoped to `.dialkit-root`; it is injected once into
 * the panel's own root so it never leaks into the host document.
 */

export interface SliderCallbacks {
  preview(name: string, value: number): void;
  commit(name: string, value: number): void;
  cancel(): void;
}

const STYLE_ID = 'kite-dialkit-style';

function ensureStyles(host: HTMLElement): void {
  const root = host.getRootNode() as Document | ShadowRoot;
  const container: ParentNode = 'head' in root ? (root as Document).head : root;
  if ((container as ParentNode & { querySelector(selector: string): Element | null }).querySelector?.(`#${STYLE_ID}`)) return;
  const style = host.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = dialkitCss;
  container.append(style);
}

export function mountParamSliders(host: HTMLElement, params: readonly Param[], callbacks: SliderCallbacks): () => void {
  ensureStyles(host);
  const root = host.ownerDocument.createElement('div');
  root.className = 'dialkit-root';
  root.dataset.mode = 'inline';
  root.dataset.theme = host.ownerDocument.documentElement.dataset.alidTheme === 'dark' ? 'dark' : 'light';
  root.dataset.canvasUi = '';
  host.append(root);
  const unmounts: (() => void)[] = [];
  let active: { name: string; value: number } | undefined;
  const finish = (commit: boolean) => {
    const gesture = active;
    active = undefined;
    if (!gesture) return;
    if (commit) callbacks.commit(gesture.name, gesture.value); else callbacks.cancel();
  };
  const doc = host.ownerDocument;
  const abort = new (doc.defaultView?.AbortController ?? AbortController)();
  doc.addEventListener('pointerup', () => finish(true), { capture: true, signal: abort.signal });
  doc.addEventListener('pointercancel', () => finish(false), { capture: true, signal: abort.signal });
  root.addEventListener('focusout', () => finish(true), { signal: abort.signal });
  root.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); finish(false); }
    else if (event.key === 'Enter' && active) { event.preventDefault(); finish(true); }
  }, { signal: abort.signal });
  for (const param of params) {
    const slot = doc.createElement('div');
    slot.dataset.kiteParam = param.name;
    root.append(slot);
    const mounted = mountSlider(slot, {
      label: param.name,
      value: param.value,
      min: param.min,
      max: param.max,
      step: param.step,
      onChange: (value: number) => {
        if (!Number.isFinite(value)) return;
        if (active && active.name !== param.name) finish(true);
        active = { name: param.name, value };
        callbacks.preview(param.name, value);
      },
    });
    unmounts.push(() => mounted.destroy());
  }
  return () => {
    active = undefined;
    abort.abort();
    for (const off of unmounts) off();
    root.remove();
  };
}
