import type { EntityId } from '../host.ts';
import { topologyDigest } from './digest.ts';

/** Pinned engine artifact: keep in sync with package.json and docs. */
export const PENROSE_CORE_VERSION = '3.3.1';
export const SCOPE_ASPECT = 'penrose.scope';
export const MEMBER_ASPECT = 'penrose.member';
export const SCOPE_SCHEMA_VERSION = 2;

export interface PenroseSolverConfig {
  readonly maxSteps: number;
  readonly dragSteps: number;
}

export const DEFAULT_SOLVER_CONFIG: PenroseSolverConfig = Object.freeze({
  maxSteps: 4000,
  dragSteps: 2,
});

export interface PenroseScopeAspect extends Record<string, unknown> {
  schemaVersion: number;
  domainDsl: string;
  substanceDsl: string;
  styleDsl: string;
  variation: string;
  /** Digest of the trio, variation, engine version and measurement policy. */
  topologyDigest: string;
  /** Last converged optimization inputs. Only read when the digest matches. */
  varyingValues: number[];
  /** Optimization inputs pinned by the user (index into `varyingValues`). */
  pins: PenrosePin[];
  /** Owner key (`substance object` / collection) → member EntityId. */
  entityBindings: Record<string, EntityId>;
  solverConfig: PenroseSolverConfig;
}

export interface PenrosePin {
  index: number;
  value: number;
}

export interface PenroseMemberAspect extends Record<string, unknown> {
  scopeId: string;
  ownerKey: string;
  pinned: boolean;
  label: string;
}

export interface ScopeSource {
  domainDsl: string;
  substanceDsl: string;
  styleDsl: string;
}

export function readSolverConfig(value: unknown): PenroseSolverConfig {
  const record = (value ?? {}) as Partial<PenroseSolverConfig>;
  const number = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? Math.floor(input) : fallback;
  return {
    maxSteps: number(record.maxSteps, DEFAULT_SOLVER_CONFIG.maxSteps),
    dragSteps: number(record.dragSteps, DEFAULT_SOLVER_CONFIG.dragSteps),
  };
}

/**
 * Cache key for a compiled trio. Includes the engine version and the label
 * measurement policy so a changed engine never reuses stale coordinates.
 */
export function scopeDigest(source: ScopeSource, variation: string): string {
  return topologyDigest([
    'penrose',
    PENROSE_CORE_VERSION,
    'labels:v1',
    variation,
    source.domainDsl,
    source.substanceDsl,
    source.styleDsl,
  ]);
}
