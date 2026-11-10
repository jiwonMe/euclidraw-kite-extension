import type { ActivationContext, CanvasFrameScheduler, EntityId, ScratchOverlay } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import { encodeSeeds } from '../geometry.ts';
import { EXTENSION_ID } from '../manifest.ts';
import { SCOPE_ASPECT } from '../schema.ts';

/**
 * PRD §5.2: after a DSL/minibuffer edit, the canonical seeds are already the
 * converged result. To keep context, the geometry eases from the previous
 * state over ~180 ms with exponential decay — in a ScratchOverlay only, so the
 * document and undo history see exactly one change.
 */
export const RELAX_MS = 180;

export class RelaxAnimator {
  private overlay?: ScratchOverlay;
  private running?: { scopeId: EntityId; compiled: CompiledScope; from: readonly number[]; to: readonly number[]; started: number };
  private readonly off: () => void;

  constructor(private readonly context: ActivationContext, private readonly clock: () => number = () => performance.now()) {
    const frames = context.services.get<CanvasFrameScheduler>('canvas.frames');
    this.off = frames ? frames.subscribe(() => this.tick()) : () => {};
  }

  start(scopeId: EntityId, compiled: CompiledScope, from: readonly number[] | undefined, to: readonly number[]): void {
    if (!from || from.length !== to.length || from.every((value, index) => Math.abs(value - to[index]!) < 1e-6)) { this.stop(); return; }
    this.overlay ??= this.context.world.createScratchOverlay(`${EXTENSION_ID}:relax`);
    this.running = { scopeId, compiled, from, to, started: this.clock() };
    this.tick();
  }

  get active(): boolean { return this.running !== undefined; }

  tick(): void {
    const run = this.running;
    if (!run) return;
    const t = Math.min(1, (this.clock() - run.started) / RELAX_MS);
    if (t >= 1) { this.stop(); return; }
    // 1 − e^(−5t), renormalised to reach exactly 1 at t = 1.
    const k = (1 - Math.exp(-5 * t)) / (1 - Math.exp(-5));
    const dofs = run.from.map((value, index) => value + (run.to[index]! - value) * k);
    this.overlay!.set(run.scopeId, SCOPE_ASPECT, { convergedSeeds: encodeSeeds(run.compiled, dofs, run.compiled.bindings) });
  }

  stop(): void { this.running = undefined; this.overlay?.clear(); }

  dispose(): void { this.stop(); this.off(); this.overlay?.dispose(); this.overlay = undefined; }
}
