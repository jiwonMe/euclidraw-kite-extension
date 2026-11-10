import type {
  ActivationContext, CanvasToolSurface, CanonicalPatchOp, CompiledScope, EntityId, JsonValue, MemberPins,
  ScopeProps, SolvedScope, SymbolId,
} from '../types.ts';
import { solveScope } from '../solver/runtime.ts';
import { seedsFromValues, solveState } from '../solver/solve.ts';
import { COMMANDS, EXTENSION_ID, MEMBER_ASPECT_ID, SCOPE_ASPECT_ID } from '../manifest.ts';
import { createScopeDefaults, DEFAULT_HEIGHT, DEFAULT_WIDTH, normalizeSolverConfig, readScope } from '../defaults.ts';
import { scopeBox } from '../geometry.ts';
import { compileScope } from '../dsl/compile.ts';

export interface ScopeSelection { scopeId: EntityId; scope: ScopeProps }

const ORDER_DIGITS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? uuid.replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
}

/** Lexicographic stacking key above the host default (`V`). */
export function orderKey(index: number): string {
  let value = index + 1, key = '';
  while (value > 0) { key = ORDER_DIGITS[(value - 1) % ORDER_DIGITS.length]! + key; value = Math.floor((value - 1) / ORDER_DIGITS.length); }
  return `V${key}`;
}

export function surfaceOf(context: ActivationContext): CanvasToolSurface | undefined {
  return context.services.get<{ get(): CanvasToolSurface | undefined }>('canvas.active-tool-surface')?.get();
}

export function selectionSuite(context: ActivationContext): { getSelection?(): readonly EntityId[]; select?(id: EntityId | null): void } | undefined {
  try { return context.services.get('canvas.selection'); } catch { return undefined; }
}

export function selectedIds(context: ActivationContext): EntityId[] {
  const surface = surfaceOf(context);
  if (surface) return [...surface.selection.getSelection()];
  const suite = selectionSuite(context);
  if (suite?.getSelection) return [...suite.getSelection()];
  return [];
}

export function selectEntity(context: ActivationContext, id: EntityId | null): void {
  const surface = surfaceOf(context);
  if (surface) { surface.selection.select(id); return; }
  const suite = selectionSuite(context);
  if (suite?.select) suite.select(id);
}

export function selectedScope(context: ActivationContext, explicitId?: string): ScopeSelection | undefined {
  const ids = explicitId ? [explicitId] : selectedIds(context);
  for (const id of ids) {
    const scope = context.world.getCanonical<ScopeProps>(id, SCOPE_ASPECT_ID);
    if (scope) return { scopeId: id, scope: readScope(scope) };
    const member = context.world.getCanonical<{ scopeId?: string }>(id, MEMBER_ASPECT_ID);
    if (member?.scopeId) {
      const parent = context.world.getCanonical<ScopeProps>(member.scopeId, SCOPE_ASPECT_ID);
      if (parent) return { scopeId: member.scopeId, scope: readScope(parent) };
    }
  }
  return undefined;
}

export function withHistory<T>(context: ActivationContext, run: () => T): T {
  const history = surfaceOf(context)?.host.history ?? context.services.get<{ history?: { begin(): void; commit(): void; abort(): void } }>('canvas.interaction')?.history;
  history?.begin();
  try {
    const result = run();
    history?.commit();
    return result;
  } catch (error) {
    history?.abort();
    throw error;
  }
}

export function viewportCenter(context: ActivationContext): { x: number; y: number } {
  const surface = surfaceOf(context);
  const element = surface?.surface.element ?? context.services.get<{ element?: HTMLElement }>('canvas.surface')?.element;
  const interaction = surface?.host ?? context.services.get<{ screenToWorld(x: number, y: number, out: { x: number; y: number }): void }>('canvas.interaction');
  if (!element || !interaction?.screenToWorld) return { x: 0, y: 0 };
  const rect = element.getBoundingClientRect();
  const point = { x: 0, y: 0 };
  interaction.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, point);
  return point;
}

export function compileOrThrow(scope: Readonly<ScopeProps>): CompiledScope {
  const compiled = compileScope(scope);
  if (!compiled.ok) {
    const detail = compiled.errors.slice(0, 5).map(error => `L${error.line}: ${error.message}`).join('\n');
    throw new Error(`Kite DSL 오류\n${detail}`);
  }
  return compiled;
}

