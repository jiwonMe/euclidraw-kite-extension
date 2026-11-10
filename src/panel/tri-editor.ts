import type { ScopeProps, WorkbenchPanelContext, WorkbenchPanelSpec } from '../types.ts';
import { COMMANDS, PANEL_IDS, SCOPE_ASPECT_ID } from '../manifest.ts';
import { compileScope } from '../dsl/compile.ts';
import { numericStyleFields, parseStyle } from '../dsl/style.ts';
import { readScope } from '../defaults.ts';

type Tab = 'domain' | 'substance' | 'style';

const TABS: { id: Tab; field: 'domainDsl' | 'substanceDsl' | 'styleDsl'; label: string }[] = [
  { id: 'domain', field: 'domainDsl', label: 'Domain' },
  { id: 'substance', field: 'substanceDsl', label: 'Substance' },
  { id: 'style', field: 'styleDsl', label: 'Style' },
];

/** Inspector panel for the selected scope: three DSL tabs, inline style numbers, live diagnostics. */
export function createTriEditorPanel(): WorkbenchPanelSpec {
  return {
    panelId: PANEL_IDS.triEditor,
    title: 'Kite Tri-DSL',
    icon: { paths: ['M4 5h12', 'M4 10h8', 'M4 15h12', 'M17 8l3 3-3 3'] },
    defaultZone: 'right',
    inspectorFor: SCOPE_ASPECT_ID,
    isolation: 'container',
    mount(host, context) {
      return mountTriEditor(host, context);
    },
  };
}

