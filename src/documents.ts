import type { ActivationContext, CanonicalPatchOp, CanvasToolSurface, CanvasToolSurfaceProvider, CanvasWorld, EntityId, SymbolId, WorkbenchHistory } from './host.ts';
import { compileCached } from './computed-bridge.ts';
import { declaredDofValues, type CompiledScope } from './dsl/compile.ts';
import { decodePointSeed, decodeScalarSeed, encodeSeeds, frameFor, memberGeometry, readScopeBox, validSeed, type Box } from './geometry.ts';
import { EXTENSION_ID } from './manifest.ts';
import { DEFAULT_SOLVER_CONFIG, MEMBER_ASPECT, SCOPE_ASPECT, readSolverConfig, type KiteMemberAspect, type KiteScopeAspect } from './schema.ts';
import { SolverInstance } from './solver-runtime.ts';
import { DEFAULT_DOMAIN, DEFAULT_SCOPE_SIZE, DEFAULT_STYLE, DEFAULT_SUBSTANCE } from './defaults.ts';

/**
 * Every canonical write Kite makes goes through this module, and each user
 * action is exactly one `applyCanonicalTransaction` inside one history group.
 */

export const caller = (name: string): SymbolId => `${EXTENSION_ID}:${name}` as SymbolId;

export function surfaceOf(context: ActivationContext): CanvasToolSurface | undefined {
  return context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface')?.get();
}

function optionalService<T>(context: ActivationContext, id: string): T | undefined {
  // Undeclared/absent providers throw PhantomDependency in the kernel's scoped context.
  try { return context.services.get<T>(id); } catch { return undefined; }
}

export function historyOf(context: ActivationContext): WorkbenchHistory | undefined {
  return surfaceOf(context)?.host.history ?? optionalService<{ history?: WorkbenchHistory }>(context, 'canvas.interaction')?.history;
}

/** One user action → one transaction → one undo step. */
export function commit(context: ActivationContext, name: string, ops: readonly CanonicalPatchOp[]): void {
  if (!ops.length) return;
  const history = historyOf(context);
  history?.begin();
  try {
    context.world.applyCanonicalTransaction(caller(name), ops, 'local:user');
    history?.commit();
  } catch (error) {
    history?.abort();
    throw error;
  }
}

export function selectedIds(context: ActivationContext): EntityId[] {
  const surface = surfaceOf(context);
  if (surface) return [...surface.selection.getSelection()];
  return [...(optionalService<{ getSelection?(): readonly EntityId[] }>(context, 'canvas.selection')?.getSelection?.() ?? [])];
}

export function select(context: ActivationContext, id: EntityId | null): void {
  const surface = surfaceOf(context);
  if (surface) { surface.selection.select(id); return; }
  optionalService<{ select?(id: EntityId | null): void }>(context, 'canvas.selection')?.select?.(id);
}

/** The scope a selection refers to (a selected scope, or the scope of a selected member). */
export function scopeOfSelection(context: ActivationContext, explicit?: string): EntityId | undefined {
  for (const id of explicit ? [explicit] : selectedIds(context)) {
    if (context.world.getCanonical(id, SCOPE_ASPECT)) return id;
    const member = context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId && context.world.getCanonical(member.scopeId, SCOPE_ASPECT)) return member.scopeId;
  }
  return undefined;
}

export function readScope(world: Pick<CanvasWorld, 'getCanonical'>, id: EntityId): KiteScopeAspect | undefined {
  const scope = world.getCanonical<KiteScopeAspect>(id, SCOPE_ASPECT);
  if (!scope) return undefined;
  return {
    schemaVersion: 1,
    domainDsl: String(scope.domainDsl ?? ''),
    substanceDsl: String(scope.substanceDsl ?? ''),
    styleDsl: String(scope.styleDsl ?? ''),
    entityBindings: { ...(scope.entityBindings ?? {}) },
    convergedSeeds: { ...(scope.convergedSeeds ?? {}) },
    solverConfig: readSolverConfig(scope.solverConfig),
  };
}

/**
 * Members that actually belong to a scope, by substance id. When copies or
 * concurrent edits leave duplicates, the lexicographically smallest EntityId
 * wins — every peer agrees without writing anything.
 */
