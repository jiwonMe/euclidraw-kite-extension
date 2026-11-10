import type { ActivationContext, CanonicalPatchOp, CommandSpec, CompletionCandidate, EntityId, JsonValue, MinibufferApi } from '../host.ts';
import type { CompiledScope, BuiltinPredicate } from '../dsl/compile.ts';
import type { SolvedGeometry } from '../computed-bridge.ts';
import { applySource, commit, insertScope, randomId, readScope, scopeMembers, scopeOfSelection, select, selectedIds, topStackingKey, memberStackingKey, type ApplyResult } from '../documents.ts';
import { DEFAULT_DOMAIN, DEFAULT_STYLE, DEFAULT_SUBSTANCE } from '../defaults.ts';
import { finiteNumber } from '../dsl/lexer.ts';
import { memberGeometry, readScopeBox, toLocal } from '../geometry.ts';
import { bakeOps } from '../interop/bake.ts';
import { inducedSubgraph } from '../interop/clipboard.ts';
import { COMMANDS, COMPUTED, PANELS } from '../manifest.ts';
import { MEMBER_ASPECT, type KiteMemberAspect, type KitePrimitiveKind } from '../schema.ts';
import { actionsFor, PREDICATE_ARGS, PREDICATE_META, type ConstraintAction } from './constraint-catalog.ts';
import { loadSolverModule } from '../solver-runtime.ts';

/**
 * PRD §7.4: every Kite action is a command (so `M-x` reaches it), with
 * Hangul-initial aliases and nested `ui.completingRead` argument prompts.
 * Commands write only through documents.ts (one transaction each).
 */

export interface CommandHost {
  readonly context: ActivationContext;
  minibuffer(): MinibufferApi | undefined;
  afterApply(result: ApplyResult): void;
  openPanel(panelId: string): void;
  notify(message: string): void;
}

const record = (args: JsonValue | undefined): Record<string, JsonValue> => args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, JsonValue> : {};
const text = (value: JsonValue | undefined) => typeof value === 'string' ? value : undefined;

function requireScope(host: CommandHost, args: JsonValue | undefined): EntityId {
  const scopeId = scopeOfSelection(host.context, text(record(args).entityId));
  if (!scopeId) throw new Error('Kite 스코프나 멤버를 먼저 선택하세요.');
  return scopeId;
}

function compiledOf(host: CommandHost, scopeId: EntityId): CompiledScope {
  const compiled = host.context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
  if (!compiled?.ok) throw new Error('Kite 스코프의 DSL에 오류가 있습니다.');
  return compiled;
}

function selectedMembers(host: CommandHost, scopeId: EntityId): { id: string; kind: KitePrimitiveKind }[] {
  const out: { id: string; kind: KitePrimitiveKind }[] = [];
  for (const id of selectedIds(host.context)) {
    const member = host.context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId === scopeId) out.push({ id: member.substanceId, kind: member.primitiveKind });
  }
  return out;
}

function nextId(compiled: CompiledScope, prefix: string): string {
  for (let index = 1; ; index++) if (!compiled.instances[`${prefix}${index}`]) return `${prefix}${index}`;
}

/** Ask the user (minibuffer) or fall back to a provided default. */
async function choose<T>(host: CommandHost, prompt: string, candidates: CompletionCandidate<T>[], fallback?: T): Promise<T | null> {
  const minibuffer = host.minibuffer();
  if (!minibuffer) return fallback ?? candidates[0]?.value ?? null;
  return minibuffer.completingRead<T>({ prompt, candidates });
}

async function askNumber(host: CommandHost, prompt: string, current: number, presets: number[]): Promise<number | null> {
  const minibuffer = host.minibuffer();
  const rounded = Math.round(current * 100) / 100;
  if (!minibuffer) return rounded;
  const values = [...new Set([rounded, ...presets])];
  const picked = await minibuffer.completingRead<number | string>({
    prompt,
    candidates: (query: string) => {
      const typed = finiteNumber(query);
      const list: CompletionCandidate<number | string>[] = values.map(value => ({ id: String(value), label: String(value), detail: value === rounded ? '현재 값' : '', value }));
      if (typed !== undefined && !values.includes(typed)) list.unshift({ id: `typed:${typed}`, label: String(typed), detail: '입력한 값', value: typed });
      return list;
    },
  });
  return typeof picked === 'number' ? picked : picked === null ? null : finiteNumber(String(picked)) ?? null;
}

