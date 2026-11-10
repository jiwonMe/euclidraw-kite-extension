import type { ComputedReadView, EntityId } from './host.ts';
import { compileScope, declaredDofValues, scopeSourceKey, type CompiledScope } from './dsl/compile.ts';
import { decodePointSeed, decodeScalarSeed, frameFor, readScopeBox, validSeed } from './geometry.ts';
import { COMPUTED } from './manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, readSolverConfig, type KiteMemberAspect, type KiteScopeAspect } from './schema.ts';
import { evaluateInVm, solverReady, type Frame, type SolverPool } from './solver-runtime.ts';

/**
 * PRD §4: the derived pipeline, registered as kernel computed nodes.
 *
 *   kite.scope (DSL) ──▶ computed.kite.compiledVm(scope)
 *                                   │
 *   kite.scope.convergedSeeds ──────┼──▶ computed.kite.solvedGeometry(scope)
 *   ScratchOverlay (drag) ──────────┘                   │
 *                                                        ▼
 *                         computed.kite.member(member) → computed.layoutBounds
 *
 * Every compute reads only through `view`, so the kernel's tracked
 * invalidation recomputes a cell only when its inputs change. None of them
 * writes to the document.
 */

export type SolveMode = 'cold' | 'interactive' | 'dirty';

export interface SolvedGeometry {
  readonly scopeId: EntityId;
  readonly compiledKey: string;
  readonly mode: SolveMode;
  readonly frame: Frame;
  /** Scope-local DOFs (dof_state_buf). */
  readonly dofs: readonly number[];
  /** world_prim_buf: 8 floats per primitive. */
  readonly prims: readonly number[];
  readonly poly: readonly number[];
  /** constraint_stress_buf. */
  readonly stress: readonly number[];
  readonly residual: number;
  readonly energy: number;
  readonly iterations: number;
  readonly converged: boolean;
}

const compileCache = new Map<string, CompiledScope>();
const COMPILE_CACHE_LIMIT = 32;

/** DSL text → topology; identical sources share one compiled object. */
export function compileCached(scope: Pick<KiteScopeAspect, 'domainDsl' | 'substanceDsl' | 'styleDsl' | 'entityBindings'>): CompiledScope {
  // Expressions evaluate in the Wasm VM; compiling before it loads would cache spurious errors.
  if (!solverReady()) throw new Error('Kite solver is still loading.');
  const key = scopeSourceKey(scope);
  const hit = compileCache.get(key);
  if (hit) { compileCache.delete(key); compileCache.set(key, hit); return hit; }
  const compiled = compileScope(scope, evaluateInVm);
  compileCache.set(key, compiled);
  while (compileCache.size > COMPILE_CACHE_LIMIT) compileCache.delete(compileCache.keys().next().value!);
  return compiled;
}

export function clearCompileCache(): void { compileCache.clear(); }

/** Member pins, read from `kite.member` through the tracked view. */
function memberPinnedDofs(compiled: CompiledScope, view: ComputedReadView): number[] {
  const fixed: number[] = [];
  for (const slot of compiled.dofs) {
    const entityId = compiled.bindings[slot.substanceId];
    if (!entityId) continue;
    const member = view.getCanonical<KiteMemberAspect>(entityId, MEMBER_ASPECT);
    if (!member || member.scopeId === undefined) continue;
    for (const local of member.pinnedDofs ?? []) {
      if (Number.isInteger(local) && local >= 0 && local < (slot.kind === 'point' ? 2 : 1)) fixed.push(slot.off + local);
    }
  }
  return fixed;
}

/**
 * Live member ids by substance id. The stored `entityBindings` are trusted
 * while every entry still names a member of this scope; otherwise (a paste or
 * a deleted member) the members' own `scopeId` — which core.clipboard remaps
 * atomically as a cascade-hide reference — is the truth. Ties pick the
 * smallest EntityId so every peer agrees. Reads only; never writes.
 */
export function resolveBindings(view: ComputedReadView, scopeId: EntityId, stored: Readonly<Record<string, EntityId>>): Record<string, EntityId> {
  let valid = true;
  for (const [substanceId, entityId] of Object.entries(stored)) {
    const member = view.getCanonical<KiteMemberAspect>(entityId, MEMBER_ASPECT);
    if (!member || member.scopeId !== scopeId || member.substanceId !== substanceId) { valid = false; break; }
  }
  if (valid) return { ...stored };
  const live: Record<string, EntityId> = {};
  for (const id of view.listEntityIds?.() ?? []) {
    const member = view.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId !== scopeId || !member.substanceId) continue;
    const previous = live[member.substanceId];
    if (previous === undefined || id < previous) live[member.substanceId] = id;
  }
  return live;
}

