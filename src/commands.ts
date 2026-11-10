import type {
  ActivationContext, CommandSpec, CompiledScope, EntityId, JsonValue, MemberProps, ScopeProps, SolvedState,
} from './types.ts';
import { COMMANDS, MEMBER_ASPECT_ID, SCOPE_ASPECT_ID } from './manifest.ts';
import {
  appendSubstanceLine, applyDsl, compileOrThrow, freezeSubstance, insertDiagram,
  nextSubstanceId, resetExample, selectedIds, selectedScope, withHistory,
} from './tools/documents.ts';
import { compileScope } from './dsl/compile.ts';
import { memberPinsFrom, seedsFromValues, solveState } from './solver/solve.ts';
import { scopeBox } from './geometry.ts';
import { readScope } from './defaults.ts';

interface SelectedInstance {
  entityId: EntityId;
  scopeId: EntityId;
  substanceId: string;
  kind: string;
}

function selectedInstances(context: ActivationContext): SelectedInstance[] {
  const selected = selectedScope(context);
  if (!selected) return [];
  const result: SelectedInstance[] = [];
  for (const id of selectedIds(context)) {
    const member = context.world.getCanonical<MemberProps>(id, MEMBER_ASPECT_ID);
    if (member?.scopeId === selected.scopeId && member.substanceId) result.push({ entityId: id, scopeId: member.scopeId, substanceId: member.substanceId, kind: member.primitiveKind });
  }
  return result;
}

function requireMembers(context: ActivationContext): SelectedInstance[] {
  const instances = selectedInstances(context);
  if (!instances.length) throw new Error('Kite 멤버를 먼저 선택하세요.');
  const scopeId = instances[0]!.scopeId;
  if (instances.some(instance => instance.scopeId !== scopeId)) throw new Error('같은 Kite 스코프의 멤버만 선택하세요.');
  return instances;
}

function findKind(instances: SelectedInstance[], kind: string): SelectedInstance | undefined {
  return instances.find(instance => instance.kind === kind);
}

function findLine(instances: SelectedInstance[]): SelectedInstance[] {
  return instances.filter(instance => instance.kind === 'segment' || instance.kind === 'line' || instance.kind === 'ray');
}

export function applyConstraintLine(context: ActivationContext, line: string): unknown {
  const selected = selectedScope(context);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const scope = readScope(selected.scope);
  if (scope.substanceDsl.includes(line)) throw new Error(`이미 같은 구속이 있습니다: ${line}`);
  return applyDsl(context, { entityId: selected.scopeId, substanceDsl: appendSubstanceLine(scope, line) });
}

export function constrainOnCircle(context: ActivationContext): unknown {
  const instances = requireMembers(context);
  const point = findKind(instances, 'point');
  const circle = findKind(instances, 'circle');
  if (!point || !circle) throw new Error('점 하나와 원 하나를 선택하세요.');
  return applyConstraintLine(context, `OnCircle(${point.substanceId}, ${circle.substanceId})`);
}

export function constrainMidpoint(context: ActivationContext): unknown {
  const instances = requireMembers(context);
  const points = instances.filter(instance => instance.kind === 'point');
  const line = findLine(instances)[0];
  if (points.length === 3) return applyConstraintLine(context, `Midpoint(${points[0]!.substanceId}, ${points[1]!.substanceId}, ${points[2]!.substanceId})`);
  if (points.length === 1 && line) {
    const selected = selectedScope(context)!;
    const compiled = compileOrThrow(readScope(selected.scope));
    const instance = compiled.instances.get(line.substanceId);
    if (!instance?.a || !instance.b) throw new Error('선분의 두 끝점을 찾을 수 없습니다.');
    return applyConstraintLine(context, `Midpoint(${points[0]!.substanceId}, ${instance.a}, ${instance.b})`);
  }
  throw new Error('점 3개, 또는 점 하나와 선분 하나를 선택하세요.');
}

export function constrainPerpendicular(context: ActivationContext): unknown {
  const lines = findLine(requireMembers(context));
  if (lines.length !== 2) throw new Error('선분 두 개를 선택하세요.');
  return applyConstraintLine(context, `Perpendicular(${lines[0]!.substanceId}, ${lines[1]!.substanceId})`);
}