/** Is `typeName` (or one of its ancestors) `expected`? */
function isSubtype(compiled: CompiledScope, typeName: string, expected: string | undefined): boolean {
  if (!expected) return true;
  const seen = new Set<string>();
  for (let current: string | undefined = typeName; current && !seen.has(current); current = compiled.types[current]?.parent) {
    if (current === expected) return true;
    seen.add(current);
  }
  return false;
}

function candidatesOf(compiled: CompiledScope, kinds: readonly KitePrimitiveKind[], exclude: readonly string[], domainType?: string): CompletionCandidate<string>[] {
  return compiled.order.filter(id => kinds.includes(compiled.instances[id]!.kind) && !exclude.includes(id) && isSubtype(compiled, compiled.instances[id]!.type, domainType)).map(id => {
    const instance = compiled.instances[id]!;
    return { id, label: id, detail: `${instance.type} · ${instance.kind}`, category: instance.kind, searchText: `${instance.type} ${instance.kind}`, value: id };
  });
}

/** Run a catalog action, prompting for a value when it needs one. */
export async function runAction(host: CommandHost, scopeId: EntityId, action: ConstraintAction): Promise<ApplyResult | null> {
  let statement = action.statement;
  if (action.needsValue) {
    const compiled = compiledOf(host, scopeId);
    const solved = host.context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
    const args = statement.slice(statement.indexOf('(') + 1, statement.lastIndexOf(',')).split(',').map(value => value.trim());
    let current = 100;
    if (solved && action.needsValue === 'distance') {
      const [a, b] = args.map(id => compiled.dofs.find(slot => slot.substanceId === id)!);
      if (a && b) current = Math.hypot(solved.dofs[a.off]! - solved.dofs[b.off]!, solved.dofs[a.off + 1]! - solved.dofs[b.off + 1]!);
    }
    if (solved && action.needsValue === 'radius') { const slot = compiled.dofs.find(entry => entry.substanceId === args[0]); if (slot) current = solved.dofs[slot.off]!; }
    const value = await askNumber(host, action.needsValue === 'radius' ? '반지름' : '거리', current, [40, 60, 80, 100, 120, 160]);
    if (value === null) return null;
    statement = statement.replace(/\?\)$/, `${value})`);
  }
  const result = applySource(host.context, scopeId, { substanceDsl: appendLines(readScope(host.context.world, scopeId)!.substanceDsl, statement) }, 'constrain');
  host.afterApply(result);
  return result;
}

function appendLines(source: string, lines: string): string {
  const existing = new Set(source.split(/\r?\n/).map(line => line.trim()));
  const fresh = lines.split('\n').map(line => line.trim()).filter(line => line && !existing.has(line));
  if (!fresh.length) throw new Error('이미 같은 구속이 있습니다.');
  return `${source.replace(/\s*$/, '')}\n${fresh.join('\n')}\n`;
}

/** `kite: constrain-<predicate>` — selection first, then nested prompts for missing arguments. */
async function constrainWith(host: CommandHost, args: JsonValue | undefined, predicate: BuiltinPredicate): Promise<unknown> {
  const scopeId = requireScope(host, args);
  const compiled = compiledOf(host, scopeId);
  const slots = PREDICATE_ARGS[predicate]!;
  // A Domain predicate aliased to this builtin narrows argument types (e.g. Tangent(Line, Circle)).
  const typed = compiled.predicates[predicate]?.args ?? [];
  const picked = selectedMembers(host, scopeId).map(item => item.id);
  const chosen: string[] = [];
  for (const [index, slot] of slots.entries()) {
    const domainType = typed[index];
    const preset = picked.find(id => slot.kinds.includes(compiled.instances[id]!.kind) && !chosen.includes(id) && isSubtype(compiled, compiled.instances[id]!.type, domainType));
    if (preset) { chosen.push(preset); continue; }
    const candidates = candidatesOf(compiled, slot.kinds, chosen, domainType);
    if (!candidates.length) throw new Error(`${slot.prompt}: 해당하는 개체가 없습니다.`);
    // Nested completingRead: each prompt is a child session of the command palette.
    const value = await choose(host, `${PREDICATE_META[predicate]!.label} · ${slot.prompt}`, candidates);
    if (value === null) return null;
    chosen.push(value);
  }
  const needsValue = predicate === 'Distance' ? 'distance' : predicate === 'Radius' ? 'radius' : undefined;
  return runAction(host, scopeId, { id: `${predicate}:${chosen.join(',')}`, predicate, label: predicate, search: '', statement: `${predicate}(${chosen.join(', ')}${needsValue ? ', ?' : ''})`, ...(needsValue ? { needsValue } : {}) });
}

