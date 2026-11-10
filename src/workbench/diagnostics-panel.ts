import type { EntityId, JsonValue, WorkbenchPanelContext, WorkbenchPanelSpec } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import type { SolvedGeometry } from '../computed-bridge.ts';
import { COMMANDS, COMPUTED, PANELS } from '../manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, type KiteMemberAspect } from '../schema.ts';
import { SolverInstance } from '../solver-runtime.ts';

/**
 * PRD §8.2 `kite.panel.diagnostics`: total / constrained / remaining DOFs
 * (constrained = numerical rank of ∂C/∂x computed in Wasm), last iteration
 * count, residual energy E(x), and the over-constrained constraints with
 * Quick Fix buttons (relax to soft, remove). Reads only; Quick Fixes run
 * commands, each one undo step.
 */

export interface DiagnosticReport {
  readonly totalDofs: number;
  readonly constrainedDofs: number;
  readonly remainingDofs: number;
  readonly rows: number;
  readonly iterations: number;
  readonly energy: number;
  readonly residual: number;
  readonly mode: SolvedGeometry['mode'];
  readonly conflicts: readonly { line: number; text: string; stress: number; soft: boolean }[];
}

export function diagnose(compiled: CompiledScope, solved: SolvedGeometry, memberPins: readonly number[]): DiagnosticReport {
  const solver = new SolverInstance(compiled);
  try {
    solver.setFrame(solved.frame);
    solver.setMemberPins(memberPins);
    solver.writeDofs(solved.dofs);
    const totalDofs = solver.freeDofCount();
    const constrainedDofs = solver.jacobianRank();
    const conflicts = compiled.constraints
      .map(constraint => ({ line: constraint.line, text: constraint.text, stress: solved.stress[constraint.index] ?? 0, soft: constraint.soft }))
      .filter(entry => entry.stress > 0.05)
      .sort((a, b) => b.stress - a.stress);
    return { totalDofs, constrainedDofs, remainingDofs: Math.max(0, totalDofs - constrainedDofs), rows: solver.rowCount(), iterations: solved.iterations, energy: solved.energy, residual: solved.residual, mode: solved.mode, conflicts };
  } finally { solver.dispose(); }
}

export function createDiagnosticsPanel(): WorkbenchPanelSpec {
  return {
    panelId: PANELS.diagnostics,
    title: 'Kite 솔버 진단',
    icon: { paths: ['M3 16l4-7 4 3 3-6 3 10'] },
    defaultZone: 'bottom',
    navigation: { group: 'document', order: 41, command: COMMANDS.openDiagnostics },
    isolation: 'container',
    mount: (host, context) => mountDiagnostics(host, context),
  };
}