export function constrainEqualLength(context: ActivationContext): unknown {
  const lines = findLine(requireMembers(context));
  if (lines.length !== 2) throw new Error('선분 두 개를 선택하세요.');
  return applyConstraintLine(context, `EqualLength(${lines[0]!.substanceId}, ${lines[1]!.substanceId})`);
}

export function constrainHorizontal(context: ActivationContext): unknown {
  const line = findLine(requireMembers(context))[0];
  if (!line) throw new Error('선분 하나를 선택하세요.');
  return applyConstraintLine(context, `Horizontal(${line.substanceId})`);
}

export function constrainVertical(context: ActivationContext): unknown {
  const line = findLine(requireMembers(context))[0];
  if (!line) throw new Error('선분 하나를 선택하세요.');
  return applyConstraintLine(context, `Vertical(${line.substanceId})`);
}

export function constrainTangent(context: ActivationContext): unknown {
  const instances = requireMembers(context);
  const line = findLine(instances)[0];
  const circle = findKind(instances, 'circle');
  if (!line || !circle) throw new Error('선분 하나와 원 하나를 선택하세요.');
  return applyConstraintLine(context, `Tangent(${line.substanceId}, ${circle.substanceId})`);
}

export async function setDistance(context: ActivationContext): Promise<unknown> {
  const instances = requireMembers(context);
  const points = instances.filter(instance => instance.kind === 'point');
  if (points.length !== 2) throw new Error('점 두 개를 선택하세요.');
  const selected = selectedScope(context)!;
  const compiled = compileOrThrow(readScope(selected.scope));
  const solved = solveDistance(selected.scope, compiled);
  const current = nearestPair(compiled, solved, points[0]!.substanceId, points[1]!.substanceId);
  const value = await askNumber(context, 'Distance 값', current, [30, 60, 90, 120, 180, 240]);
  if (value === null) return null;
  return applyConstraintLine(context, `Distance(${points[0]!.substanceId}, ${points[1]!.substanceId}, ${round(value)})`);
}

function solveDistance(scope: ScopeProps, compiled: CompiledScope): SolvedState {
  return solveState(compiled, { seeds: scope.convergedSeeds, memberPins: emptyPins(), config: scope.solverConfig, iterations: 0 });
}

function emptyPins() { return { pinnedDofs: new Map<string, number[]>(), slackWeight: new Map<string, number>() }; }

function nearestPair(compiled: CompiledScope, state: SolvedState, a: string, b: string): number {
  const value = compiled.instances.get(a), other = compiled.instances.get(b);
  if (!value || !other) return 100;
  const ai = compiled.dofs.find(slot => slot.instanceId === a), bi = compiled.dofs.find(slot => slot.instanceId === b);
  if (!ai || !bi) return 100;
  return Math.round(Math.hypot(state.values[ai.offset]! - state.values[bi.offset]!, state.values[ai.offset + 1]! - state.values[bi.offset + 1]!) * 10) / 10;
}

async function askNumber(context: ActivationContext, prompt: string, current: number, common: number[]): Promise<number | null> {
  const minibuffer = context.getExtensionApi?.<{ completingRead?<T>(options: { prompt: string; candidates: { id: string; label: string; value: T }[] }): Promise<T | null> }>('sys.minibuffer');
  if (minibuffer?.completingRead) {
    const values = [...new Set([round(current), ...common])];
    return minibuffer.completingRead<number>({ prompt, candidates: values.map(value => ({ id: String(value), label: `${value}`, value })) });
  }
  return round(current);
}

export function addPoint(context: ActivationContext, input: { entityId?: string } = {}): unknown {
  const selected = selectedScope(context, input.entityId);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const scope = readScope(selected.scope);
  const compiled = compileOrThrow(scope);
  const box = scopeBox(selected.scopeId, context.world.getCanonicalView());
  const id = nextSubstanceId(compiled, 'P');
  const x = Math.round((box?.width ?? 520) / 2);
  const y = Math.round((box?.height ?? 360) / 2);
  return applyDsl(context, { entityId: selected.scopeId, substanceDsl: appendSubstanceLine(scope, `Point ${id} = (${x}, ${y})`) });
}

export function freezeGeometry(context: ActivationContext, input: { entityId?: string } = {}): unknown {
  const selected = selectedScope(context, input.entityId);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const scope = readScope(selected.scope);
  return applyDsl(context, { entityId: selected.scopeId, substanceDsl: freezeSubstance(scope.substanceDsl) });
}