export function scopeMembers(view: { listEntityIds?(): readonly EntityId[]; getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined }, scopeId: EntityId): Record<string, EntityId> {
  const members: Record<string, EntityId> = {};
  for (const id of view.listEntityIds?.() ?? []) {
    const member = view.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId !== scopeId || !member.substanceId) continue;
    const previous = members[member.substanceId];
    if (previous === undefined || id < previous) members[member.substanceId] = id;
  }
  return members;
}

// ── stacking keys (core.stacking fractional indices) ───────────────────────

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MEMBER_DIGITS = DIGITS.slice(1);

export function topStackingKey(world: CanvasWorld): string {
  let top = 'V';
  for (const id of world.listEntityIds()) {
    const order = world.getCanonical<{ order?: string }>(id, 'core.stacking')?.order;
    if (typeof order === 'string' && order > top) top = order;
  }
  return top;
}

/** Members are stacked directly above their scope, in declaration order. */
export function memberStackingKey(scopeKey: string, index: number): string {
  let value = index, suffix = '';
  for (let digit = 0; digit < 3; digit++) { suffix = MEMBER_DIGITS[value % MEMBER_DIGITS.length]! + suffix; value = Math.floor(value / MEMBER_DIGITS.length); }
  return `${scopeKey}${suffix}`;
}

export function randomId(prefix: string): EntityId {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ?? Math.random().toString(36).slice(2, 18);
  return `${prefix}_${uuid}`;
}

// ── solving for a commit ───────────────────────────────────────────────────

export interface SolveResult {
  readonly dofs: number[];
  readonly seeds: Record<EntityId, number[]>;
  readonly residual: number;
}

/**
 * Solve a (possibly new) topology for a commit. Existing members keep their
 * seeds; unseeded DOFs get the discrete initial placement. Pure apart from the
 * temporary Wasm slot.
 */
export function solveForCommit(compiled: CompiledScope, seeds: Readonly<Record<EntityId, readonly number[]>>, legacyBindings: Readonly<Record<string, EntityId>>, box: Box, memberPins: readonly number[] = [], damping = DEFAULT_SOLVER_CONFIG.damping): SolveResult {
  const values = declaredDofValues(compiled);
  const solver = new SolverInstance(compiled);
  try {
    solver.setFrame(frameFor(compiled.canvas, box));
    solver.setDamping(damping);
    solver.setMemberPins(memberPins);
    for (const slot of compiled.dofs) {
      const seed = seeds[compiled.bindings[slot.substanceId] ?? ''] ?? seeds[legacyBindings[slot.substanceId] ?? ''];
      let seeded = false;
      if (slot.kind === 'point' && validSeed(seed, 2)) { [values[slot.off], values[slot.off + 1]] = decodePointSeed(compiled.canvas, seed); seeded = true; }
      if (slot.kind === 'scalar' && validSeed(seed, 1) && seed[0]! > 0) { values[slot.off] = decodeScalarSeed(compiled.canvas, seed); seeded = true; }
      solver.markUnseeded(slot.off, slot.kind === 'scalar', !seeded);
    }
    solver.writeDofs(values);
    solver.initialize(0x4b495445, 8, 40, 400);
    solver.step(60);
    const residual = solver.projectManifold(4000);
    const dofs = solver.readDofs();
    return { dofs, seeds: encodeSeeds(compiled, dofs, compiled.bindings), residual };
  } finally { solver.dispose(); }
}

// ── member reconciliation ──────────────────────────────────────────────────

export interface MemberPlan {
  readonly bindings: Record<string, EntityId>;
  readonly ops: CanonicalPatchOp[];
  /** Card-label members (markdown.card) whose box Kite places. */
  readonly cards: Record<string, EntityId>;
}

export function cardsAvailable(world: CanvasWorld): boolean {
  return world.hasCanonicalSpec?.('markdown.card') === true;
}

/**
 * Create, keep or remove member entities so they match the declarations.
 * Existing members keep their EntityId (and so their connectors and pins).
 */
