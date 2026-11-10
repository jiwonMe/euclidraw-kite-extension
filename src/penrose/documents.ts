import type {
  ActivationContext,
  CanonicalPatchOp,
  CanvasToolSurface,
  CanvasToolSurfaceProvider,
  CanvasWorld,
  EntityId,
  SymbolId,
  WorkbenchHistory,
} from '../host.ts';
import { COMPUTED, EXTENSION_ID } from '../manifest.ts';
import { DEFAULT_SCOPE_SIZE, DEFAULT_SOURCE } from './defaults.ts';
import type { PenroseRuntime } from './runtime.ts';
import { DEFAULT_SOLVER_CONFIG, MEMBER_ASPECT, SCOPE_ASPECT, readSolverConfig, type PenroseMemberAspect, type PenroseScopeAspect, type ScopeSource } from './schema.ts';
import { readScopeBox } from './frame.ts';
import { type CompiledScope, type SolvedLayout } from './computed.ts';

/**
 * Every canonical write the extension makes goes through this module. Each
 * user action is exactly one transaction inside one history group.
 */

export interface PenroseHost {
  readonly context: ActivationContext;
  readonly runtime: PenroseRuntime;
}

export const caller = (name: string): SymbolId => `${EXTENSION_ID}:${name}` as SymbolId;

export function surfaceOf(context: ActivationContext): CanvasToolSurface | undefined {
  return context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface')?.get();
}

export function optionalService<T>(context: ActivationContext, id: string): T | undefined {
  // Undeclared/absent providers throw PhantomDependency in the scoped context.
  try { return context.services.get<T>(id); } catch { return undefined; }
}

export function historyOf(context: ActivationContext): WorkbenchHistory | undefined {
  return surfaceOf(context)?.host.history ?? optionalService<{ history?: WorkbenchHistory }>(context, 'canvas.interaction')?.history;
}

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

export function readScope(world: Pick<CanvasWorld, 'getCanonical'>, id: EntityId): PenroseScopeAspect | undefined {
  const scope = world.getCanonical<PenroseScopeAspect>(id, SCOPE_ASPECT);
  if (!scope) return undefined;
  return {
    schemaVersion: 2,
    domainDsl: String(scope.domainDsl ?? ''),
    substanceDsl: String(scope.substanceDsl ?? ''),
    styleDsl: String(scope.styleDsl ?? ''),
    variation: String(scope.variation ?? '0'),
    topologyDigest: String(scope.topologyDigest ?? ''),
    varyingValues: Array.isArray(scope.varyingValues) ? scope.varyingValues.filter(value => typeof value === 'number') : [],
    pins: Array.isArray(scope.pins)
      ? scope.pins.filter(pin => pin && typeof pin.index === 'number' && typeof pin.value === 'number')
      : [],
    entityBindings: { ...(scope.entityBindings ?? {}) },
    solverConfig: readSolverConfig(scope.solverConfig),
  };
}

export function scopeOfSelection(context: ActivationContext, explicit?: string): EntityId | undefined {
  for (const id of explicit ? [explicit] : selectedIds(context)) {
    if (context.world.getCanonical(id, SCOPE_ASPECT)) return id;
    const member = context.world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId && context.world.getCanonical(member.scopeId, SCOPE_ASPECT)) return member.scopeId;
  }
  return undefined;
}

/** Live members of a scope by owner key (lexicographically smallest id wins). */
export function scopeMembers(
  view: { listEntityIds?(): readonly EntityId[]; getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined },
  scopeId: EntityId,
): Record<string, EntityId> {
  const members: Record<string, EntityId> = {};
  for (const id of view.listEntityIds?.() ?? []) {
    const member = view.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId !== scopeId || !member.ownerKey) continue;
    const previous = members[member.ownerKey];
    if (previous === undefined || id < previous) members[member.ownerKey] = id;
  }
  return members;
}

// ── stacking ────────────────────────────────────────────────────────────────

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

