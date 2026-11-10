import type {
  CompiledScope, Constraint, EntityId, MemberPins, ScopeProps, SolvedState,
} from '../types.ts';
import { solveForInteraction } from '../solver/runtime.ts';
import { pointOf, radiusOf, seedsFromValues, solveState } from '../solver/solve.ts';
import { layoutFor } from '../solver/solve.ts';

export interface Promotion {
  kind: 'midpoint' | 'perpendicular' | 'onCircle';
  text: string;
  line: string;
  constraint: Constraint;
}

export interface DragFrame {
  seeds: Record<EntityId, number[]>;
  state: SolvedState;
  promotion: Promotion | null;
}

/**
 * One deterministic drag. The caller owns the ScratchOverlay; this class only
 * computes warm-started XPBD projections and a final canonical patch.
 */
export class KiteDragSession {
  private seeds: Record<EntityId, number[]>;
  private state: SolvedState;
  private promotion: Promotion | null = null;

  constructor(
    private readonly scope: ScopeProps,
    readonly compiled: CompiledScope,
    private readonly pins: MemberPins,
    readonly substanceId: string,
    readonly kind: 'point' | 'radius',
  ) {
    const initial = solveState(compiled, {
      seeds: scope.convergedSeeds,
      memberPins: pins,
      config: scope.solverConfig,
      iterations: 0,
    });
    this.state = initial;
    this.seeds = seedsFromValues(compiled, initial.values);
  }

  currentState(): SolvedState { return this.state; }
  currentSeeds(): Record<EntityId, number[]> { return this.seeds; }
  currentPromotion(): Promotion | null { return this.promotion; }

  moveTo(localX: number, localY: number, shift: boolean, snapDistance: number): DragFrame {
    const iterations = Math.max(1, Math.min(24, this.scope.solverConfig.maxSubstepsPerFrame));
    const pinTarget = this.kind === 'point'
      ? { substanceId: this.substanceId, kind: 'point' as const, value: 0, x: localX, y: localY, strength: 0.38 }
      : { substanceId: this.substanceId, kind: 'radius' as const, value: radiusFrom(this.compiled, this.state, this.substanceId, localX, localY), strength: 0.4 };
    const first = solveForInteraction(this.scope, this.compiled, this.pins, this.seeds, iterations, pinTarget);
    this.promotion = shift ? detectPromotion(this.scope, this.compiled, this.pins, this.substanceId, this.kind, localX, localY, snapDistance, first) : null;
    this.state = this.promotion
      ? solveForInteraction(this.scope, this.compiled, this.pins, seedsFromValues(this.compiled, first.values, this.seeds), iterations, pinTarget, [this.promotion.constraint])
      : first;
    this.seeds = seedsFromValues(this.compiled, this.state.values, this.seeds);
    return { seeds: this.seeds, state: this.state, promotion: this.promotion };
  }

  /** Remove the pointer spring and polish the manifold before the single commit. */
  finish(): { seeds: Record<EntityId, number[]>; state: SolvedState; promotion: Promotion | null; substanceDsl: string } {
    const temporary = this.promotion ? [this.promotion.constraint] : [];
    this.state = solveForInteraction(this.scope, this.compiled, this.pins, this.seeds, 90, undefined, temporary);
    this.seeds = seedsFromValues(this.compiled, this.state.values);
    const substanceDsl = this.promotion && !constraintExists(this.compiled, this.promotion.constraint)
      ? `${this.scope.substanceDsl.replace(/\s*$/, '')}\n${this.promotion.line}\n`
      : this.scope.substanceDsl;
    return { seeds: this.seeds, state: this.state, promotion: this.promotion, substanceDsl };
  }
}

function radiusFrom(compiled: CompiledScope, state: SolvedState, circleId: string, x: number, y: number): number {
  const layout = layoutFor(compiled);
  layout.values.set(state.values);
  const center = pointOf(layout, compiled.instances.get(circleId)?.center ?? '');
  return Math.max(1, Math.hypot(x - center.x, y - center.y));
}