export function nextMemberId(context: ActivationContext, scopeId: EntityId, index: number): EntityId {
  const base = `${scopeId}_${index.toString(36)}`;
  let id = base, suffix = 0;
  while (context.world.isAlive(id)) { suffix++; id = `${base}_${suffix}`; }
  return id;
}

/** Reconcile member entities with the declarations while preserving live bindings. */
export function syncMembers(
  context: ActivationContext,
  scopeId: EntityId,
  compiled: CompiledScope,
  existing: Record<string, EntityId>,
): { bindings: Record<string, EntityId>; ops: CanonicalPatchOp[] } {
  const bindings: Record<string, EntityId> = {};
  const ops: CanonicalPatchOp[] = [];
  const claimed = new Set<EntityId>();
  let index = 0;
  for (const instance of compiled.instances.values()) {
    const previous = existing[instance.id];
    let entityId = previous && context.world.isAlive(previous) && context.world.getCanonical(previous, MEMBER_ASPECT_ID) ? previous : undefined;
    if (entityId && claimed.has(entityId)) entityId = undefined;
    if (!entityId) entityId = nextMemberId(context, scopeId, index);
    claimed.add(entityId);
    bindings[instance.id] = entityId;
    const current = context.world.getCanonical<{ primitiveKind?: string; substanceId?: string; scopeId?: string }>(entityId, MEMBER_ASPECT_ID);
    if (!current || current.primitiveKind !== instance.kind || current.substanceId !== instance.id || current.scopeId !== scopeId) {
      ops.push({
        id: entityId,
        aspect: MEMBER_ASPECT_ID,
        patch: {
          ...(current ?? {}),
          scopeId,
          substanceId: instance.id,
          primitiveKind: instance.kind,
          ...(current ? {} : { pinnedDofs: [], slackWeight: 1 }),
        },
      });
    }
    if (!context.world.getCanonical(entityId, 'core.stacking')) ops.push({ id: entityId, aspect: 'core.stacking', patch: { order: orderKey(index) } });
    index++;
  }
  for (const [substanceId, entityId] of Object.entries(existing)) {
    if (!compiled.instances.has(substanceId) && !claimed.has(entityId) && context.world.isAlive(entityId)) {
      ops.push({ id: entityId, aspect: MEMBER_ASPECT_ID, patch: null });
    }
  }
  return { bindings, ops };
}

export function insertDiagram(context: ActivationContext): EntityId {
  const scopeId = `ent_kite_${randomId()}`;
  const center = viewportCenter(context);
  const base = createScopeDefaults();
  const draft: ScopeProps = {
    ...base,
    entityBindings: {},
    convergedSeeds: {},
  };
  const first = compileOrThrow(draft);
  const { bindings, ops: memberOps } = syncMembers(context, scopeId, first, {});
  const withBindings: ScopeProps = { ...draft, entityBindings: bindings };
  const compiled = compileOrThrow(withBindings);
  const pins: MemberPins = { pinnedDofs: new Map(), slackWeight: new Map() };
  const state = solveState(compiled, { seeds: {}, memberPins: pins, config: draft.solverConfig, iterations: 240 });
  const seeds = seedsFromValues(compiled, state.values);
  const x = center.x - DEFAULT_WIDTH / 2;
  const y = center.y - DEFAULT_HEIGHT / 2;
  const ops: CanonicalPatchOp[] = [
    { id: scopeId, aspect: 'core.transform', patch: { x, y, rotation: 0 } },
    { id: scopeId, aspect: 'core.bounds', patch: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT } },
    { id: scopeId, aspect: 'core.stacking', patch: { order: 'V' } },
    {
      id: scopeId,
      aspect: SCOPE_ASPECT_ID,
      patch: {
        ...draft,
        entityBindings: bindings,
        convergedSeeds: seeds,
      },
    },
    ...memberOps,
  ];
  withHistory(context, () => {
    context.world.applyCanonicalTransaction(COMMANDS.insert, ops, 'local:user');
  });
  selectEntity(context, scopeId);
  surfaceOf(context)?.host.requestRender();
  return scopeId;
}

export interface ApplyDslInput {
  entityId?: string;
  domainDsl?: string;
  substanceDsl?: string;
  styleDsl?: string;
  solverConfig?: Partial<ScopeProps['solverConfig']>;
}

export interface ApplyDslResult {
  scopeId: EntityId;
  residual: number;
  seeds: Record<EntityId, number[]>;
  errors: { line: number; message: string }[];
}

