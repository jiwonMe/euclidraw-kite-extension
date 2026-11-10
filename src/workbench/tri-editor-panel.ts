import type { EntityId, JsonValue, WorkbenchPanelContext, WorkbenchPanelSpec } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import { compileCached } from '../computed-bridge.ts';
import { readScope, scopeMembers } from '../documents.ts';
import { COMMANDS, PANELS } from '../manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, type KiteMemberAspect } from '../schema.ts';
import type { HighlightState } from '../render/space2a-gizmos.ts';
import { setParamValue } from './commands.ts';
import { mountParamSliders } from './dialkit.ts';

/**
 * PRD §8.1 `kite.panel.tri-editor` (a SplitWorkspace panel).
 *
 *  • Domain / Substance / Style tabs over native <textarea>s: native undo,
 *    clipboard and IME are untouched; drafts are local until "적용".
 *  • Canvas → editor: hovering/selecting a member highlights every line that
 *    mentions its substance id.
 *  • Editor → canvas: the caret's line highlights its members and constraint
 *    badges in Space 2A.
 *  • DialKit inline sliders for every Style `param`; a drag previews in a
 *    ScratchOverlay and releases as one undo step.
 */

type Tab = 'domainDsl' | 'substanceDsl' | 'styleDsl';
const TABS: { field: Tab; label: string; source: 'domain' | 'substance' | 'style' }[] = [
  { field: 'domainDsl', label: 'Domain', source: 'domain' },
  { field: 'substanceDsl', label: 'Substance', source: 'substance' },
  { field: 'styleDsl', label: 'Style', source: 'style' },
];

export interface TriEditorHooks {
  highlight(state: HighlightState): void;
  hovered(): { scopeId: EntityId; substanceId: string } | undefined;
  previewParam(scopeId: EntityId, styleDsl: string | undefined): void;
  subscribeFrame(listener: () => void): () => void;
}