export function planMembers(world: CanvasWorld, scopeId: EntityId, compiled: CompiledScope, existing: Readonly<Record<string, EntityId>>, scopeKey: string): MemberPlan {
  const ops: CanonicalPatchOp[] = [];
  const bindings: Record<string, EntityId> = {};
  const cards: Record<string, EntityId> = {};
  const useCards = cardsAvailable(world);
  compiled.order.forEach((substanceId, index) => {
    const instance = compiled.instances[substanceId]!;
    const previous = existing[substanceId];
    const current = previous ? world.getCanonical<KiteMemberAspect>(previous, MEMBER_ASPECT) : undefined;
    const id = current && current.scopeId === scopeId ? previous! : randomId(`ent_kite_${substanceId}`);
    bindings[substanceId] = id;
    if (!current || current.primitiveKind !== instance.kind || current.substanceId !== substanceId || current.scopeId !== scopeId) {
      ops.push({ id, aspect: MEMBER_ASPECT, patch: { scopeId, substanceId, primitiveKind: instance.kind, pinnedDofs: current?.pinnedDofs ?? [], slackWeight: current?.slackWeight ?? 1 } });
    }
    if (!world.getCanonical(id, 'core.stacking')) ops.push({ id, aspect: 'core.stacking', patch: { order: memberStackingKey(scopeKey, index) } });
    const wantsCard = Boolean(instance.card) && useCards;
    const hasCard = Boolean(world.getCanonical(id, 'markdown.card'));
    if (wantsCard) {
      cards[substanceId] = id;
      if (!hasCard || world.getCanonical<{ body?: string }>(id, 'markdown.card')?.body !== instance.text) ops.push({ id, aspect: 'markdown.card', patch: { body: instance.text ?? '', color: 'white' } });
    }
  });
  for (const [substanceId, id] of Object.entries(existing)) {
    if (bindings[substanceId] === id || Object.values(bindings).includes(id)) continue;
    if (world.isAlive(id) && world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT)?.scopeId === scopeId) ops.push({ id, aspect: MEMBER_ASPECT, patch: null });
  }
  return { bindings, ops, cards };
}

/** Card labels: Kite owns their box (written only in Kite's own commits). */
export function cardOps(compiled: CompiledScope, dofs: readonly number[], box: Box, scopeId: EntityId, cards: Readonly<Record<string, EntityId>>): CanonicalPatchOp[] {
  if (!Object.keys(cards).length) return [];
  const solver = new SolverInstance(compiled);
  try {
    const frame = frameFor(compiled.canvas, box);
    solver.setFrame(frame);
    solver.writeDofs(dofs);
    solver.project();
    const solved = { frame, dofs, prims: Array.from(solver.prims), poly: Array.from(solver.polyVertices), stress: Array.from(solver.stress) };
    const ops: CanonicalPatchOp[] = [];
    for (const [substanceId, id] of Object.entries(cards)) {
      const geometry = memberGeometry(compiled, solved, scopeId, substanceId);
      if (!geometry?.textAt) continue;
      const style = compiled.styles[substanceId] ?? {};
      const width = Math.max(40, Number(style.cardWidth) || 120), height = Math.max(24, Number(style.cardHeight) || 44);
      const round = (value: number) => Math.round(value * 100) / 100;
      ops.push({ id, aspect: 'core.transform', patch: { x: round(geometry.textAt.x - width / 2), y: round(geometry.textAt.y - height / 2), rotation: 0 } });
      ops.push({ id, aspect: 'core.bounds', patch: { width, height } });
    }
    return ops;
  } finally { solver.dispose(); }
}

/** Member-level pinned DOFs (scope-local offsets) for a compiled scope. */
export function memberPins(world: Pick<CanvasWorld, 'getCanonical'>, compiled: CompiledScope): number[] {
  const fixed: number[] = [];
  for (const slot of compiled.dofs) {
    const member = world.getCanonical<KiteMemberAspect>(compiled.bindings[slot.substanceId] ?? '', MEMBER_ASPECT);
    for (const local of member?.pinnedDofs ?? []) if (Number.isInteger(local) && local >= 0 && local < (slot.kind === 'point' ? 2 : 1)) fixed.push(slot.off + local);
  }
  return fixed;
}

// ── scope creation and DSL application ─────────────────────────────────────

export interface ScopeSource { domainDsl: string; substanceDsl: string; styleDsl: string }
export const DEFAULT_SOURCE: ScopeSource = Object.freeze({ domainDsl: DEFAULT_DOMAIN, substanceDsl: DEFAULT_SUBSTANCE, styleDsl: DEFAULT_STYLE });

