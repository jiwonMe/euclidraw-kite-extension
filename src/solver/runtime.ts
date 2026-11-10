import type {
  CompiledScope, Constraint, EntityId, MemberPins, ScopeProps, SolvedScope, SolvedState,
} from '../types.ts';
import { compileScope } from '../dsl/compile.ts';
import {
  constraintResidual, layoutFor, memberPinsFrom, seedsAreClean, solveState,
} from './solve.ts';

interface CompileEntry { compiled: CompiledScope; touched: number }
interface SolveEntry { compiledKey: string; seeds: Record<EntityId, number[]>; pinsKey: string; solved: SolvedScope; touched: number }

const compileCache = new Map<string, CompileEntry>();
const solveCache = new WeakMap<object, SolveEntry>();
const COMPILE_CACHE_LIMIT = 24;

export function compileCached(scope: Readonly<ScopeProps>): CompiledScope {
  const bindingKey = JSON.stringify(Object.entries(scope.entityBindings ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const key = `${scope.domainDsl ?? ''}\u0000${scope.substanceDsl ?? ''}\u0000${scope.styleDsl ?? ''}\u0000${bindingKey}`;
  const hit = compileCache.get(key);
  if (hit) { hit.touched = Date.now(); return hit.compiled; }
  const compiled = compileScope(scope);
  compileCache.set(key, { compiled, touched: Date.now() });
  if (compileCache.size > COMPILE_CACHE_LIMIT) {
    let oldestKey: string | undefined, oldest = Infinity;
    for (const [entryKey, entry] of compileCache) if (entry.touched < oldest) { oldest = entry.touched; oldestKey = entryKey; }
    if (oldestKey !== undefined) compileCache.delete(oldestKey);
  }
  return compiled;
}

export function clearRuntimeCaches(): void {
  compileCache.clear();
}

function pinsKey(pins: MemberPins): string {
  let key = '';
  for (const [id, value] of pins.pinnedDofs) key += `${id}:${value.join(',')};`;
  for (const [id, value] of pins.slackWeight) key += `${id}@${value};`;
  return key;
}

/** Solve a scope. The same scope object and seeds resolve from cache. */
export function solveScope(scope: Readonly<ScopeProps>, view: { getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined }): SolvedScope {
  const compiled = compileCached(scope);
  const pins = memberPinsFrom(compiled, view);
  const seeds = (scope.convergedSeeds ?? {}) as Record<EntityId, number[]>;
  const key = pinsKey(pins);
  const entry = solveCache.get(scope);
  if (entry && entry.compiledKey === compiled.key && entry.seeds === seeds && entry.pinsKey === key) return entry.solved;
  const state = compiled.ok
    ? solveState(compiled, { seeds, memberPins: pins, config: scope.solverConfig, iterations: 0 })
    : emptyState();
  const solved: SolvedScope = { compiled, state, seeds: seedsAreClean(compiled, seeds) ? seeds : {}, pins };
  solveCache.set(scope, { compiledKey: compiled.key, seeds, pinsKey: key, solved, touched: Date.now() });
  return solved;
}

export function solveForInteraction(
  scope: Readonly<ScopeProps>,
  compiled: CompiledScope,
  pins: MemberPins,
  seeds: Record<EntityId, number[]>,
  iterations: number,
  pinTarget?: import('../types.ts').SolveOptions['pinTarget'],
  temporary?: readonly Constraint[],
): SolvedState {
  return solveState(compiled, {
    seeds,
    memberPins: pins,
    config: scope.solverConfig,
    iterations,
    ...(pinTarget ? { pinTarget } : {}),
    ...(temporary?.length ? { temporary } : {}),
  });
}

function emptyState(): SolvedState {
  return { values: new Float64Array(0), residual: 0, perConstraint: [], stress: new Map(), iterations: 0, dirty: true, converged: false };
}

export interface Diagnostics {
  totalDofs: number;
  constrainedDofs: number;
  remainingDofs: number;
  residual: number;
  iterations: number;
  converged: boolean;
  dirty: boolean;
  entityCount: number;
  constraintCount: number;
  overConstrained: { text: string; residual: number; line: number }[];
  stress: { instanceId: string; value: number }[];
  notes: string[];
}

/** Numerical rank and residual report for the diagnostics panel. Never writes. */
export function analyzeScope(compiled: CompiledScope, state: SolvedState, pins?: MemberPins): Diagnostics {
  const layout = layoutFor(compiled, pins);
  const hasValues = state.values.length === layout.values.length;
  if (hasValues) layout.values.set(state.values);
  let totalDofs = 0;
  for (const index of layout.free) if (index) totalDofs++;
  const residuals = compiled.constraints.map(constraint => constraintResidual(layout, compiled, constraint));
  const overConstrained = compiled.constraints
    .map((constraint, index) => ({ text: constraint.text, residual: residuals[index]!, line: constraint.sourceLine }))
    .filter(entry => entry.residual > 1e-3)
    .sort((a, b) => b.residual - a.residual)
    .slice(0, 12);
  const constrainedDofs = hasValues ? estimateRank(compiled, layout.values, layout.free, pins) : 0;
  const stress = [...state.stress.entries()]
    .map(([instanceId, value]) => ({ instanceId, value }))
    .filter(entry => entry.value > 0.02)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const notes: string[] = [];
  if (compiled.errors.length) notes.push(`DSL 오류 ${compiled.errors.length}개`);
  if (state.dirty) notes.push('시드와 위상이 달라 초기 배치를 계산했습니다.');
  if (constrainedDofs >= totalDofs && state.residual > 1e-3) notes.push('과구속 가능성이 있습니다. 잔차가 큰 구속을 완화하세요.');
  return {
    totalDofs,
    constrainedDofs,
    remainingDofs: Math.max(0, totalDofs - constrainedDofs),
    residual: state.residual,
    iterations: state.iterations,
    converged: state.converged,
    dirty: state.dirty,
    entityCount: compiled.instances.size,
    constraintCount: compiled.constraints.length,
    overConstrained,
    stress,
    notes,
  };
}

/** Modified Gram-Schmidt rank of the finite-difference constraint Jacobian. */
function estimateRank(compiled: CompiledScope, values: Float64Array, free: Uint8Array, pins?: MemberPins): number {
  const indices: number[] = [];
  free.forEach((isFree, index) => { if (isFree) indices.push(index); });
  if (!indices.length || compiled.constraints.length === 0) return 0;
  // Bound the diagnostic cost; approximate large scopes with an equation count.
  if (indices.length > 220 || compiled.constraints.length > 220) {
    const degrees = compiled.constraints.reduce((sum, constraint) => sum + equationCount(constraint), 0);
    return Math.min(indices.length, degrees);
  }
  const base = values.slice();
  const evaluate = (vector: Float64Array): Float64Array => {
    const layout = layoutFor(compiled, pins);
    layout.values.set(vector);
    return Float64Array.from(compiled.constraints, constraint => constraintResidual(layout, compiled, constraint));
  };
  const baseLayout = layoutFor(compiled, pins);
  baseLayout.values.set(values);
  const residuals = compiled.constraints.map(constraint => constraintResidual(baseLayout, compiled, constraint));
  const rows: Float64Array[] = [];
  const h = 1e-6;
  for (const index of indices) {
    // Forward difference: central differences of an absolute residual are zero
    // exactly at the solution, which would hide every constraint.
    base[index] = values[index]! + h;
    const plus = evaluate(base);
    base[index] = values[index]!;
    const row = new Float64Array(compiled.constraints.length);
    for (let rowIndex = 0; rowIndex < row.length; rowIndex++) row[rowIndex] = (plus[rowIndex]! - residuals[rowIndex]!) / h;
    rows.push(row);
  }
  // Transpose to constraint rows over free DOFs.
  let rank = 0;
  const basis: Float64Array[] = [];
  for (let constraintIndex = 0; constraintIndex < compiled.constraints.length; constraintIndex++) {
    const row = new Float64Array(indices.length);
    for (let dof = 0; dof < indices.length; dof++) row[dof] = rows[dof]![constraintIndex]!;
    let norm = Math.hypot(...row);
    if (!Number.isFinite(norm) || norm < 1e-9) continue;
    for (let pass = 0; pass < 2; pass++) {
      for (const axis of basis) {
        const dot = row.reduce((sum, value, position) => sum + value * axis[position]!, 0);
        for (let position = 0; position < row.length; position++) row[position] -= dot * axis[position]!;
      }
    }
    norm = Math.hypot(...row);
    if (norm > 1e-7) { for (let position = 0; position < row.length; position++) row[position] /= norm; basis.push(row); rank++; }
  }
  return rank;
}

function equationCount(constraint: Constraint): number {
  if (constraint.type === 'midpoint' || constraint.type === 'coincident') return 2;
  return 1;
}