export function createTriEditorPanel(hooks: TriEditorHooks): WorkbenchPanelSpec {
  return {
    panelId: PANELS.triEditor,
    title: 'Kite Tri-DSL',
    icon: { paths: ['M4 5h12', 'M4 10h8', 'M4 15h12', 'M15 8l3 2-3 2'] },
    defaultZone: 'right',
    navigation: { group: 'document', order: 40, command: COMMANDS.openEditor },
    isolation: 'container',
    mount: (host, context) => mountTriEditor(host, context, hooks),
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, css: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
};

function mountTriEditor(host: HTMLElement, context: WorkbenchPanelContext, hooks: TriEditorHooks): () => void {
  const doc = host.ownerDocument;
  const abort = new (doc.defaultView?.AbortController ?? AbortController)();
  const signal = abort.signal;
  host.replaceChildren();
  host.dataset.kitePanel = 'tri-editor';
  host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:320px;color:var(--alid-text,#18181b);font:12px/1.4 var(--alid-font,system-ui,sans-serif)';

  const header = el(doc, 'div', 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7)');
  const title = el(doc, 'strong', 'font-weight:600', 'Kite Tri-DSL');
  const status = el(doc, 'span', 'margin-left:auto;color:var(--alid-text-muted,#71717a);font-size:11px');
  header.append(title, status);
  const tabs = el(doc, 'div', 'display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7)');
  tabs.setAttribute('role', 'tablist');
  const buttons = new Map<Tab, HTMLButtonElement>();
  const body = el(doc, 'div', 'position:relative;display:flex;flex:1;min-height:180px');
  const gutter = el(doc, 'pre', 'margin:0;padding:8px 6px;width:40px;box-sizing:border-box;text-align:right;overflow:hidden;color:var(--alid-text-muted,#a1a1aa);background:var(--alid-bg-muted,#fafafa);font:11px/18px ui-monospace,SFMono-Regular,Menlo,monospace;user-select:none');
  const marks = el(doc, 'div', 'position:absolute;left:40px;right:0;top:0;bottom:0;pointer-events:none;overflow:hidden');
  const area = el(doc, 'textarea', 'flex:1;min-width:0;resize:none;border:0;outline:none;padding:8px;background:transparent;color:inherit;font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;tab-size:2;position:relative;z-index:1');
  area.spellcheck = false;
  area.setAttribute('aria-label', 'Kite DSL');
  area.dataset.kiteEditor = '';
  body.append(gutter, marks, area);
  const params = el(doc, 'div', 'border-top:1px solid var(--alid-border-subtle,#e4e4e7);padding:6px 8px;max-height:200px;overflow:auto');
  params.dataset.kiteParams = '';
  const footer = el(doc, 'div', 'display:flex;gap:6px;align-items:center;padding:8px 10px;border-top:1px solid var(--alid-border-subtle,#e4e4e7)');
  const apply = el(doc, 'button', 'border:0;border-radius:6px;padding:5px 10px;background:var(--alid-accent,#2563eb);color:#fff;font:600 11.5px/1.2 inherit;cursor:pointer', '적용');
  const revert = el(doc, 'button', 'border:1px solid var(--alid-border-subtle,#d4d4d8);border-radius:6px;padding:5px 10px;background:transparent;color:inherit;font:600 11.5px/1.2 inherit;cursor:pointer', '되돌리기');
  apply.type = 'button'; revert.type = 'button';
  const message = el(doc, 'span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--alid-text-muted,#71717a)');
  footer.append(apply, revert, message);
  host.append(header, tabs, body, params, footer);

  let scopeId: EntityId | undefined;
  let active: Tab = 'substanceDsl';
  let drafts: Record<Tab, string> = { domainDsl: '', substanceDsl: '', styleDsl: '' };
  let base: Record<Tab, string> = { domainDsl: '', substanceDsl: '', styleDsl: '' };
  let composing = false, compositionEnded = -Infinity;
  let unmountSliders: (() => void) | undefined;
  let lastCanvasKey = '';
  const dirty = () => TABS.some(tab => drafts[tab.field] !== base[tab.field]);

  for (const tab of TABS) {
    const button = el(doc, 'button', 'border:0;border-bottom:2px solid transparent;background:transparent;padding:6px 10px;color:inherit;font:600 11.5px/1.2 inherit;cursor:pointer', tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.tab = tab.field;
    button.addEventListener('click', () => { drafts[active] = area.value; active = tab.field; render(); }, { signal });
    buttons.set(tab.field, button);
    tabs.append(button);
  }

  const scopeOf = (): EntityId | undefined => {
    for (const id of context.getSelectedIds()) {
      if (context.world.getCanonical(id, SCOPE_ASPECT)) return id;
      const member = context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (member?.scopeId) return member.scopeId;
    }
    return undefined;
  };

  const compileDraft = (): CompiledScope | undefined => {
    if (!scopeId) return undefined;
    try { return compileCached({ ...drafts, entityBindings: scopeMembers(context.world.getCanonicalView(), scopeId) }); }
    catch { return undefined; }
  };

  function load(force = false): void {
    const next = scopeOf();
    if (!force && dirty() && next === scopeId) return;
    if (!force && dirty() && next !== scopeId) { status.textContent = '적용하지 않은 초안이 있습니다'; return; }
    scopeId = next;
    const scope = scopeId ? readScope(context.world, scopeId) : undefined;
    base = scope ? { domainDsl: scope.domainDsl, substanceDsl: scope.substanceDsl, styleDsl: scope.styleDsl } : { domainDsl: '', substanceDsl: '', styleDsl: '' };
    drafts = { ...base };
    render();
  }

  function render(): void {
    for (const [field, button] of buttons) {
      const on = field === active;
      button.setAttribute('aria-selected', String(on));
      button.style.borderBottomColor = on ? 'var(--alid-accent,#2563eb)' : 'transparent';
      button.style.color = on ? 'var(--alid-accent,#2563eb)' : 'inherit';
    }
    area.disabled = !scopeId;
    if (area.value !== drafts[active]) area.value = drafts[active];
    gutter.textContent = Array.from({ length: Math.max(1, area.value.split('\n').length) }, (_v, index) => String(index + 1)).join('\n');
    const compiled = compileDraft();
    const diagnostics = compiled?.diagnostics ?? [];
    status.textContent = !scopeId ? 'Kite 스코프를 선택하세요' : compiled?.ok ? `${compiled.order.length}개 개체 · ${compiled.constraints.length}개 구속${dirty() ? ' · 미적용' : ''}` : `오류 ${diagnostics.length}개`;
    status.style.color = compiled && !compiled.ok ? 'var(--alid-danger,#dc2626)' : 'var(--alid-text-muted,#71717a)';
    const source = TABS.find(tab => tab.field === active)!.source;
    const here = diagnostics.find(entry => entry.source === source) ?? diagnostics[0];
    message.textContent = here ? `${here.source} L${here.line}: ${here.message}` : dirty() ? 'Ctrl/⌘+Enter로 적용' : '정본과 동기화됨';
    message.style.color = here ? 'var(--alid-danger,#b91c1c)' : 'var(--alid-text-muted,#71717a)';
    paintMarks(compiled);
    renderSliders(compiled);
  }

  /** Lines to emphasise: diagnostics (red) and canvas-highlighted ids (accent). */
  function paintMarks(compiled: CompiledScope | undefined): void {
    marks.replaceChildren();
    const source = TABS.find(tab => tab.field === active)!.source;
    const lines = area.value.split('\n');
    const mark = (line: number, color: string, data: string) => {
      const bar = el(doc, 'div', `position:absolute;left:0;right:0;top:${8 + (line - 1) * 18 - area.scrollTop}px;height:18px;background:${color}`);
      bar.dataset.kiteMark = data;
      marks.append(bar);
    };
    for (const entry of compiled?.diagnostics ?? []) if (entry.source === source && entry.line > 0) mark(entry.line, 'rgba(220,38,38,.12)', `error:${entry.line}`);
    const hovered = hooks.hovered();
    const ids = new Set<string>();
    if (hovered && hovered.scopeId === scopeId) ids.add(hovered.substanceId);
    for (const id of context.getSelectedIds()) {
      const member = context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (member && member.scopeId === scopeId) ids.add(member.substanceId);
    }
    if (!ids.size || active === 'domainDsl') return;
    const pattern = new RegExp(`(^|[^\\w])(${[...ids].map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`);
    lines.forEach((text, index) => { if (pattern.test(text.replace(/(^|\s)(#|\/\/).*$/, ''))) mark(index + 1, 'rgba(106,108,217,.14)', `ref:${index + 1}`); });
  }

  /** Caret line → canvas highlight (Space 2A). */
  function caretToCanvas(): void {
    if (!scopeId || active !== 'substanceDsl') { hooks.highlight({ ids: new Set(), lines: new Set() }); return; }
    const compiled = compileDraft();
    if (!compiled) return;
    const line = area.value.slice(0, area.selectionStart).split('\n').length;
    const ids = new Set<string>();
    const text = area.value.split('\n')[line - 1] ?? '';
    for (const id of compiled.order) if (new RegExp(`(^|[^\\w])${id}(?![\\w])`).test(text)) ids.add(id);
    hooks.highlight({ ids, lines: new Set([line]), scopeId });
  }

  function renderSliders(compiled: CompiledScope | undefined): void {
    const key = scopeId && compiled?.ok ? `${scopeId}|${compiled.params.map(param => `${param.name}:${param.min}:${param.max}:${param.step}`).join(',')}` : '';
    if (params.dataset.key === key) return;
    params.dataset.key = key;
    unmountSliders?.();
    unmountSliders = undefined;
    params.replaceChildren();
    params.style.display = key && compiled!.params.length ? 'block' : 'none';
    if (!key || !compiled!.params.length) return;
    const owner = scopeId!;
    unmountSliders = mountParamSliders(params, compiled!.params, {
      // Every step previews through a ScratchOverlay; the document is untouched.
      preview: (name, value) => {
        drafts.styleDsl = setParamValue(drafts.styleDsl, name, value);
        if (active === 'styleDsl') area.value = drafts.styleDsl;
        hooks.previewParam(owner, drafts.styleDsl);
      },
      // Release commits exactly once.
      commit: (name, value) => {
        hooks.previewParam(owner, undefined);
        const style = setParamValue(base.styleDsl, name, value);
        drafts.styleDsl = style;
        void context.executeCommand(COMMANDS.apply, { entityId: owner, styleDsl: style } as JsonValue)
          .then(() => load(true))
          .catch(error => { message.textContent = String((error as Error).message ?? error).split('\n')[0]!; });
      },
      cancel: () => { hooks.previewParam(owner, undefined); drafts.styleDsl = base.styleDsl; render(); },
    });
  }

  async function submit(): Promise<void> {
    if (!scopeId) return;
    drafts[active] = area.value;
    try {
      await context.executeCommand(COMMANDS.apply, { entityId: scopeId, domainDsl: drafts.domainDsl, substanceDsl: drafts.substanceDsl, styleDsl: drafts.styleDsl } as JsonValue);
      load(true);
    } catch (error) {
      message.textContent = String((error as Error).message ?? error).split('\n').slice(0, 2).join(' · ');
      message.style.color = 'var(--alid-danger,#b91c1c)';
    }
  }

  area.addEventListener('compositionstart', () => { composing = true; }, { signal });
  area.addEventListener('compositionend', () => { composing = false; compositionEnded = performance.now(); }, { signal });
  area.addEventListener('input', () => { drafts[active] = area.value; render(); }, { signal });
  area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; paintMarks(compileDraft()); }, { signal });
  for (const type of ['keyup', 'click', 'select'] as const) area.addEventListener(type, caretToCanvas, { signal });
  area.addEventListener('keydown', event => {
    // IME guard: never act on keys that belong to an in-progress composition.
    if (composing || event.isComposing || event.keyCode === 229 || event.key === 'Process' || performance.now() - compositionEnded < 16) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit(); return; }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) return;
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      drafts[active] = area.value;
      render();
    }
  }, { signal });
  apply.addEventListener('click', () => { void submit(); }, { signal });
  revert.addEventListener('click', () => load(true), { signal });

  const offSelection = context.onSelectionChange(() => load());
  const offWorld = context.onWorldMutated(() => { if (!dirty()) load(true); else render(); });
  const offFrame = hooks.subscribeFrame(() => {
    const hovered = hooks.hovered();
    const key = `${hovered?.scopeId ?? ''}:${hovered?.substanceId ?? ''}`;
    if (key !== lastCanvasKey) { lastCanvasKey = key; paintMarks(compileDraft()); }
  });
  load(true);
  return () => {
    abort.abort();
    offSelection(); offWorld(); offFrame();
    unmountSliders?.();
    hooks.highlight({ ids: new Set(), lines: new Set() });
    host.replaceChildren();
  };
}
