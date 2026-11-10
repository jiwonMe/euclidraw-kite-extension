import type { CompiledScope } from '../dsl/compile.ts';
import type { EntityId } from '../host.ts';
import { encodeSeeds, toLocal } from '../geometry.ts';
import { SolverInstance, type Frame } from '../solver-runtime.ts';
import { detectSnap, type SnapCandidate } from './snap.ts';

/**
 * One pointer drag (PRD §5.1). Owns a private solver slot warm-started from
 * the committed state, so canonical topology and the shared pool are never
 * mutated mid-gesture.
 *
 *  - pointerdown: soft pins (slack constraints) at each grabbed DOF
 *  - frame:       ≤ maxSubstepsPerFrame XPBD + manifold-projection substeps
 *  - Shift:       snap detection; a temporary constraint previews the snap
 *  - pointerup:   pins removed, 20-iteration polish, seeds returned once
 */
export interface DragTarget {
  readonly substanceId: string;
  readonly kind: 'point' | 'scalar';
  /** Pointer → handle offset at press, scope-local, so the handle does not jump. */
  readonly grab: { x: number; y: number };
  readonly slackWeight: number;
}

export interface DragFrameResult {
  readonly dofs: Float64Array;
  readonly seeds: Record<EntityId, number[]>;
  readonly residual: number;
  readonly snap: SnapCandidate | undefined;
  readonly elapsedMs: number;
}

// α̃ = α/Δt² ≈ 0.014 at slackWeight 1: the cursor leads, the hard manifold still wins each sweep.
const BASE_COMPLIANCE = 1e-6;
const POLISH_ITERATIONS = 20;
/** Upper bound on hard re-projection sweeps per frame (stops early at 1e-6 local units). */
const MANIFOLD_SWEEPS = 400;
const FRAME_BUDGET_MS = 4;

export class DragSession {
  private solver: SolverInstance;
  private snapSolver?: SolverInstance;
  private snapKey = '';
  private snap?: SnapCandidate;
  private pointer: { x: number; y: number };
  private shift = false;
  private disposed = false;
  readonly startDofs: readonly number[];

  constructor(
    readonly compiled: CompiledScope,
    private readonly frame: Frame,
    initial: readonly number[],
    private readonly memberPins: readonly number[],
    readonly targets: readonly DragTarget[],
    private readonly substeps: number,
    private readonly damping: number,
    pointerWorld: { x: number; y: number },
  ) {
    this.startDofs = [...initial];
    this.pointer = toLocal(frame, pointerWorld.x, pointerWorld.y);
    this.solver = this.instance(compiled);
  }

  private instance(compiled: CompiledScope): SolverInstance {
    const solver = new SolverInstance(compiled);
    solver.setFrame(this.frame);
    solver.setDamping(this.damping);
    solver.setMemberPins(this.memberPins);
    solver.writeDofs(this.solver ? this.solver.dofs : this.startDofs);
    solver.clearPins();
    for (const target of this.targets) {
      const slot = compiled.dofs.find(entry => entry.substanceId === target.substanceId && entry.kind === target.kind);
      if (!slot) continue;
      solver.addPin(target.substanceId, slot.off, target.kind === 'scalar', BASE_COMPLIANCE * Math.max(0.05, target.slackWeight));
    }
    return solver;
  }

  update(pointerWorld: { x: number; y: number }, shift: boolean): void {
    this.pointer = toLocal(this.frame, pointerWorld.x, pointerWorld.y);
    this.shift = shift;
  }

  private active(): SolverInstance { return this.snapSolver ?? this.solver; }

  private aimPins(solver: SolverInstance): void {
    const dofs = solver.dofs;
    for (const target of this.targets) {
      const slot = this.compiled.dofs.find(entry => entry.substanceId === target.substanceId && entry.kind === target.kind);
      if (!slot) continue;
      if (target.kind === 'point') solver.setPinTarget(target.substanceId, this.pointer.x - target.grab.x, this.pointer.y - target.grab.y);
      else {
        const instance = this.compiled.instances[target.substanceId]!;
        const centre = this.compiled.dofs.find(entry => entry.substanceId === instance.center);
        if (!centre) continue;
        solver.setPinTarget(target.substanceId, Math.max(1, Math.hypot(this.pointer.x - dofs[centre.off]!, this.pointer.y - dofs[centre.off + 1]!) - target.grab.x), 0);
      }
    }
  }

  /** One animation frame of interactive solving. */
  frameStep(): DragFrameResult {
    const started = now();
    let solver = this.active();
    this.aimPins(solver);
    solver.step(this.substeps);
    let residual = solver.projectManifold(MANIFOLD_SWEEPS);
    // Topological snap (Shift): preview a temporary constraint.
    const primary = this.targets[0];
    const scale = this.frame.scale;
    const candidate = this.shift && primary?.kind === 'point' ? detectSnap(this.compiled, solver.dofs, primary.substanceId, 10 / Math.max(scale, 1e-6)) : undefined;
    const key = candidate?.statement ?? '';
    if (key !== this.snapKey) {
      this.snapSolver?.dispose();
      this.snapSolver = undefined;
      this.snapKey = key;
      this.snap = candidate;
      if (candidate) {
        this.snapSolver = this.instance(withTemporary(this.compiled, candidate));
        solver = this.snapSolver;
        this.aimPins(solver);
        solver.step(this.substeps);
        residual = solver.projectManifold(MANIFOLD_SWEEPS);
      }
    }
    if (now() - started > FRAME_BUDGET_MS && this.substeps > 4) { /* budget exceeded; next frame keeps the same substep count */ }
    return { dofs: solver.dofs, seeds: encodeSeeds(this.compiled, solver.dofs, this.compiled.bindings), residual, snap: this.snap, elapsedMs: now() - started };
  }

  /** Remove the pointer springs, polish, and return the final seeds. */
  finish(): { seeds: Record<EntityId, number[]>; residual: number; promoted?: string; changed: boolean } {
    const solver = this.active();
    solver.clearPins();
    solver.step(POLISH_ITERATIONS);
    const residual = solver.projectManifold(MANIFOLD_SWEEPS * 4);
    const dofs = Array.from(solver.dofs);
    const changed = dofs.some((value, index) => Math.abs(value - this.startDofs[index]!) > 1e-9);
    const result = { seeds: encodeSeeds(this.compiled, dofs, this.compiled.bindings), residual, changed, ...(this.snap ? { promoted: this.snap.statement } : {}) };
    this.dispose();
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.snapSolver?.dispose();
    this.solver.dispose();
  }
}

/** A drag-only topology: the committed tape plus one temporary constraint. */
export function withTemporary(compiled: CompiledScope, snap: SnapCandidate): CompiledScope {
  const tape = [...compiled.tape];
  const consts = [...compiled.consts, snap.temporary.value, 0];
  const record = [4, snap.temporary.code, 0, ...snap.temporary.refs, snap.temporary.scalar, consts.length - 2, consts.length - 1];
  // Records: [magic, version, dofs, count, ...]; constraints may appear anywhere after the DOFs.
  tape[3] = tape[3]! + 1;
  tape.push(...record);
  return { ...compiled, key: `${compiled.key}\u0000snap:${snap.statement}`, tape, consts };
}

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