function mountTriEditor(host: HTMLElement, context: WorkbenchPanelContext): () => void {
  const doc = host.ownerDocument;
  const abort = new (doc.defaultView?.AbortController ?? AbortController)();
  const signal = abort.signal;
  host.replaceChildren();
  host.style.cssText = 'display:flex;flex-direction:column;gap:0;height:100%;min-height:0;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);';

  const scopeIdOf = (): string | undefined => {
    for (const id of context.getSelectedIds()) {
      if (context.world.getCanonical(id, SCOPE_ASPECT_ID)) return id;
      const member = context.world.getCanonical<{ scopeId?: string }>(id, 'kite.member');
      if (member?.scopeId) return member.scopeId;
    }
    return undefined;
  };

  let scopeId = scopeIdOf();
  let scope: ScopeProps | undefined = scopeId ? readScope(context.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)) : undefined;
  let active: Tab = 'substance';
  let dirty = false;

  const header = el(doc, 'div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7);');
  const title = el(doc, 'div', 'font:600 12px/1.3 system-ui,sans-serif;letter-spacing:0.01em;', 'Kite Tri-DSL');
  const status = el(doc, 'div', 'font:500 10.5px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);white-space:nowrap;', '스코프 선택 없음');
  header.append(title, status);

  const tabs = el(doc, 'div', 'display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid var(--alid-border-subtle,#e4e4e7);');
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const tab of TABS) {
    const button = el(doc, 'button', 'appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;padding:6px 9px 7px;font:600 11.5px/1.2 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);cursor:pointer;border-radius:6px 6px 0 0;', tab.label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.tab = tab.id;
    button.addEventListener('click', () => { if (dirty) stashDraft(); active = tab.id; render(); }, { signal });
    tabButtons.set(tab.id, button);
    tabs.append(button);
  }

  const editor = el(doc, 'div', 'display:flex;flex:1;min-height:0;position:relative;');
  const gutter = el(doc, 'pre', 'margin:0;padding:10px 8px;width:38px;box-sizing:border-box;text-align:right;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--alid-text-muted,#a1a1aa);background:var(--alid-bg-muted,#fafafa);border-right:1px solid var(--alid-border-subtle,#e4e4e7);overflow:hidden;user-select:none;');
  const textarea = doc.createElement('textarea');
  textarea.setAttribute('aria-label', 'Kite DSL 소스');
  textarea.spellcheck = false;
  textarea.style.cssText = 'flex:1;min-width:0;min-height:160px;resize:none;border:0;outline:none;padding:10px;font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);tab-size:2;white-space:pre;overflow:auto;';
  editor.append(gutter, textarea);

  const linked = el(doc, 'div', 'display:none;padding:8px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);background:var(--alid-bg-muted,#fafafa);');
  const linkedLabel = el(doc, 'div', 'font:600 10px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);margin-bottom:4px;', '연관 구문');
  const linkedList = el(doc, 'div', 'display:flex;flex-direction:column;gap:3px;max-height:92px;overflow:auto;');
  linked.append(linkedLabel, linkedList);

  const styleBox = el(doc, 'div', 'display:none;padding:8px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);max-height:130px;overflow:auto;');
  styleBox.dataset.role = 'kite-style-params';

  const footer = el(doc, 'div', 'display:flex;align-items:center;gap:6px;padding:9px 12px;border-top:1px solid var(--alid-border-subtle,#e4e4e7);');
  const apply = button(doc, '적용', 'background:#2563eb;color:#fff;border:0;');
  const reset = button(doc, '예제 복원', 'background:transparent;color:var(--alid-text-secondary,#52525b);border:1px solid var(--alid-border-subtle,#d4d4d8);');
  const spacer = el(doc, 'div', 'flex:1;');
  const info = el(doc, 'div', 'font:500 10.5px/1.3 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);text-align:right;max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
  footer.append(apply, reset, spacer, info);

  host.append(header, tabs, editor, linked, styleBox, footer);

  const drafts: Record<Tab, string> = { domain: '', substance: '', style: '' };

  function stashDraft(): void {
    if (!scope) return;
    drafts[active] = textarea.value;
    const field = TABS.find(tab => tab.id === active)!.field;
    (scope as unknown as Record<string, unknown>)[field] = textarea.value;
    dirty = true;
  }

  function load(): void {
    scopeId = scopeIdOf();
    const canonical = scopeId ? context.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID) : undefined;
    scope = canonical ? readScope(canonical) : undefined;
    dirty = false;
    if (scope) {
      drafts.domain = scope.domainDsl;
      drafts.substance = scope.substanceDsl;
      drafts.style = scope.styleDsl;
    }
    render();
  }

  function render(): void {
    if (tabButtons.size) for (const [id, element] of tabButtons) {
      const selected = id === active;
      element.style.color = selected ? 'var(--alid-accent,#2563eb)' : 'var(--alid-text-muted,#71717a)';
      element.style.borderBottomColor = selected ? 'var(--alid-accent,#2563eb)' : 'transparent';
      element.style.background = selected ? 'var(--alid-bg-muted,#fafafa)' : 'transparent';
    }
    if (!scope || !scopeId) {
      status.textContent = '스코프 선택 없음';
      info.textContent = '';
      textarea.value = '';
      textarea.disabled = true;
      gutter.textContent = '';
      styleBox.style.display = 'none';
      linked.style.display = 'none';
      return;
    }
    textarea.disabled = false;
    textarea.value = drafts[active];
    gutter.textContent = Array.from({ length: Math.max(1, textarea.value.split('\n').length) }, (_, index) => String(index + 1)).join('\n');
    const compiled = compileScope({ ...scope, domainDsl: drafts.domain, substanceDsl: drafts.substance, styleDsl: drafts.style });
    status.textContent = compiled.ok ? `${compiled.instances.size}개 개체 · ${compiled.constraints.length}개 구속${dirty ? ' · 미적용' : ''}` : `오류 ${compiled.errors.length}개`;
    status.style.color = compiled.ok ? 'var(--alid-text-muted,#71717a)' : 'var(--alid-danger,#dc2626)';
    info.textContent = compiled.errors[0] ? `L${compiled.errors[0].line}: ${compiled.errors[0].message}` : dirty ? 'Ctrl/⌘+Enter로 적용' : '정본과 동기화됨';
    info.style.color = compiled.errors[0] ? 'var(--alid-danger,#b91c1c)' : 'var(--alid-text-muted,#71717a)';
    renderLinked(compiled);
    renderStyleParams();
  }

  function renderLinked(compiled: ReturnType<typeof compileScope>): void {
    linkedList.replaceChildren();
    if (!scopeId || !context.getSelectedIds().length) { linked.style.display = 'none'; return; }
    const selectedSubstance = new Set<string>();
    for (const id of context.getSelectedIds()) {
      const member = context.world.getCanonical<{ scopeId?: string; substanceId?: string }>(id, 'kite.member');
      if (member?.scopeId === scopeId && member.substanceId) selectedSubstance.add(member.substanceId);
    }
    if (!selectedSubstance.size) { linked.style.display = 'none'; return; }
    const matches: { line: number; text: string }[] = [];
    drafts.substance.split('\n').forEach((line, index) => {
      for (const id of selectedSubstance) if (line.includes(id)) { matches.push({ line: index, text: line.trim() }); break; }
    });
    if (!matches.length) { linked.style.display = 'none'; return; }
    linked.style.display = 'block';
    for (const match of matches.slice(0, 8)) {
      const row = doc.createElement('button');
      row.type = 'button';
      row.style.cssText = 'appearance:none;text-align:left;border:0;background:transparent;padding:2px 4px;border-radius:4px;font:11px/1.4 ui-monospace,monospace;color:var(--alid-text-secondary,#52525b);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      row.textContent = `L${match.line + 1}  ${match.text}`;
      row.addEventListener('click', () => {
        active = 'substance';
        render();
        const start = drafts.substance.split('\n').slice(0, match.line).join('\n').length + (match.line ? 1 : 0);
        textarea.focus();
        textarea.setSelectionRange(start, start + match.text.length);
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
        textarea.scrollTop = Math.max(0, match.line * lineHeight - 40);
      }, { signal });
      linkedList.append(row);
    }
    void compiled;
  }

  function renderStyleParams(): void {
    styleBox.replaceChildren();
    styleBox.style.display = active === 'style' ? 'block' : 'none';
    if (active !== 'style') return;
    const parsed = parseStyle(drafts.style);
    const fields = numericStyleFields(parsed.rules);
    if (!fields.length) { styleBox.append(el(doc, 'div', 'font:11px/1.4 system-ui,sans-serif;color:var(--alid-text-muted,#71717a);', 'Style DSL에 숫자 파라미터가 없습니다.')); return; }
    for (const field of fields.slice(0, 18)) {
      const row = el(doc, 'div', 'display:grid;grid-template-columns:86px 1fr 48px;align-items:center;gap:8px;margin-bottom:5px;');
      const label = el(doc, 'div', 'font:600 10.5px/1.2 system-ui,sans-serif;color:var(--alid-text-secondary,#52525b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', `${field.selector}.${field.key}`);
      const input = doc.createElement('input');
      input.type = 'range';
      input.min = String(Math.min(0, field.value * 0.2));
      input.max = String(Math.max(24, field.value * 3));
      input.step = '0.5';
      input.value = String(field.value);
      input.style.cssText = 'width:100%;accent-color:var(--alid-accent,#2563eb);';
      const value = el(doc, 'div', 'font:11px/1.2 ui-monospace,monospace;text-align:right;color:var(--alid-text-secondary,#52525b);', String(field.value));
      input.addEventListener('input', () => {
        value.textContent = input.value;
        drafts.style = setStyleNumber(drafts.style, field.selector, field.key, Number(input.value));
        scope!.styleDsl = drafts.style;
        dirty = true;
        textarea.value = drafts.style;
        gutter.textContent = Array.from({ length: Math.max(1, drafts.style.split('\n').length) }, (_, index) => String(index + 1)).join('\n');
        info.textContent = 'Ctrl/⌘+Enter로 적용';
      }, { signal });
      row.append(label, input, value);
      styleBox.append(row);
    }
  }

  textarea.addEventListener('input', () => {
    stashDraft();
    const lines = textarea.value.split('\n').length;
    gutter.textContent = Array.from({ length: Math.max(1, lines) }, (_, index) => String(index + 1)).join('\n');
    info.textContent = 'Ctrl/⌘+Enter로 적용';
  }, { signal });
  textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; }, { signal });
  textarea.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.setRangeText('  ', start, end, 'end');
      stashDraft();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  }, { signal });

  async function submit(): Promise<void> {
    if (!scopeId || !scope) return;
    if (dirty) stashDraft();
    try {
      await context.executeCommand(COMMANDS.apply, { entityId: scopeId, domainDsl: drafts.domain, substanceDsl: drafts.substance, styleDsl: drafts.style });
      dirty = false;
      load();
    } catch (error) {
      info.textContent = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      info.style.color = 'var(--alid-danger,#b91c1c)';
    }
  }

  apply.addEventListener('click', () => { void submit(); }, { signal });
  reset.addEventListener('click', async () => {
    if (!scopeId) return;
    try {
      await context.executeCommand(COMMANDS.reset, { entityId: scopeId });
      dirty = false;
      load();
    } catch (error) {
      info.textContent = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      info.style.color = 'var(--alid-danger,#b91c1c)';
    }
  }, { signal });

  const offSelection = context.onSelectionChange(() => load());
  const offWorld = context.onWorldMutated(() => { if (!dirty) load(); });
  load();
  return () => {
    abort.abort();
    offSelection();
    offWorld();
    host.replaceChildren();
  };
}

function el(doc: Document, tag: string, style: string, text?: string): HTMLElement {
  const element = doc.createElement(tag);
  element.style.cssText = style;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(doc: Document, label: string, extra: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.style.cssText = `appearance:none;border-radius:6px;padding:5px 10px;font:600 11px/1.25 system-ui,sans-serif;cursor:pointer;${extra}`;
  return element;
}

/** Rewrite one numeric field inside the matching Style rule, preserving the rest. */
export function setStyleNumber(source: string, selector: string, key: string, value: number): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  return source.replace(rulePattern, (whole, selectors: string, body: string) => {
    const matches = selectors.replace(/(^|\n)\s*(#|\/\/).*$/gm, '$1').replace(/\s+/g, ' ').split(',').map(part => part.trim()).includes(selector);
    if (!matches) return whole;
    const nextBody = body.replace(new RegExp(`(\\b${escapeRegExp(key)}\\s*:\\s*)-?(?:\\d+(?:\\.\\d+)?)`, 'g'), (_match, prefix: string) => `${prefix}${value}`);
    return `${selectors}{${nextBody}}`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