export function memberStackingKey(scopeKey: string, index: number): string {
  let value = index, suffix = '';
  for (let digit = 0; digit < 3; digit++) {
    suffix = MEMBER_DIGITS[value % MEMBER_DIGITS.length]! + suffix;
    value = Math.floor(value / MEMBER_DIGITS.length);
  }
  return `${scopeKey}${suffix}`;
}

export function randomId(prefix: string): EntityId {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ?? Math.random().toString(36).slice(2, 18);
  return `${prefix}_${uuid}`;
}

// ── members ─────────────────────────────────────────────────────────────────

export interface MemberPlan {
  readonly bindings: Record<string, EntityId>;
  readonly ops: CanonicalPatchOp[];
}

export function planMembers(
  world: CanvasWorld,
  scopeId: EntityId,
  owners: readonly string[],
  existing: Readonly<Record<string, EntityId>>,
  scopeKey: string,
): MemberPlan {
  const ops: CanonicalPatchOp[] = [];
  const bindings: Record<string, EntityId> = {};
  owners.forEach((owner, index) => {
    const previous = existing[owner];
    const current = previous ? world.getCanonical<PenroseMemberAspect>(previous, MEMBER_ASPECT) : undefined;
    const id = current && current.scopeId === scopeId ? previous! : randomId(`ent_penrose_${owner.replace(/[^\w-]/g, '_')}`);
    bindings[owner] = id;
    if (!current || current.scopeId !== scopeId || current.ownerKey !== owner) {
      ops.push({ id, aspect: MEMBER_ASPECT, patch: { scopeId, ownerKey: owner, pinned: current?.pinned ?? false, label: owner } });
    }
    if (!world.getCanonical(id, 'core.stacking')) ops.push({ id, aspect: 'core.stacking', patch: { order: memberStackingKey(scopeKey, index) } });
  });
  for (const [owner, id] of Object.entries(existing)) {
    if (bindings[owner] === id) continue;
    if (world.isAlive(id) && world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT)?.scopeId === scopeId) {
      ops.push({ id, aspect: MEMBER_ASPECT, patch: null });
    }
  }
  return { bindings, ops };
}

// ── commands ────────────────────────────────────────────────────────────────

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

export interface InsertOptions {
  source?: ScopeSource;
  at?: { x: number; y: number };
  size?: { width: number; height: number };
  variation?: string;
}

/** A new scope and all its members, in one transaction. */
export async function insertScope(host: PenroseHost, options: InsertOptions = {}): Promise<EntityId> {
  const { context, runtime } = host;
  const source = options.source ?? DEFAULT_SOURCE;
  const variation = options.variation ?? '0';
  const scopeId = randomId('ent_penrose_scope');
  const { compiled, layout } = await runtime.apply(scopeId, source, variation);
  const canvas = layout.canvas.width > 1 ? layout.canvas : { width: DEFAULT_SCOPE_SIZE.width, height: DEFAULT_SCOPE_SIZE.height };
  const size = options.size ?? { width: Math.round(canvas.width), height: Math.round(canvas.height) };
  const centre = options.at ?? viewportCentre(context);
  const box = {
    x: Math.round(centre.x - size.width / 2),
    y: Math.round(centre.y - size.height / 2),
    width: Math.round(size.width),
    height: Math.round(size.height),
    rotation: 0,
  };
  const scopeKey = `${topStackingKey(context.world)}V`;
  const plan = planMembers(context.world, scopeId, compiled.owners, {}, scopeKey);
  const scope: PenroseScopeAspect = {
    schemaVersion: 2,
    ...source,
    variation,
    topologyDigest: compiled.digest,
    varyingValues: [...compiled.varyingValues],
    pins: [],
    entityBindings: plan.bindings,
    solverConfig: { ...DEFAULT_SOLVER_CONFIG },
  };
  commit(context, 'insert-scope', [
    { id: scopeId, aspect: 'core.transform', patch: { x: box.x, y: box.y, rotation: 0 } },
    { id: scopeId, aspect: 'core.bounds', patch: { width: box.width, height: box.height } },
    { id: scopeId, aspect: 'core.stacking', patch: { order: scopeKey } },
    { id: scopeId, aspect: SCOPE_ASPECT, patch: scope },
    ...plan.ops,
  ]);
  select(context, scopeId);
  return scopeId;
}