export function reproject(context: ActivationContext, input: { entityId?: string } = {}): unknown {
  const selected = selectedScope(context, input.entityId);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const scope = readScope(selected.scope);
  const compiled = compileOrThrow(scope);
  const pins = memberPinsFrom(compiled, context.world.getCanonicalView());
  const state = solveState(compiled, { seeds: scope.convergedSeeds, memberPins: pins, config: scope.solverConfig, iterations: 240 });
  const seeds = seedsFromValues(compiled, state.values);
  withHistory(context, () => {
    context.world.applyCanonicalTransaction(COMMANDS.reproject, [{ id: selected.scopeId, aspect: SCOPE_ASPECT_ID, patch: { convergedSeeds: seeds } }], 'local:user');
  });
  return { residual: state.residual, converged: state.converged };
}

export function repairBindings(context: ActivationContext, input: { entityId?: string } = {}): unknown {
  const selected = selectedScope(context, input.entityId);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const scope = readScope(selected.scope);
  const bindings: Record<string, EntityId> = {};
  const duplicates: EntityId[] = [];
  for (const id of context.world.listEntityIds()) {
    const member = context.world.getCanonical<MemberProps>(id, MEMBER_ASPECT_ID);
    if (member?.scopeId !== selected.scopeId || !member.substanceId) continue;
    if (bindings[member.substanceId]) { duplicates.push(id); continue; }
    bindings[member.substanceId] = id;
  }
  const draft: ScopeProps = { ...scope, entityBindings: bindings };
  const compiled = compileOrThrow(draft);
  const pins = memberPinsFrom(compiled, context.world.getCanonicalView());
  const state = solveState(compiled, { seeds: draft.convergedSeeds, memberPins: pins, config: draft.solverConfig, iterations: 180 });
  const seeds = seedsFromValues(compiled, state.values);
  withHistory(context, () => {
    context.world.applyCanonicalTransaction(COMMANDS.repair, [
      ...duplicates.map(id => ({ id, aspect: MEMBER_ASPECT_ID, patch: null })),
      { id: selected.scopeId, aspect: SCOPE_ASPECT_ID, patch: { entityBindings: bindings, convergedSeeds: seeds } },
    ], 'local:user');
  });
  return { bindings: Object.keys(bindings).length, removed: duplicates.length };
}

export interface ConstraintChoice { id: string; label: string; run(): unknown }

export function availableConstraints(context: ActivationContext): ConstraintChoice[] {
  const instances = selectedInstances(context);
  const points = instances.filter(instance => instance.kind === 'point');
  const line = findLine(instances)[0];
  const circle = findKind(instances, 'circle');
  const lines = findLine(instances);
  const choices: ConstraintChoice[] = [];
  if (points.length === 1 && circle) choices.push({ id: 'on-circle', label: '원 위에 배치 OnCircle', run: () => constrainOnCircle(context) });
  if (lines.length === 2) {
    choices.push({ id: 'perpendicular', label: '직교 ⊥ Perpendicular', run: () => constrainPerpendicular(context) });
    choices.push({ id: 'equal-length', label: '등길이 = EqualLength', run: () => constrainEqualLength(context) });
  }
  if (points.length === 3 || (points.length === 1 && line)) choices.push({ id: 'midpoint', label: '중점 Midpoint', run: () => constrainMidpoint(context) });
  if (points.length === 2) choices.push({ id: 'distance', label: '거리 Distance', run: () => setDistance(context) });
  if (line && circle) choices.push({ id: 'tangent', label: '접선 Tangent', run: () => constrainTangent(context) });
  if (line) {
    choices.push({ id: 'horizontal', label: '수평 Horizontal', run: () => constrainHorizontal(context) });
    choices.push({ id: 'vertical', label: '수직 Vertical', run: () => constrainVertical(context) });
  }
  return choices;
}