export function viewportCentre(context: ActivationContext): { x: number; y: number } {
  const surface = surfaceOf(context);
  const element = surface?.surface.element ?? optionalService<{ element?: HTMLElement }>(context, 'canvas.surface')?.element;
  const host = surface?.host ?? optionalService<{ screenToWorld?(x: number, y: number, out: { x: number; y: number }): void }>(context, 'canvas.interaction');
  if (!element || !host?.screenToWorld) return { x: 0, y: 0 };
  const rect = element.getBoundingClientRect();
  const out = { x: 0, y: 0 };
  host.screenToWorld(rect.left + (rect.width || 0) / 2, rect.top + (rect.height || 0) / 2, out);
  return out;
}

export interface InsertOptions { source?: ScopeSource; at?: { x: number; y: number }; size?: { width: number; height: number }; name?: string }

/** A new scope and all its members, solved, in one transaction. */
export function insertScope(context: ActivationContext, options: InsertOptions = {}): EntityId {
  const world = context.world;
  const source = options.source ?? DEFAULT_SOURCE;
  const scopeId = randomId('ent_kite_scope');
  const draft = { ...source, entityBindings: {} };
  const first = compileCached(draft);
  if (!first.ok) throw dslError(first);
  const size = options.size ?? { width: first.canvas.width || DEFAULT_SCOPE_SIZE.width, height: first.canvas.height || DEFAULT_SCOPE_SIZE.height };
  const centre = options.at ?? viewportCentre(context);
  const box: Box = { x: Math.round(centre.x - size.width / 2), y: Math.round(centre.y - size.height / 2), width: size.width, height: size.height, rotation: 0 };
  const scopeKey = `${topStackingKey(world)}V`;
  const plan = planMembers(world, scopeId, first, {}, scopeKey);
  const compiled = compileCached({ ...source, entityBindings: plan.bindings });
  const solved = solveForCommit(compiled, {}, {}, box);
  const scope: KiteScopeAspect = { schemaVersion: 1, ...source, entityBindings: plan.bindings, convergedSeeds: solved.seeds, solverConfig: { ...DEFAULT_SOLVER_CONFIG } };
  commit(context, 'insert-scope', [
    { id: scopeId, aspect: 'core.transform', patch: { x: box.x, y: box.y, rotation: 0 } },
    { id: scopeId, aspect: 'core.bounds', patch: { width: box.width, height: box.height } },
    { id: scopeId, aspect: 'core.stacking', patch: { order: scopeKey } },
    { id: scopeId, aspect: SCOPE_ASPECT, patch: scope },
    ...plan.ops,
    ...cardOps(compiled, solved.dofs, box, scopeId, plan.cards),
  ]);
  select(context, scopeId);
  return scopeId;
}

export interface ApplyResult {
  readonly scopeId: EntityId;
  readonly previousDofs?: readonly number[];
  readonly compiled: CompiledScope;
  readonly dofs: readonly number[];
  readonly residual: number;
}

/**
 * PRD §5.2: write the new DSL, reconcile members and the converged seeds in a
 * single transaction. Returns the previous local DOFs so the caller can play
 * the relaxation animation in a ScratchOverlay.
 */
export function applySource(context: ActivationContext, scopeId: EntityId, next: Partial<ScopeSource> & { solverConfig?: Partial<KiteScopeAspect['solverConfig']> }, name = 'apply-dsl'): ApplyResult {
  const world = context.world;
  const scope = readScope(world, scopeId);
  const box = readScopeBox(world.getCanonicalView(), scopeId);
  if (!scope || !box) throw new Error('Kite 스코프를 찾을 수 없습니다.');
  if (world.isEntityReadOnly(scopeId)) throw new Error('읽기 전용 Kite 스코프입니다.');
  const source: ScopeSource = { domainDsl: next.domainDsl ?? scope.domainDsl, substanceDsl: next.substanceDsl ?? scope.substanceDsl, styleDsl: next.styleDsl ?? scope.styleDsl };
  const existing = { ...scope.entityBindings, ...scopeMembers(world.getCanonicalView(), scopeId) };
  const probe = compileCached({ ...source, entityBindings: existing });
  if (!probe.ok) throw dslError(probe);
  const previous = compileCached({ ...scope, entityBindings: existing });
  const previousDofs = previous.ok ? solveForCommit(previous, scope.convergedSeeds, scope.entityBindings, box, memberPins(world, previous)).dofs : undefined;
  const scopeKey = world.getCanonical<{ order?: string }>(scopeId, 'core.stacking')?.order ?? 'V';
  const plan = planMembers(world, scopeId, probe, existing, scopeKey);
  const compiled = compileCached({ ...source, entityBindings: plan.bindings });
  const solverConfig = readSolverConfig({ ...scope.solverConfig, ...(next.solverConfig ?? {}) });
  const solved = solveForCommit(compiled, scope.convergedSeeds, scope.entityBindings, box, memberPins(world, compiled), solverConfig.damping);
  commit(context, name, [
    ...plan.ops,
    { id: scopeId, aspect: SCOPE_ASPECT, patch: { schemaVersion: 1, ...source, entityBindings: plan.bindings, convergedSeeds: solved.seeds, solverConfig } },
    ...cardOps(compiled, solved.dofs, box, scopeId, plan.cards),
  ]);
  return { scopeId, ...(previousDofs && previous.dofCount === compiled.dofCount ? { previousDofs } : {}), compiled, dofs: solved.dofs, residual: solved.residual };
}