export function createCommands(host: CommandHost): CommandSpec[] {
  const { context } = host;
  // Every command waits for the asynchronously compiled solver module first.
  const simple = (id: CommandSpec['id'], title: string, summary: string, run: (args?: JsonValue) => unknown): CommandSpec => ({ id, title, summary, shortcutScope: 'canvas', run: async (args?: JsonValue) => { await loadSolverModule(); return run(args); } });
  const constrain = (predicate: BuiltinPredicate, id: CommandSpec['id']) => {
    const meta = PREDICATE_META[predicate]!;
    return simple(id, `kite: constrain-${predicate.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase())} · ${meta.label}`, `${meta.label} 구속을 추가합니다. 선택이 부족하면 미니버퍼에서 인자를 차례로 고릅니다. (${meta.search})`, args => constrainWith(host, args, predicate));
  };

  const addDeclaration = (kind: 'point' | 'segment' | 'circle' | 'label') => async (args?: JsonValue) => {
    const scopeId = requireScope(host, args);
    const compiled = compiledOf(host, scopeId);
    const scope = readScope(context.world, scopeId)!;
    const box = readScopeBox(context.world.getCanonicalView(), scopeId)!;
    const solved = context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
    const type = (shape: KitePrimitiveKind) => Object.values(compiled.types).find(entry => entry.shape === shape)?.name;
    let line: string | undefined;
    if (kind === 'point') {
      const name = type('point'); if (!name) throw new Error('Domain에 point 타입이 없습니다.');
      const centre = solved ? toLocal(solved.frame, box.x + box.width / 2, box.y + box.height / 2) : { x: compiled.canvas.width / 2, y: compiled.canvas.height / 2 };
      line = `${name} ${nextId(compiled, 'P')} = (${Math.round(centre.x)}, ${Math.round(centre.y)})`;
    } else if (kind === 'segment' || kind === 'circle') {
      const name = type(kind); if (!name) throw new Error(`Domain에 ${kind} 타입이 없습니다.`);
      const points = candidatesOf(compiled, ['point'], []);
      if (points.length < (kind === 'segment' ? 2 : 1)) throw new Error('점이 부족합니다.');
      const picked = selectedMembers(host, scopeId).filter(item => item.kind === 'point').map(item => item.id);
      const first = picked[0] ?? await choose(host, kind === 'segment' ? '선분의 시작점' : '원의 중심', points);
      if (!first) return null;
      const second = picked[1] ?? await choose(host, kind === 'segment' ? '선분의 끝점' : '원이 지나는 점', candidatesOf(compiled, ['point'], [first]));
      if (!second) return null;
      line = kind === 'segment' ? `${name} ${nextId(compiled, 's')} = ${first} .. ${second}` : `${name} ${nextId(compiled, 'c')} = center ${first} through ${second}`;
    } else {
      const name = type('label-anchor'); if (!name) throw new Error('Domain에 label-anchor 타입이 없습니다.');
      const target = selectedMembers(host, scopeId)[0]?.id ?? await choose(host, '라벨을 붙일 개체', candidatesOf(compiled, ['point', 'segment', 'circle', 'angle-mark', 'polygon'], []));
      if (!target) return null;
      const label = text(record(args).text) ?? target;
      const anchorKind = compiled.instances[target]!.kind;
      const anchor = anchorKind === 'point' ? 'point' : anchorKind === 'segment' ? 'midpoint' : anchorKind === 'angle-mark' ? 'bisector' : 'center';
      line = `${name} ${nextId(compiled, 'lab')} = "${label.replace(/"/g, '\\"')}" at ${anchor} ${target}${record(args).card === true ? ' card' : ''}`;
    }
    const result = applySource(context, scopeId, { substanceDsl: appendLines(scope.substanceDsl, line) }, `add-${kind}`);
    host.afterApply(result);
    return result.scopeId;
  };

  return [
    simple(COMMANDS.insert, 'kite: insert-scope · Kite 도해 추가', '정본 DSL과 수렴 시드를 가진 Kite 스코프와 멤버 엔티티를 한 번의 Undo로 만듭니다. (도해 kite ㄷㅎ)', args => {
      const options = record(args);
      return insertScope(context, {
        source: { domainDsl: text(options.domainDsl) ?? DEFAULT_DOMAIN, substanceDsl: text(options.substanceDsl) ?? DEFAULT_SUBSTANCE, styleDsl: text(options.styleDsl) ?? DEFAULT_STYLE },
        ...(typeof options.x === 'number' && typeof options.y === 'number' ? { at: { x: options.x, y: options.y } } : {}),
      });
    }),
    simple(COMMANDS.addPoint, 'kite: add-point · 점 추가', '선택한 스코프에 자유 점을 선언합니다. (점 point ㅈ)', addDeclaration('point')),
    simple(COMMANDS.addSegment, 'kite: add-segment · 선분 추가', '두 점을 잇는 선분을 선언합니다. (선분 segment ㅅㅂ)', addDeclaration('segment')),
    simple(COMMANDS.addCircle, 'kite: add-circle · 원 추가', '중심과 지나는 점으로 원을 선언합니다. (원 circle ㅇ)', addDeclaration('circle')),
    simple(COMMANDS.addLabel, 'kite: add-label · 라벨 추가', '점·선분 중점·각의 이등분선·중심에 라벨을 붙입니다. card: true이면 markdown-card 수식 라벨입니다. (라벨 label ㄹㅂ)', addDeclaration('label')),
    simple(COMMANDS.apply, 'kite: apply-dsl · DSL 적용', '세 DSL을 한 트랜잭션으로 적용하고 완화 애니메이션 뒤 수렴 시드를 기록합니다.', args => {
      const options = record(args);
      const scopeId = requireScope(host, args);
      const result = applySource(context, scopeId, {
        ...(text(options.domainDsl) !== undefined ? { domainDsl: text(options.domainDsl)! } : {}),
        ...(text(options.substanceDsl) !== undefined ? { substanceDsl: text(options.substanceDsl)! } : {}),
        ...(text(options.styleDsl) !== undefined ? { styleDsl: text(options.styleDsl)! } : {}),
      });
      host.afterApply(result);
      return { residual: result.residual };
    }),
    simple(COMMANDS.reset, 'kite: reset-example · 예제로 복원', '선택한 스코프를 기본 예제로 되돌립니다.', args => {
      const result = applySource(context, requireScope(host, args), { domainDsl: DEFAULT_DOMAIN, substanceDsl: DEFAULT_SUBSTANCE, styleDsl: DEFAULT_STYLE }, 'reset-example');
      host.afterApply(result);
      return result.scopeId;
    }),
    simple(COMMANDS.constrain, 'kite: constrain · 구속 추가', '선택한 1~3개 멤버에 가능한 구속을 고릅니다. (구속 constrain ㄱㅅ)', async args => {
      const scopeId = requireScope(host, args);
      const compiled = compiledOf(host, scopeId);
      const actions = actionsFor(compiled, selectedMembers(host, scopeId));
      if (!actions.length) throw new Error('선택한 조합에 가능한 구속이 없습니다. 점·선분·원을 1~3개 선택하세요.');
      const action = await choose(host, '구속 선택', actions.map(item => ({ id: item.id, label: item.label, detail: item.statement, searchText: item.search, value: item })));
      return action ? runAction(host, scopeId, action) : null;
    }),
    constrain('Tangent', COMMANDS.constrainTangent),
    constrain('Perpendicular', COMMANDS.constrainPerpendicular),
    constrain('Parallel', COMMANDS.constrainParallel),
    constrain('OnCircle', COMMANDS.constrainOnCircle),
    constrain('Midpoint', COMMANDS.constrainMidpoint),
    constrain('EqualLength', COMMANDS.constrainEqualLength),
    constrain('Distance', COMMANDS.constrainDistance),
    simple(COMMANDS.relaxConstraint, 'kite: relax-constraint · 구속 완화', '하드 구속을 soft 구속으로 바꿉니다. 과구속 Quick Fix. (완화 soft ㅇㅎ)', async args => {
      const scopeId = requireScope(host, args);
      const line = await pickConstraintLine(host, scopeId, args, constraint => !constraint.soft && !constraint.implicit, '완화할 구속');
      if (line === null) return null;
      const scope = readScope(context.world, scopeId)!;
      const lines = scope.substanceDsl.split(/\r?\n/);
      lines[line - 1] = lines[line - 1]!.replace(/^(\s*)/, '$1soft ');
      const result = applySource(context, scopeId, { substanceDsl: lines.join('\n') }, 'relax-constraint');
      host.afterApply(result);
      return result.residual;
    }),
    simple(COMMANDS.removeConstraint, 'kite: remove-constraint · 구속 삭제', 'Substance에서 구속 문장을 지웁니다. 과구속 Quick Fix. (삭제 remove ㅅㅈ)', async args => {
      const scopeId = requireScope(host, args);
      const line = await pickConstraintLine(host, scopeId, args, constraint => !constraint.implicit, '삭제할 구속');
      if (line === null) return null;
      const scope = readScope(context.world, scopeId)!;
      const lines = scope.substanceDsl.split(/\r?\n/);
      lines.splice(line - 1, 1);
      const result = applySource(context, scopeId, { substanceDsl: lines.join('\n') }, 'remove-constraint');
      host.afterApply(result);
      return result.residual;
    }),
    simple(COMMANDS.pin, 'kite: toggle-pin · 핀 고정', '선택한 점의 자유도를 고정하거나 해제합니다. (핀 pin ㅍ)', () => {
      const ops: CanonicalPatchOp[] = [];
      for (const id of selectedIds(context)) {
        const member = context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
        if (!member || context.world.isEntityReadOnly(id)) continue;
        const full = member.primitiveKind === 'point' ? [0, 1] : member.primitiveKind === 'circle' ? [0] : [];
        if (!full.length) continue;
        ops.push({ id, aspect: MEMBER_ASPECT, patch: { pinnedDofs: (member.pinnedDofs ?? []).length ? [] : full } });
      }
      if (!ops.length) throw new Error('점이나 원 멤버를 선택하세요.');
      commit(context, 'toggle-pin', ops);
      return ops.length;
    }),
    simple(COMMANDS.reproject, 'kite: reproject · 다시 수렴', '현재 DSL과 시드에서 솔버를 다시 돌려 수렴 시드를 갱신합니다.', args => {
      const result = applySource(context, requireScope(host, args), {}, 'reproject');
      host.afterApply(result);
      return { residual: result.residual };
    }),
    simple(COMMANDS.bake, 'kite: bake-to-vector · 벡터로 베이킹', '수렴된 기하를 구속 없는 vector.path·markdown.card 엔티티로 바꾸고 스코프를 제거합니다. (베이킹 bake ㅂㅇㅋ)', args => bake(host, requireScope(host, args))),
    simple(COMMANDS.extract, 'kite: extract-subgraph · 부분 도해 분리', '선택한 멤버와 그 사이에 닫힌 구속만으로 새 스코프를 만듭니다. (분리 extract ㅂㄹ)', args => {
      const scopeId = requireScope(host, args);
      const compiled = compiledOf(host, scopeId);
      const picked = selectedMembers(host, scopeId).map(item => item.id);
      if (!picked.length) throw new Error('분리할 멤버를 선택하세요.');
      const scope = readScope(context.world, scopeId)!;
      const { substanceDsl } = inducedSubgraph(compiled, scope, picked);
      const box = readScopeBox(context.world.getCanonicalView(), scopeId)!;
      return insertScope(context, { source: { domainDsl: scope.domainDsl, substanceDsl, styleDsl: scope.styleDsl }, at: { x: box.x + box.width * 1.5 + 40, y: box.y + box.height / 2 }, size: { width: box.width, height: box.height } });
    }),
    simple(COMMANDS.setParam, 'kite: set-param · 스타일 파라미터', 'Style의 param 값을 바꿉니다(Tri-DSL의 DialKit 슬라이더와 같은 경로).', async args => {
      const scopeId = requireScope(host, args);
      const compiled = compiledOf(host, scopeId);
      const options = record(args);
      const name = text(options.name) ?? await choose(host, '파라미터', compiled.params.map(param => ({ id: param.name, label: `${param.name} = ${param.value}`, detail: `${param.min} ~ ${param.max}`, value: param.name })));
      if (!name) return null;
      const param = compiled.params.find(entry => entry.name === name);
      if (!param) throw new Error(`param ${name}이(가) 없습니다.`);
      const value = typeof options.value === 'number' ? options.value : await askNumber(host, `${name} 값`, param.value, [param.min, (param.min + param.max) / 2, param.max]);
      if (value === null) return null;
      const result = applySource(context, scopeId, { styleDsl: setParamValue(readScope(context.world, scopeId)!.styleDsl, name, value) }, 'set-param');
      host.afterApply(result);
      return value;
    }),
    simple(COMMANDS.openEditor, 'kite: open-tri-editor · Tri-DSL 편집기', 'Domain · Substance · Style 편집 패널을 엽니다.', () => { host.openPanel(PANELS.triEditor); return true; }),
    simple(COMMANDS.openDiagnostics, 'kite: open-diagnostics · 솔버 진단', '자유도·잔차·과구속 진단 패널을 엽니다.', () => { host.openPanel(PANELS.diagnostics); return true; }),
  ];
}