interface SeedState { values: number[]; unseeded: Set<number>; clean: boolean }

function seedValues(compiled: CompiledScope, seeds: Readonly<Record<EntityId, readonly number[]>>, stored: Readonly<Record<string, EntityId>>): SeedState {
  const values = declaredDofValues(compiled);
  const unseeded = new Set<number>();
  for (const slot of compiled.dofs) {
    const entityId = compiled.bindings[slot.substanceId];
    // After a paste, seeds are still keyed by the copied ids recorded in the
    // stored bindings; both sides were copied together, so they stay consistent.
    const seed = (entityId ? seeds[entityId] : undefined) ?? seeds[stored[slot.substanceId] ?? ''];
    if (slot.kind === 'point' && validSeed(seed, 2)) {
      const [x, y] = decodePointSeed(compiled.canvas, seed);
      values[slot.off] = x; values[slot.off + 1] = y;
    } else if (slot.kind === 'scalar' && validSeed(seed, 1) && seed[0]! > 0) {
      values[slot.off] = decodeScalarSeed(compiled.canvas, seed);
    } else unseeded.add(slot.off);
  }
  return { values, unseeded, clean: unseeded.size === 0 };
}

export interface BridgeOptions {
  readonly pool: SolverPool;
  /** The scope currently driven by a pointer drag (interactive mode), if any. */
  readonly interactive: () => EntityId | undefined;
}

export function createComputedSpecs(options: BridgeOptions) {
  const { pool } = options;

  const compiledVm = {
    id: COMPUTED.compiledVm,
    symbol: 'kite.studio:compile' as const,
    dependsOnCanonical: [SCOPE_ASPECT],
    dependsOnComputed: [] as string[],
    compute(id: EntityId, view: ComputedReadView): CompiledScope | undefined {
      const scope = view.getCanonical<KiteScopeAspect>(id, SCOPE_ASPECT);
      if (!scope || !solverReady()) return undefined;
      return compileCached({ ...scope, entityBindings: resolveBindings(view, id, scope.entityBindings ?? {}) });
    },
    // A compiled topology is immutable; identity is equality.
    equals: (a: CompiledScope, b: CompiledScope) => a.key === b.key,
  };

  const solvedGeometry = {
    id: COMPUTED.solvedGeometry,
    symbol: 'kite.studio:solve' as const,
    dependsOnCanonical: [SCOPE_ASPECT, MEMBER_ASPECT, 'core.transform', 'core.bounds'],
    dependsOnComputed: [COMPUTED.compiledVm],
    compute(id: EntityId, view: ComputedReadView): SolvedGeometry | undefined {
      const compiled = view.getComputed<CompiledScope>(id, COMPUTED.compiledVm);
      const scope = view.getCanonical<KiteScopeAspect>(id, SCOPE_ASPECT);
      const box = readScopeBox(view, id);
      if (!compiled || !compiled.ok || !scope || !box) return undefined;
      const frame = frameFor(compiled.canvas, box);
      const seeds = seedValues(compiled, scope.convergedSeeds ?? {}, scope.entityBindings ?? {});
      const pinned = memberPinnedDofs(compiled, view);
      const config = readSolverConfig(scope.solverConfig);
      const solver = pool.get(`${id}\u0000${compiled.key}`, compiled);
      solver.clearPins();
      solver.setMemberPins(pinned);
      solver.setDamping(config.damping);
      solver.setFrame(frame);
      solver.writeDofs(seeds.values);
      let mode: SolveMode = 'cold', iterations = 0;
      if (options.interactive() === id) {
        // Drag: the overlay seeds are the frame the drag session already
        // projected; reading them back keeps Space 1 and Space 2A in lockstep.
        mode = 'interactive';
      } else if (!seeds.clean) {
        // Topology dirty: discrete placement for the unseeded DOFs, then a
        // warm-started XPBD solve. Seeded geometry is never perturbed.
        mode = 'dirty';
        for (const slot of compiled.dofs) solver.markUnseeded(slot.off, slot.kind === 'scalar', seeds.unseeded.has(slot.off));
        solver.initialize(hashSeed(compiled.key), 8, 40, 400);
        solver.projectManifold(4000);
        iterations = 440 + solver.lastIterations();
      }
      const residual = solver.project();
      return {
        scopeId: id,
        compiledKey: compiled.key,
        mode,
        frame,
        dofs: solver.readDofs(),
        prims: Array.from(solver.prims),
        poly: Array.from(solver.polyVertices),
        stress: Array.from(solver.stress),
        residual,
        energy: solver.energy(),
        iterations,
        converged: residual <= Math.max(config.convergenceTolerance * 100, 1e-3),
      };
    },
  };

  return { compiledVm, solvedGeometry };
}

function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}