export interface ApplyOptions extends Partial<ScopeSource> {
  variation?: string;
  solverConfig?: Partial<PenroseScopeAspect['solverConfig']>;
}

/**
 * Apply a trio. The engine converges first, then DSL, seeds and members land in
 * a single transaction. A compile error writes only the DSL (so the error badge
 * is visible) and throws after.
 */
export async function applySource(host: PenroseHost, scopeId: EntityId, next: ApplyOptions, name = 'apply-dsl'): Promise<CompiledScope> {
  const { context, runtime } = host;
  const world = context.world;
  const scope = readScope(world, scopeId);
  if (!scope) throw new Error('Penrose 스코프를 찾을 수 없습니다.');
  if (world.isEntityReadOnly(scopeId)) throw new Error('읽기 전용 Penrose 스코프입니다.');
  const source: ScopeSource = {
    domainDsl: next.domainDsl ?? scope.domainDsl,
    substanceDsl: next.substanceDsl ?? scope.substanceDsl,
    styleDsl: next.styleDsl ?? scope.styleDsl,
  };
  const variation = next.variation ?? scope.variation ?? '0';
  const solverConfig = readSolverConfig({ ...scope.solverConfig, ...(next.solverConfig ?? {}) });
  try {
    const { compiled, layout } = await runtime.apply(scopeId, source, variation, scope.pins);
    const existing = { ...scope.entityBindings, ...scopeMembers(world.getCanonicalView(), scopeId) };
    const scopeKey = world.getCanonical<{ order?: string }>(scopeId, 'core.stacking')?.order ?? 'V';
    const plan = planMembers(world, scopeId, compiled.owners, existing, scopeKey);
    // A trio can change the Penrose canvas. Match the scope box to it while
    // keeping the centre, otherwise the diagram is squeezed and clipped.
    const box = readScopeBox(world.getCanonicalView(), scopeId);
    const canvas = layout.canvas;
    const resize = box && canvas.width > 1 && canvas.height > 1
      && (Math.abs(box.width - canvas.width) > 0.5 || Math.abs(box.height - canvas.height) > 0.5);
    const resizeOps: CanonicalPatchOp[] = resize && box ? [
      { id: scopeId, aspect: 'core.transform', patch: { x: box.x + (box.width - canvas.width) / 2, y: box.y + (box.height - canvas.height) / 2, rotation: box.rotation } },
      { id: scopeId, aspect: 'core.bounds', patch: { width: canvas.width, height: canvas.height } },
    ] : [];
    commit(context, name, [
      ...plan.ops,
      ...resizeOps,
      {
        id: scopeId,
        aspect: SCOPE_ASPECT,
        patch: {
          schemaVersion: 2,
          ...source,
          variation,
          topologyDigest: compiled.digest,
          varyingValues: [...layout.varyingValues],
          entityBindings: plan.bindings,
          solverConfig,
        },
      },
    ]);
    return {
      ok: true,
      digest: compiled.digest,
      owners: compiled.owners,
      canvas: compiled.canvas,
      varyingValues: layout.varyingValues,
      interactivity: compiled.interactivity,
      diagnostics: [],
      pending: false,
    };
  } catch (error) {
    const details = error as { diagnostics?: CompiledScope['diagnostics']; penroseDiagnostics?: CompiledScope['diagnostics']; message?: string };
    commit(context, `${name}-error`, [
      { id: scopeId, aspect: SCOPE_ASPECT, patch: { ...source, variation, topologyDigest: '', varyingValues: [] } },
    ]);
    const diagnostics = details.diagnostics ?? details.penroseDiagnostics ?? [];
    const lines = diagnostics.slice(0, 6).map(entry => `${entry.source} L${entry.line}: ${entry.message}`);
    throw Object.assign(new Error(`Penrose DSL 오류${lines.length ? `\n${lines.join('\n')}` : `: ${details.message ?? 'compile failed'}`}`), { diagnostics });
  }
}

