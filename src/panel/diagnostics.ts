import type { ScopeProps, WorkbenchPanelContext, WorkbenchPanelSpec } from '../types.ts';
import { COMMANDS, PANEL_IDS, SCOPE_ASPECT_ID } from '../manifest.ts';
import { readScope } from '../defaults.ts';
import { analyzeScope, solveScope } from '../solver/runtime.ts';

/** DOF / residual / over-constraint report for the selected scope. */
export function createDiagnosticsPanel(): WorkbenchPanelSpec {
  return {
    panelId: PANEL_IDS.diagnostics,
    title: 'Kite 진단',
    icon: { paths: ['M3 17l4-8 4 4 3-6 3 10'] },
    defaultZone: 'bottom',
    isolation: 'container',
    mount(host, context) {
      return mountDiagnostics(host, context);
    },
  };
}

function mountDiagnostics(host: HTMLElement, context: WorkbenchPanelContext): () => void {
  const doc = host.ownerDocument;
  const abort = new (doc.defaultView?.AbortController ?? AbortController)();
  const signal = abort.signal;
  host.replaceChildren();
  host.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:9px 12px;height:100%;box-sizing:border-box;overflow:auto;background:var(--alid-bg-surface,#fff);color:var(--alid-text-primary,#18181b);font:11px/1.4 system-ui,sans-serif;';

  const header = el(doc, 'div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
  const title = el(doc, 'div', 'font:600 12px/1.3 system-ui,sans-serif;', 'Kite 진단');
  const metrics = el(doc, 'div', 'display:flex;gap:10px;flex-wrap:wrap;color:var(--alid-text-secondary,#52525b);font-variant-numeric:tabular-nums;');
  const spacer = el(doc, 'div', 'flex:1;');
  const reproject = button(doc, '다시 수렴', 'background:#2563eb;color:#fff;border:0;');
  const freeze = button(doc, '기하 고정', 'background:transparent;color:var(--alid-text-secondary,#52525b);border:1px solid var(--alid-border-subtle,#d4d4d8);');
  header.append(title, metrics, spacer, reproject, freeze);

  const notes = el(doc, 'div', 'color:var(--alid-text-muted,#71717a);');
  const table = el(doc, 'div', 'display:flex;flex-direction:column;gap:3px;');
  const empty = el(doc, 'div', 'padding:10px 0;color:var(--alid-text-muted,#71717a);', 'Kite 스코프를 선택하면 자유도와 잔차를 계산합니다.');
  host.append(header, notes, table, empty);

  const scopeIdOf = (): string | undefined => {
    for (const id of context.getSelectedIds()) {
      if (context.world.getCanonical(id, SCOPE_ASPECT_ID)) return id;
      const member = context.world.getCanonical<{ scopeId?: string }>(id, 'kite.member');
      if (member?.scopeId) return member.scopeId;
    }
    return undefined;
  };

  function refresh(): void {
    const scopeId = scopeIdOf();
    const canonical = scopeId ? context.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID) : undefined;
    if (!canonical) {
      metrics.replaceChildren();
      notes.textContent = '';
      table.replaceChildren();
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    const scope = readScope(canonical);
    const solved = solveScope(scope, context.world.getCanonicalView());
    const report = analyzeScope(solved.compiled, solved.state, solved.pins);
    metrics.replaceChildren(
      metric(doc, 'DOF', `${report.totalDofs}`),
      metric(doc, '구속', `${report.constrainedDofs}`),
      metric(doc, '잔여', `${report.remainingDofs}`),
      metric(doc, '잔차', format(report.residual)),
      metric(doc, '반복', `${report.iterations}`),
    );
    notes.textContent = [
      report.converged ? '수렴됨' : report.dirty ? '초기 배치 계산됨 (정본 시드 불일치)' : '수렴 중',
      ...report.notes,
    ].join(' · ');
    notes.style.color = report.converged && !report.notes.length ? 'var(--alid-success,#15803d)' : report.remainingDofs === 0 && !report.converged ? 'var(--alid-danger,#b91c1c)' : 'var(--alid-text-muted,#71717a)';
    table.replaceChildren();
    if (!report.overConstrained.length) {
      table.append(el(doc, 'div', 'color:var(--alid-text-muted,#71717a);', report.constraintCount ? '잔차가 큰 구속이 없습니다.' : '구속이 없습니다.'));
      return;
    }
    for (const entry of report.overConstrained) {
      const row = el(doc, 'div', 'display:grid;grid-template-columns:52px 1fr 74px;gap:8px;align-items:center;padding:3px 6px;border-radius:5px;background:color-mix(in srgb, var(--alid-danger,#dc2626) 6%, transparent);');
      row.append(
        el(doc, 'span', 'color:var(--alid-danger,#b91c1c);font:600 10px/1.2 ui-monospace,monospace;', `L${entry.line}`),
        el(doc, 'span', 'font:11px/1.35 ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', entry.text),
        el(doc, 'span', 'text-align:right;font:10.5px/1.2 ui-monospace,monospace;color:var(--alid-danger,#b91c1c);', format(entry.residual)),
      );
      table.append(row);
    }
  }

  reproject.addEventListener('click', () => {
    const scopeId = scopeIdOf();
    if (scopeId) void context.executeCommand(COMMANDS.reproject, { entityId: scopeId }).then(refresh).catch(reportError);
  }, { signal });
  freeze.addEventListener('click', () => {
    const scopeId = scopeIdOf();
    if (scopeId) void context.executeCommand(COMMANDS.freeze, { entityId: scopeId }).then(refresh).catch(reportError);
  }, { signal });

  function reportError(error: unknown): void {
    notes.textContent = error instanceof Error ? error.message.split('\n')[0]! : String(error);
    notes.style.color = 'var(--alid-danger,#b91c1c)';
  }

  const offSelection = context.onSelectionChange(refresh);
  const offWorld = context.onWorldMutated(refresh);
  refresh();
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
  element.style.cssText = `appearance:none;border-radius:6px;padding:4px 9px;font:600 10.5px/1.25 system-ui,sans-serif;cursor:pointer;${extra}`;
  return element;
}

function metric(doc: Document, label: string, value: string): HTMLElement {
  const element = doc.createElement('span');
  const name = doc.createElement('span');
  name.textContent = `${label} `;
  name.style.color = 'var(--alid-text-muted,#71717a)';
  const number = doc.createElement('span');
  number.textContent = value;
  number.style.fontWeight = '600';
  element.append(name, number);
  return element;
}

function format(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (value < 1e-3 || value >= 1e4) return value.toExponential(1);
  return value.toFixed(value < 1 ? 3 : 2);
}