/** Append one Substance statement (constraint promotion, minibuffer commands). */
export function appendStatement(context: ActivationContext, scopeId: EntityId, statement: string, name = 'constrain'): ApplyResult {
  const scope = readScope(context.world, scopeId);
  if (!scope) throw new Error('Kite 스코프를 찾을 수 없습니다.');
  const trimmed = statement.trim();
  if (scope.substanceDsl.split(/\r?\n/).some(line => line.trim() === trimmed)) throw new Error(`이미 있는 구속입니다: ${trimmed}`);
  return applySource(context, scopeId, { substanceDsl: `${scope.substanceDsl.replace(/\s*$/, '')}\n${trimmed}\n` }, name);
}

export function dslError(compiled: CompiledScope): Error {
  const lines = compiled.diagnostics.slice(0, 6).map(entry => `${entry.source} L${entry.line}: ${entry.message}`);
  return Object.assign(new Error(`Kite DSL 오류\n${lines.join('\n')}`), { diagnostics: compiled.diagnostics });
}

/** Commit the end of a drag: seeds and an optional promoted statement, one transaction. */
export function commitDrag(context: ActivationContext, scopeId: EntityId, seeds: Record<EntityId, number[]>, promoted: string | undefined): void {
  const world = context.world;
  const scope = readScope(world, scopeId);
  const box = readScopeBox(world.getCanonicalView(), scopeId);
  if (!scope || !box) return;
  const members = { ...scope.entityBindings, ...scopeMembers(world.getCanonicalView(), scopeId) };
  if (!promoted) {
    const compiled = compileCached({ ...scope, entityBindings: members });
    const solver = compiled.ok ? solveForCommit(compiled, seeds, members, box, memberPins(world, compiled), scope.solverConfig.damping) : undefined;
    const cards: Record<string, EntityId> = {};
    for (const id of compiled.order) if (compiled.instances[id]?.card && world.getCanonical(members[id] ?? '', 'markdown.card')) cards[id] = members[id]!;
    commit(context, 'manipulate', [
      { id: scopeId, aspect: SCOPE_ASPECT, patch: { convergedSeeds: seeds, entityBindings: members } },
      ...(solver ? cardOps(compiled, solver.dofs, box, scopeId, cards) : []),
    ]);
    return;
  }
  // Promotion: the drag result and the new Substance statement are one undo step.
  const substanceDsl = `${scope.substanceDsl.replace(/\s*$/, '')}\n${promoted}\n`;
  const compiled = compileCached({ ...scope, substanceDsl, entityBindings: members });
  if (!compiled.ok) throw dslError(compiled);
  const solved = solveForCommit(compiled, seeds, members, box, memberPins(world, compiled), scope.solverConfig.damping);
  const cards: Record<string, EntityId> = {};
  for (const id of compiled.order) if (compiled.instances[id]?.card && world.getCanonical(members[id] ?? '', 'markdown.card')) cards[id] = members[id]!;
  commit(context, 'manipulate', [
    { id: scopeId, aspect: SCOPE_ASPECT, patch: { substanceDsl, convergedSeeds: solved.seeds, entityBindings: members } },
    ...cardOps(compiled, solved.dofs, box, scopeId, cards),
  ]);
}