/** Drag commit: the converged inputs are the only write. */
export function commitDrag(host: PenroseHost, scopeId: EntityId, varyingValues: readonly number[]): void {
  const { context } = host;
  const scope = readScope(context.world, scopeId);
  if (!scope) return;
  commit(context, 'manipulate', [
    { id: scopeId, aspect: SCOPE_ASPECT, patch: { varyingValues: [...varyingValues], topologyDigest: scope.topologyDigest } },
  ]);
}

export async function resampleScope(host: PenroseHost, scopeId: EntityId): Promise<CompiledScope> {
  const { context, runtime } = host;
  const scope = readScope(context.world, scopeId);
  if (!scope) throw new Error('Penrose 스코프를 찾을 수 없습니다.');
  const next = String((Number.parseInt(scope.variation, 10) || 0) + 1);
  const { compiled, layout } = await runtime.apply(scopeId, scope, next, scope.pins);
  commit(context, 'resample', [
    {
      id: scopeId,
      aspect: SCOPE_ASPECT,
      patch: {
        variation: next,
        topologyDigest: compiled.digest,
        varyingValues: [...layout.varyingValues],
      },
    },
  ]);
  return {
    ok: true, digest: compiled.digest, owners: compiled.owners, canvas: compiled.canvas,
    varyingValues: layout.varyingValues, interactivity: compiled.interactivity, diagnostics: [], pending: false,
  };
}

export async function reprojectScope(host: PenroseHost, scopeId: EntityId): Promise<CompiledScope> {
  const { context, runtime } = host;
  const scope = readScope(context.world, scopeId);
  if (!scope) throw new Error('Penrose 스코프를 찾을 수 없습니다.');
  const compiled = await runtime.converge(scopeId, scope, scope.pins);
  commit(context, 'reproject', [
    { id: scopeId, aspect: SCOPE_ASPECT, patch: { varyingValues: [...compiled.varyingValues], topologyDigest: compiled.digest } },
  ]);
  return {
    ok: true, digest: compiled.digest, owners: compiled.owners, canvas: compiled.canvas,
    varyingValues: compiled.varyingValues, interactivity: compiled.interactivity, diagnostics: [], pending: false,
  };
}

/** Pin or unpin every optimization input of one owner. */
export function togglePin(host: PenroseHost, scopeId: EntityId, ownerKey: string): void {
  const { context } = host;
  const world = context.world;
  const scope = readScope(world, scopeId);
  if (!scope) throw new Error('Penrose 스코프를 찾을 수 없습니다.');
  const compiled = world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled);
  const layout = world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
  if (!compiled || !layout) throw new Error('Penrose 레이아웃이 아직 준비되지 않았습니다.');
  const inputs = [...compiled.interactivity.translatable, ...compiled.interactivity.scalable].filter(input => input.owner === ownerKey);
  const indexes = new Set<number>();
  const collect = (input: (typeof inputs)[number]) => {
    if (input.center) indexes.add(input.center[0]).add(input.center[1]);
    if (input.start) indexes.add(input.start[0]).add(input.start[1]);
    if (input.end) indexes.add(input.end[0]).add(input.end[1]);
    for (const point of input.points ?? []) indexes.add(point[0]).add(point[1]);
    for (const index of [input.r, input.rx, input.ry, input.width, input.height]) if (index !== undefined) indexes.add(index);
  };
  inputs.forEach(collect);
  const pinned = new Set(scope.pins.map(pin => pin.index));
  const allPinned = indexes.size > 0 && [...indexes].every(index => pinned.has(index));
  const pins = allPinned
    ? scope.pins.filter(pin => !indexes.has(pin.index))
    : [
        ...scope.pins.filter(pin => !indexes.has(pin.index)),
        ...[...indexes].map(index => ({ index, value: layout.varyingValues[index] ?? 0 })),
      ];
  const members = { ...scope.entityBindings, ...scopeMembers(world.getCanonicalView(), scopeId) };
  const memberId = members[ownerKey];
  const ops: CanonicalPatchOp[] = [{ id: scopeId, aspect: SCOPE_ASPECT, patch: { pins } }];
  if (memberId) ops.push({ id: memberId, aspect: MEMBER_ASPECT, patch: { pinned: !allPinned } });
  commit(context, 'toggle-pin', ops);
}
