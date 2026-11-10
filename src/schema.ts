import type { EntityId } from './host.ts';

/** PRD §3.1: canonical aspects. Only intent and the last converged seeds are stored. */
export const SCOPE_ASPECT = 'kite.scope';
export const MEMBER_ASPECT = 'kite.member';

export type KitePrimitiveKind =
  | 'point'
  | 'segment'
  | 'line'
  | 'ray'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'angle-mark'
  | 'label-anchor';

export const PRIMITIVE_KINDS: readonly KitePrimitiveKind[] = ['point', 'segment', 'line', 'ray', 'circle', 'arc', 'polygon', 'angle-mark', 'label-anchor'];

export interface KiteSolverConfig {
  maxSubstepsPerFrame: number;
  convergenceTolerance: number;
  damping: number;
  autoPromoteSnap: boolean;
}

export interface KiteScopeAspect extends Record<string, unknown> {
  schemaVersion: 1;
  /** Domain DSL: types, predicates and constructors. */
  domainDsl: string;
  /** Substance DSL: declared objects and logical constraints. */
  substanceDsl: string;
  /** Style DSL: visual mapping, objectives and constraint weights. */
  styleDsl: string;
  /** Substance identifier ↔ alid EntityId. */
  entityBindings: Record<string, EntityId>;
  /**
   * Last converged DOFs per member, normalised to the scope box ([0,1] of
   * width/height for coordinates, of the box diagonal for lengths), so a scope
   * resize scales geometry without re-solving.
   */
  convergedSeeds: Record<EntityId, number[]>;
  solverConfig: KiteSolverConfig;
}

export interface KiteMemberAspect extends Record<string, unknown> {
  scopeId: EntityId;
  substanceId: string;
  primitiveKind: KitePrimitiveKind;
  /** Local DOF indices the user pinned (0 = x / radius, 1 = y). */
  pinnedDofs: number[];
  /** Pointer-spring resistance while dragging; larger is stiffer. */
  slackWeight: number;
}

export const DEFAULT_SOLVER_CONFIG: KiteSolverConfig = Object.freeze({
  maxSubstepsPerFrame: 12,
  convergenceTolerance: 1e-5,
  damping: 0.98,
  autoPromoteSnap: true,
});

export const DEFAULT_SCOPE_WIDTH = 520;
export const DEFAULT_SCOPE_HEIGHT = 380;

export function readSolverConfig(input: Partial<KiteSolverConfig> | undefined): KiteSolverConfig {
  const value = input ?? {};
  const substeps = Number(value.maxSubstepsPerFrame), tolerance = Number(value.convergenceTolerance), damping = Number(value.damping);
  return {
    maxSubstepsPerFrame: Number.isFinite(substeps) ? Math.max(1, Math.min(64, Math.round(substeps))) : DEFAULT_SOLVER_CONFIG.maxSubstepsPerFrame,
    convergenceTolerance: Number.isFinite(tolerance) && tolerance > 0 ? Math.min(1, tolerance) : DEFAULT_SOLVER_CONFIG.convergenceTolerance,
    damping: Number.isFinite(damping) ? Math.max(0.1, Math.min(1, damping)) : DEFAULT_SOLVER_CONFIG.damping,
    autoPromoteSnap: value.autoPromoteSnap === undefined ? DEFAULT_SOLVER_CONFIG.autoPromoteSnap : Boolean(value.autoPromoteSnap),
  };
}

export function isKitePrimitive(value: unknown): value is KitePrimitiveKind {
  return typeof value === 'string' && (PRIMITIVE_KINDS as readonly string[]).includes(value);
}
