import type { EntityId, WorkbenchPanelContext, WorkbenchPanelSpec } from '../host.ts';
import { COMMANDS, PANELS } from '../manifest.ts';
import { type CompiledScope, type SolvedLayout } from './computed.ts';
import { COMPUTED } from '../manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, type PenroseMemberAspect, type PenroseScopeAspect } from './schema.ts';

const FONT = "12px/1.45 'Helvetica Neue', Helvetica, Arial, sans-serif";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) node.setAttribute('style', style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function scopeOf(context: WorkbenchPanelContext): EntityId | undefined {
  for (const id of context.getSelectedIds()) {
    if (context.world.getCanonical(id, SCOPE_ASPECT)) return id;
    const member = context.world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId && context.world.getCanonical(member.scopeId, SCOPE_ASPECT)) return member.scopeId;
  }
  return undefined;
}

function readScope(context: WorkbenchPanelContext, id: EntityId): PenroseScopeAspect | undefined {
  const scope = context.world.getCanonical<PenroseScopeAspect>(id, SCOPE_ASPECT);
  if (!scope) return undefined;
  return {
    ...scope,
    domainDsl: String(scope.domainDsl ?? ''),
    substanceDsl: String(scope.substanceDsl ?? ''),
    styleDsl: String(scope.styleDsl ?? ''),
  };
}

const PANEL_ICON = { paths: ['M3 4h14v12H3z', 'M6 8h8', 'M6 11h5'] } as const;

export function createTriEditorPanel(): WorkbenchPanelSpec {
  return {
    panelId: PANELS.triEditor,
    title: 'Penrose Tri-DSL',
    icon: PANEL_ICON,
    defaultZone: 'right',
    navigation: { group: 'document', order: 60 },
    mount(host, context) {
      host.setAttribute('style', `display:flex;flex-direction:column;gap:6px;padding:8px;font:${FONT};min-width:320px;height:100%;box-sizing:border-box`);
      const header = el('div', 'display:flex;align-items:center;gap:6px');
      const label = el('strong', 'flex:1;font-size:12px', 'Penrose 스코프');
      const apply = el('button', 'padding:3px 10px;font:inherit;cursor:pointer', '적용 (⌘↵)');
      header.append(label, apply);
      const tabs = el('div', 'display:flex;gap:4px');
      const error = el('div', 'color:#b91c1c;white-space:pre-wrap;max-height:110px;overflow:auto');
      const areas: HTMLTextAreaElement[] = [];
      const names = ['Domain', 'Substance', 'Style'] as const;
      let active = 0;
      let current: EntityId | undefined;

      const area = el('textarea', `flex:1;min-height:180px;font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;padding:6px;border:1px solid #cbd5e1;border-radius:4px;resize:none;box-sizing:border-box`);
      areas.push(area);
      const buttons = names.map((name, index) => {
        const button = el('button', 'padding:2px 8px;font:inherit;cursor:pointer', name);
        button.addEventListener('click', () => { active = index; sync(); });
        tabs.appendChild(button);
        return button;
      });

      const sync = () => {
        buttons.forEach((button, index) => button.setAttribute('style', `padding:2px 8px;font:inherit;cursor:pointer;${index === active ? 'background:#0f172a;color:#fff;border-color:#0f172a' : ''}`));
        if (!current) { area.value = ''; area.disabled = true; apply.disabled = true; return; }
        const scope = readScope(context, current);
        if (!scope) { area.value = ''; area.disabled = true; apply.disabled = true; return; }
        const values = [scope.domainDsl, scope.substanceDsl, scope.styleDsl];
        area.value = values[active] ?? '';
        area.disabled = false;
        apply.disabled = false;
        const compiled = context.world.getComputed<CompiledScope>(current, COMPUTED.compiled);
        error.textContent = compiled && !compiled.ok && !compiled.pending
          ? (compiled.diagnostics.length ? compiled.diagnostics.map(entry => `${entry.source} L${entry.line}: ${entry.message}`).join('\n') : compiled.error ?? '')
          : '';
      };

      const commitArea = () => {
        if (!current) return;
        const scope = readScope(context, current);
        if (!scope) return;
        const values = [scope.domainDsl, scope.substanceDsl, scope.styleDsl];
        values[active] = area.value;
        void context.executeCommand(COMMANDS.apply, {
          scopeId: current,
          domainDsl: values[0]!,
          substanceDsl: values[1]!,
          styleDsl: values[2]!,
        }).catch((cause: unknown) => {
          error.textContent = cause instanceof Error ? cause.message : String(cause);
        });
      };

      apply.addEventListener('click', commitArea);
      area.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitArea(); }
        if (event.key === 'Tab') { event.preventDefault(); area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end'); }
      });

      const refresh = () => {
        const selected = context.getSelectedIds();
        let next: EntityId | undefined;
        for (const id of selected) {
          if (context.world.getCanonical(id, SCOPE_ASPECT)) { next = id; break; }
          const member = context.world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
          if (member?.scopeId) { next = member.scopeId; break; }
        }
        current = next;
        label.textContent = current ? 'Penrose 스코프' : 'Penrose 스코프 — 선택 없음';
        sync();
      };

      const offSelection = context.onSelectionChange(refresh);
      const offWorld = context.onWorldMutated(() => sync());
      host.append(header, tabs, area, error);
      refresh();
      return () => { offSelection(); offWorld(); };
    },
  };
}