async function pickConstraintLine(host: CommandHost, scopeId: EntityId, args: JsonValue | undefined, filter: (constraint: CompiledScope['constraints'][number]) => boolean, prompt: string): Promise<number | null> {
  const explicit = record(args).line;
  if (typeof explicit === 'number') return explicit;
  const compiled = compiledOf(host, scopeId);
  const solved = host.context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
  const candidates = compiled.constraints.filter(filter).map(constraint => ({ id: String(constraint.line), label: constraint.text, detail: `L${constraint.line} · 잔차 ${(solved?.stress[constraint.index] ?? 0).toFixed(3)}`, value: constraint.line }));
  candidates.sort((a, b) => (solved?.stress[compiled.constraints.find(c => c.line === b.value)!.index] ?? 0) - (solved?.stress[compiled.constraints.find(c => c.line === a.value)!.index] ?? 0));
  if (!candidates.length) throw new Error('해당하는 구속이 없습니다.');
  return choose(host, prompt, candidates);
}

export function setParamValue(style: string, name: string, value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return style.replace(new RegExp(`^(\\s*param\\s+${name}\\s*=\\s*)([^\\s]+)`, 'm'), `$1${rounded}`);
}

/** bake-to-vector: one transaction creates the vector entities and deletes the scope and members. */
function bake(host: CommandHost, scopeId: EntityId): EntityId[] {
  const { context } = host;
  const world = context.world;
  const compiled = compiledOf(host, scopeId);
  const solved = world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
  if (!solved) throw new Error('Kite 솔버가 아직 준비되지 않았습니다.');
  const members = { ...readScope(world, scopeId)!.entityBindings, ...scopeMembers(world.getCanonicalView(), scopeId) };
  const hasVectorPath = world.hasCanonicalSpec?.('vector.path') === true;
  const hasMarkdownCard = world.hasCanonicalSpec?.('markdown.card') === true;
  if (!hasVectorPath) throw new Error('벡터로 베이킹하려면 vector.pen-suite 확장이 필요합니다.');
  const top = topStackingKey(world);
  const entries = compiled.order.map(substanceId => {
    const entityId = members[substanceId]!;
    const geometry = memberGeometry(compiled, solved, scopeId, substanceId);
    if (!geometry) return undefined;
    const card = world.getCanonical<{ body?: string }>(entityId, 'markdown.card');
    const transform = card ? world.getCanonical<{ x: number; y: number }>(entityId, 'core.transform') : undefined;
    const bounds = card ? world.getCanonical<{ width: number; height: number }>(entityId, 'core.bounds') : undefined;
    return { entityId, geometry, ...(card && transform && bounds ? { card: { x: transform.x, y: transform.y, width: bounds.width, height: bounds.height, body: String(card.body ?? '') } } : {}) };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const { ops, created } = bakeOps(entries, { newId: prefix => randomId(prefix), stackingKey: index => memberStackingKey(`${top}V`, index), hasVectorPath, hasMarkdownCard });
  const removals: CanonicalPatchOp[] = [scopeId, ...Object.values(members)].map(id => ({ id, aspect: MEMBER_ASPECT, patch: null }));
  commit(context, 'bake-to-vector', [...ops, ...removals]);
  select(context, created[0] ?? null);
  return created;
}