function mountDiagnostics(host: HTMLElement, context: WorkbenchPanelContext): () => void {
  const doc = host.ownerDocument;
  host.replaceChildren();
  host.dataset.kitePanel = 'diagnostics';
  host.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:10px 12px;height:100%;box-sizing:border-box;overflow:auto;color:var(--alid-text,#18181b);font:12px/1.4 var(--alid-font,system-ui,sans-serif)';
  const metrics = doc.createElement('div');
  metrics.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px;font-variant-numeric:tabular-nums';
  const note = doc.createElement('div');
  note.style.cssText = 'font-size:11px;color:var(--alid-text-muted,#71717a)';
  const list = doc.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  host.append(metrics, note, list);
  let lastKey = '';

  const scopeOf = (): EntityId | undefined => {
    for (const id of context.getSelectedIds()) {
      if (context.world.getCanonical(id, SCOPE_ASPECT)) return id;
      const member = context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (member?.scopeId) return member.scopeId;
    }
    return undefined;
  };

  const metric = (label: string, value: string, tone = '') => {
    const cell = doc.createElement('div');
    cell.style.cssText = `padding:6px 8px;border-radius:6px;background:var(--alid-bg-muted,#f4f4f5);${tone}`;
    const name = doc.createElement('div'); name.textContent = label; name.style.cssText = 'font-size:10.5px;color:var(--alid-text-muted,#71717a)';
    const number = doc.createElement('div'); number.textContent = value; number.style.cssText = 'font-size:14px;font-weight:600';
    cell.dataset.metric = label;
    cell.append(name, number);
    return cell;
  };

  const format = (value: number) => !Number.isFinite(value) ? '—' : value === 0 ? '0' : Math.abs(value) < 1e-3 || Math.abs(value) >= 1e4 ? value.toExponential(2) : value.toFixed(4);

  function refresh(): void {
    const scopeId = scopeOf();
    const compiled = scopeId ? context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm) : undefined;
    const solved = scopeId ? context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry) : undefined;
    const key = scopeId && compiled && solved ? `${scopeId}|${compiled.key}|${solved.residual}|${solved.mode}` : `none|${scopeId}|${compiled?.ok}`;
    if (key === lastKey) return;
    lastKey = key;
    metrics.replaceChildren(); list.replaceChildren();
    if (!scopeId) { note.textContent = 'Kite 스코프를 선택하면 자유도와 잔차를 계산합니다.'; return; }
    if (!compiled?.ok) { note.textContent = `DSL 오류 ${compiled?.diagnostics.length ?? 0}개 — Tri-DSL 편집기에서 확인하세요.`; return; }
    if (!solved) { note.textContent = '솔버를 준비하는 중입니다.'; return; }
    const pins: number[] = [];
    for (const slot of compiled.dofs) for (const local of context.world.getCanonical<KiteMemberAspect>(compiled.bindings[slot.substanceId] ?? '', MEMBER_ASPECT)?.pinnedDofs ?? []) pins.push(slot.off + local);
    const report = diagnose(compiled, solved, pins);
    const over = report.conflicts.some(entry => !entry.soft);
    metrics.append(
      metric('Total DOFs', String(report.totalDofs)),
      metric('Constrained', String(report.constrainedDofs)),
      metric('Remaining', String(report.remainingDofs), report.remainingDofs === 0 ? 'outline:1px solid rgba(22,163,74,.4)' : ''),
      metric('Iterations', String(report.iterations)),
      metric('E(x)', format(report.energy), over ? 'color:#FF4800' : ''),
      metric('max |C|', format(report.residual), over ? 'color:#FF4800' : ''),
    );
    note.textContent = over
      ? `과구속: 동시에 만족할 수 없는 구속 ${report.conflicts.filter(entry => !entry.soft).length}개. 하나를 소프트 구속으로 완화하거나 삭제하세요.`
      : report.remainingDofs === 0 ? '완전히 구속되었습니다.' : `${report.remainingDofs}개의 자유도가 남아 있습니다 (모드: ${report.mode}).`;
    for (const conflict of report.conflicts) {
      const row = doc.createElement('div');
      row.dataset.conflictLine = String(conflict.line);
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:${conflict.soft ? 'var(--alid-bg-muted,#f4f4f5)' : 'rgba(255,72,0,.08)'}`;
      const label = doc.createElement('code');
      label.textContent = `L${conflict.line}  ${conflict.text}`;
      label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px ui-monospace,monospace';
      const stress = doc.createElement('span');
      stress.textContent = conflict.stress.toFixed(2);
      stress.style.cssText = `font:600 11px ui-monospace,monospace;color:${conflict.soft ? 'inherit' : '#FF4800'}`;
      row.append(label, stress);
      const fix = (text: string, command: typeof COMMANDS.relaxConstraint) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.dataset.quickFix = command;
        button.style.cssText = 'border:1px solid var(--alid-border-subtle,#d4d4d8);border-radius:5px;padding:3px 7px;background:transparent;color:inherit;font:600 10.5px/1.2 inherit;cursor:pointer';
        button.addEventListener('click', () => { void context.executeCommand(command, { entityId: scopeId, line: conflict.line } as JsonValue).then(() => { lastKey = ''; refresh(); }); });
        return button;
      };
      if (!conflict.soft) row.append(fix('소프트로 완화', COMMANDS.relaxConstraint));
      row.append(fix('삭제', COMMANDS.removeConstraint));
      list.append(row);
    }
  }

  const offSelection = context.onSelectionChange(() => { lastKey = ''; refresh(); });
  const offWorld = context.onWorldMutated(refresh);
  refresh();
  return () => { offSelection(); offWorld(); host.replaceChildren(); };
}