export async function addConstraint(context: ActivationContext): Promise<unknown> {
  const choices = availableConstraints(context);
  if (!choices.length) throw new Error('선택한 멤버 조합에 사용할 수 있는 구속이 없습니다. 점·선분·원을 함께 선택하세요.');
  const minibuffer = context.getExtensionApi?.<{ completingRead?<T>(options: { prompt: string; candidates: { id: string; label: string; value: T }[] }): Promise<T | null> }>('sys.minibuffer');
  if (minibuffer?.completingRead) {
    const chosen = await minibuffer.completingRead<ConstraintChoice>({ prompt: 'Kite 구속 선택', candidates: choices.map(choice => ({ id: choice.id, label: choice.label, value: choice })) });
    if (!chosen) return null;
    return chosen.run();
  }
  return choices[0]!.run();
}

function inputOf(args: JsonValue | undefined): { entityId?: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const record = args as { readonly [key: string]: JsonValue };
  return typeof record.entityId === 'string' ? { entityId: record.entityId } : {};
}

export function createCommandSpecs(context: ActivationContext): CommandSpec[] {
  const run = (fn: () => unknown) => () => fn();
  return [
    { id: COMMANDS.insert, title: 'Kite 다이어그램 추가', summary: 'Domain · Substance · Style 예제와 멤버 엔티티를 한 번에 만듭니다.', shortcutScope: 'canvas', run: run(() => insertDiagram(context)) },
    { id: COMMANDS.apply, title: 'Kite DSL 적용', summary: '선택한 Kite 스코프의 세 DSL을 한 번의 Undo로 적용하고 다시 수렴합니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => applyDsl(context, (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Parameters<typeof applyDsl>[1]) },
    { id: COMMANDS.reset, title: 'Kite 기본 예제로 복원', summary: '선택한 Kite 스코프를 기본 예제로 되돌립니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => resetExample(context, inputOf(args)) },
    { id: COMMANDS.addPoint, title: 'Kite 점 추가', summary: '선택한 스코프에 자유 점을 추가합니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => addPoint(context, inputOf(args)) },
    { id: COMMANDS.addConstraint, title: 'Kite 구속 추가', summary: '선택한 멤버 조합에 가능한 기하 구속을 제시합니다.', shortcutScope: 'canvas', run: () => addConstraint(context) },
    { id: COMMANDS.onCircle, title: 'Kite: 원 위에 배치', summary: '선택한 점과 원에 OnCircle 구속을 추가합니다.', shortcutScope: 'canvas', run: run(() => constrainOnCircle(context)) },
    { id: COMMANDS.midpoint, title: 'Kite: 중점', summary: '선택한 점을 두 점의 중점으로 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainMidpoint(context)) },
    { id: COMMANDS.perpendicular, title: 'Kite: 직교', summary: '선택한 두 선분을 직교로 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainPerpendicular(context)) },
    { id: COMMANDS.equalLength, title: 'Kite: 등길이', summary: '선택한 두 선분의 길이를 같게 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainEqualLength(context)) },
    { id: COMMANDS.horizontal, title: 'Kite: 수평', summary: '선택한 선분을 수평으로 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainHorizontal(context)) },
    { id: COMMANDS.vertical, title: 'Kite: 수직', summary: '선택한 선분을 수직으로 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainVertical(context)) },
    { id: COMMANDS.tangent, title: 'Kite: 접선', summary: '선택한 선분과 원을 접하도록 구속합니다.', shortcutScope: 'canvas', run: run(() => constrainTangent(context)) },
    { id: COMMANDS.distance, title: 'Kite: 거리 지정', summary: '선택한 두 점 사이 거리를 지정합니다.', shortcutScope: 'canvas', run: () => setDistance(context) },
    { id: COMMANDS.freeze, title: 'Kite: 기하 고정', summary: '모든 구속을 제거하고 현재 좌표를 핀으로 고정합니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => freezeGeometry(context, inputOf(args)) },
    { id: COMMANDS.repair, title: 'Kite: 바인딩 복구', summary: '스코프의 substanceId ↔ 엔티티 바인딩을 실제 멤버에서 다시 만듭니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => repairBindings(context, inputOf(args)) },
    { id: COMMANDS.reproject, title: 'Kite: 다시 수렴', summary: '현재 정본에서 솔버를 다시 돌려 시드를 갱신합니다.', shortcutScope: 'canvas', run: (args?: JsonValue) => reproject(context, inputOf(args)) },
  ];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scopeSummary(scope: ScopeProps): { substances: number; constraints: number } {
  const compiled = compileScope(scope);
  return { substances: compiled.instances.size, constraints: compiled.constraints.length };
}