function detectPromotion(
  scope: ScopeProps,
  compiled: CompiledScope,
  pins: MemberPins,
  substanceId: string,
  kind: 'point' | 'radius',
  _localX: number,
  _localY: number,
  snapDistance: number,
  state: SolvedState,
): Promotion | null {
  if (kind !== 'point' || !scope.solverConfig.autoPromoteSnap) return null;
  const layout = layoutFor(compiled, pins);
  layout.values.set(state.values);
  const point = pointOf(layout, substanceId);
  const candidates: { score: number; promotion: Promotion }[] = [];

  // Perpendicular: the dragged point is a shared endpoint of two segments.
  for (const instance of compiled.instances.values()) {
    if (!['segment', 'line', 'ray'].includes(instance.kind) || (instance.a !== substanceId && instance.b !== substanceId)) continue;
    const pivot = instance.a === substanceId ? instance.b! : instance.a!;
    const p = pointOf(layout, pivot);
    const d1 = { x: point.x - p.x, y: point.y - p.y };
    for (const other of compiled.instances.values()) {
      if (other.id === instance.id || !['segment', 'line', 'ray'].includes(other.kind)) continue;
      if (other.a !== substanceId && other.b !== substanceId) continue;
      const otherPivot = other.a === substanceId ? other.b! : other.a!;
      if (otherPivot !== pivot) continue;
      const q = pointOf(layout, otherPivot);
      const d2 = { x: q.x - p.x, y: q.y - p.y };
      const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      const angle = Math.abs(Math.acos(Math.max(-1, Math.min(1, (d1.x * d2.x + d1.y * d2.y) / (l1 * l2)))));
      const error = Math.abs(angle - Math.PI / 2);
      if (error < 3 * Math.PI / 180 && !constraintExists(compiled, { type: 'perpendicular', a: instance.id, b: other.id } as Constraint)) {
        candidates.push({
          score: error * 100,
          promotion: {
            kind: 'perpendicular',
            text: `⊥ Perpendicular(${instance.id}, ${other.id})`,
            line: `Perpendicular(${instance.id}, ${other.id})`,
            constraint: { type: 'perpendicular', a: instance.id, b: other.id, soft: false, weight: 1, sourceLine: 0, text: `Perpendicular(${instance.id}, ${other.id})` },
          },
        });
      }
    }
  }

  // Midpoint: the dragged point is near the midpoint of an unrelated segment.
  for (const instance of compiled.instances.values()) {
    if (!['segment', 'line', 'ray'].includes(instance.kind)) continue;
    if (instance.a === substanceId || instance.b === substanceId) continue;
    const a = pointOf(layout, instance.a!), b = pointOf(layout, instance.b!);
    const distance = Math.hypot(point.x - (a.x + b.x) / 2, point.y - (a.y + b.y) / 2);
    if (distance <= snapDistance && !constraintExists(compiled, { type: 'midpoint', point: substanceId, a: instance.a!, b: instance.b! } as Constraint)) {
      candidates.push({
        score: distance,
        promotion: {
          kind: 'midpoint',
          text: `⇧ Midpoint(${substanceId}, ${instance.a}, ${instance.b})`,
          line: `Midpoint(${substanceId}, ${instance.a}, ${instance.b})`,
          constraint: { type: 'midpoint', point: substanceId, a: instance.a!, b: instance.b!, soft: false, weight: 1, sourceLine: 0, text: `Midpoint(${substanceId}, ${instance.a}, ${instance.b})` },
        },
      });
    }
  }

  // On-circle: the dragged point is near the rim of an unrelated circle.
  for (const instance of compiled.instances.values()) {
    if (instance.kind !== 'circle') continue;
    const center = pointOf(layout, instance.center ?? ''), radius = radiusOf(layout, instance.id);
    const distance = Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius);
    if (distance <= snapDistance && !constraintExists(compiled, { type: 'onCircle', point: substanceId, circle: instance.id } as Constraint)) {
      candidates.push({
        score: distance,
        promotion: {
          kind: 'onCircle',
          text: `○ OnCircle(${substanceId}, ${instance.id})`,
          line: `OnCircle(${substanceId}, ${instance.id})`,
          constraint: { type: 'onCircle', point: substanceId, circle: instance.id, soft: false, weight: 1, sourceLine: 0, text: `OnCircle(${substanceId}, ${instance.id})` },
        },
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.promotion ?? null;
}

function constraintExists(compiled: CompiledScope, candidate: Constraint): boolean {
  for (const constraint of compiled.constraints) {
    if (constraint.type !== candidate.type) continue;
    if (candidate.type === 'midpoint' && constraint.type === 'midpoint') {
      if (constraint.point === candidate.point && constraint.a === candidate.a && constraint.b === candidate.b) return true;
    } else if (candidate.type === 'perpendicular' && constraint.type === 'perpendicular') {
      if ((constraint.a === candidate.a && constraint.b === candidate.b) || (constraint.a === candidate.b && constraint.b === candidate.a)) return true;
    } else if (candidate.type === 'onCircle' && constraint.type === 'onCircle') {
      if (constraint.point === candidate.point && constraint.circle === candidate.circle) return true;
    }
  }
  return false;
}