export function createDiagnosticsPanel(): WorkbenchPanelSpec {
  return {
    panelId: PANELS.diagnostics,
    title: 'Penrose 진단',
    icon: PANEL_ICON,
    defaultZone: 'right',
    navigation: { group: 'document', order: 61 },
    mount(host, context) {
      host.setAttribute('style', `padding:8px;font:${FONT};min-width:280px;height:100%;box-sizing:border-box;overflow:auto`);
      const actions = el('div', 'display:flex;gap:6px;margin-bottom:8px');
      const resample = el('button', 'padding:2px 8px;font:inherit;cursor:pointer', '재표본');
      const reproject = el('button', 'padding:2px 8px;font:inherit;cursor:pointer', '다시 수렴');
      actions.append(resample, reproject);
      const body = el('div', 'white-space:pre-wrap');
      host.append(actions, body);
      const runFor = (command: string) => async () => {
        const scopeId = scopeOf(context);
        if (!scopeId) return;
        try { await context.executeCommand(command as never, { scopeId } as never); }
        catch (error) { body.textContent = error instanceof Error ? error.message : String(error); }
      };
      resample.addEventListener('click', () => { void runFor(COMMANDS.resample)(); });
      reproject.addEventListener('click', () => { void runFor(COMMANDS.reproject)(); });
      const refresh = () => {
        const scopeId = scopeOf(context);
        if (!scopeId) { body.textContent = '스코프를 선택하세요.'; return; }
        const scope = readScope(context, scopeId);
        const compiled = context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled);
        const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
        const lines: string[] = [];
        lines.push(`digest: ${scope?.topologyDigest || '—'}`);
        lines.push(`variation: ${scope?.variation ?? '—'}`);
        if (compiled?.pending) lines.push('상태: 컴파일 중');
        else if (compiled && !compiled.ok) lines.push(`상태: 오류 — ${compiled.error ?? 'DSL 오류'}`);
        else lines.push('상태: 준비됨');
        if (compiled) {
          lines.push(`owners: ${compiled.owners.length} · inputs: ${compiled.varyingValues.length}`);
          lines.push(`translatable: ${compiled.interactivity.translatable.length} · scalable: ${compiled.interactivity.scalable.length}`);
          for (const diagnostic of compiled.diagnostics.slice(0, 8)) {
            lines.push(`  ${diagnostic.source} L${diagnostic.line}: ${diagnostic.message}`);
          }
        }
        if (layout) {
          lines.push(`단계: ${layout.stages} · 에너지: ${layout.energy.toFixed(4)}`);
          lines.push(`shapes: ${layout.shapes.length}`);
          lines.push(`pins: ${scope?.pins.length ?? 0}`);
        }
        body.textContent = lines.join('\n');
      };
      const offSelection = context.onSelectionChange(refresh);
      const offWorld = context.onWorldMutated(refresh);
      refresh();
      return () => { offSelection(); offWorld(); };
    },
  };
}

export { el };