export function applyDsl(context: ActivationContext, input: ApplyDslInput = {}): ApplyDslResult {
  const selected = selectedScope(context, input.entityId);
  if (!selected) throw new Error('Kite 스코프를 선택하세요.');
  const draft = readScope({
    ...selected.scope,
    ...(typeof input.domainDsl === 'string' ? { domainDsl: input.domainDsl } : {}),
    ...(typeof input.substanceDsl === 'string' ? { substanceDsl: input.substanceDsl } : {}),
    ...(typeof input.styleDsl === 'string' ? { styleDsl: input.styleDsl } : {}),
    solverConfig: normalizeSolverConfig({ ...selected.scope.solverConfig, ...(input.solverConfig ?? {}) }),
  });
  const first = compileOrThrow(draft);
  const { bindings, ops: memberOps } = syncMembers(context, selected.scopeId, first, selected.scope.entityBindings);
  const withBindings: ScopeProps = { ...draft, entityBindings: bindings };
  const compiled = compileOrThrow(withBindings);
  const pins: MemberPins = { pinnedDofs: new Map(), slackWeight: new Map() };
  const state = solveState(compiled, { seeds: {}, memberPins: pins, config: draft.solverConfig, iterations: 240 });
  const seeds = seedsFromValues(compiled, state.values);
  const patch = {
    schemaVersion: 1 as const,
    domainDsl: draft.domainDsl,
    substanceDsl: draft.substanceDsl,
    styleDsl: draft.styleDsl,
    solverConfig: draft.solverConfig,
    entityBindings: bindings,
    convergedSeeds: seeds,
  };
  withHistory(context, () => {
    context.world.applyCanonicalTransaction(COMMANDS.apply, [
      ...memberOps,
      { id: selected.scopeId, aspect: SCOPE_ASPECT_ID, patch },
    ], 'local:user');
  });
  surfaceOf(context)?.host.requestRender();
  return { scopeId: selected.scopeId, residual: state.residual, seeds, errors: [] };
}

export function resetExample(context: ActivationContext, input: { entityId?: string } = {}): ApplyDslResult {
  const base = createScopeDefaults();
  return applyDsl(context, { entityId: input.entityId, domainDsl: base.domainDsl, substanceDsl: base.substanceDsl, styleDsl: base.styleDsl, solverConfig: base.solverConfig });
}

export function currentSolved(context: ActivationContext, entityId?: string): { selection: ScopeSelection; solved: SolvedScope } | undefined {
  const selection = selectedScope(context, entityId);
  if (!selection) return undefined;
  const box = scopeBox(selection.scopeId, context.world.getCanonicalView());
  if (!box) return undefined;
  return { selection, solved: solveScope(selection.scope, context.world.getCanonicalView()) };
}

export function nextSubstanceId(compiled: CompiledScope, prefix: string): string {
  let index = 1;
  while (compiled.instances.has(`${prefix}${index}`)) index++;
  return `${prefix}${index}`;
}

export function appendSubstanceLine(scope: ScopeProps, line: string): string {
  return `${scope.substanceDsl.replace(/\s*$/, '')}\n${line}\n`;
}

export function freezeSubstance(substanceDsl: string): string {
  const lines = substanceDsl.split(/\r?\n/);
  const output: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) { output.push(raw); continue; }
    if (/^(soft\s+)?[A-Za-z_]\w*\s*\(/.test(line) || /^(pin|unpin)\s+/.test(line)) continue;
    if (/^[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*=\s*\(/.test(line) && !/\spin\s*$/.test(line)) output.push(`${raw.trimEnd()} pin`);
    else output.push(raw);
  }
  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function scopeJson(scope: ScopeProps): Record<string, JsonValue> {
  return {
    domainDsl: scope.domainDsl,
    substanceDsl: scope.substanceDsl,
    styleDsl: scope.styleDsl,
    entityBindings: scope.entityBindings,
    convergedSeeds: scope.convergedSeeds,
  };
}

export function transactionSymbol(name: string): SymbolId {
  return `${EXTENSION_ID}:${name}` as SymbolId;
}

/** The single canonical write for one drag or solver command. */
export function commitScopePatch(context: ActivationContext, scopeId: EntityId, patch: Record<string, unknown>, name = 'manipulate'): void {
  withHistory(context, () => {
    context.world.applyCanonicalTransaction(transactionSymbol(name), [{ id: scopeId, aspect: SCOPE_ASPECT_ID, patch }], 'local:user');
  });
}
