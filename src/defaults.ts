import type { ScopeProps, SolverConfig } from './types.ts';

export const DEFAULT_WIDTH = 520;
export const DEFAULT_HEIGHT = 360;

export const DEFAULT_SOLVER_CONFIG: SolverConfig = Object.freeze({
  maxSubstepsPerFrame: 12,
  convergenceTolerance: 1e-5,
  damping: 0.98,
  autoPromoteSnap: true,
});

export const DEFAULT_DOMAIN = `# Kite Studio — Domain DSL
# type <Name> shape <primitive>
type Point shape point
type Segment shape segment
type Line shape line
type Ray shape ray
type Circle shape circle
type Arc shape arc
type Polygon shape polygon
type Angle shape angle-mark
type Label shape label-anchor

# predicate <Name>(<Type>, ...)
predicate Distance(Point, Point, Number)
predicate OnCircle(Point, Circle)
predicate OnLine(Point, Line)
predicate Midpoint(Point, Point, Point)
predicate Perpendicular(Segment, Segment)
predicate Parallel(Segment, Segment)
predicate EqualLength(Segment, Segment)
predicate Tangent(Segment, Circle)
predicate Coincident(Point, Point)
predicate Horizontal(Segment)
predicate Vertical(Segment)
predicate Radius(Circle, Number)
predicate AngleAt(Point, Point, Point, Number)
predicate Fixed(Point)
`;

export const DEFAULT_SUBSTANCE = `# Kite Studio — Substance DSL
# Point A = (x, y) [pin]
Point A = (80, 240) pin
Point B = (260, 240) pin
Point C = (260, 60)
Point M = (170, 150)
Point P = (297, 150)

Segment AB = A .. B
Segment BC = B .. C
Segment CA = C .. A
Segment BM = B .. M

Circle c1 = center M r 127

Angle angB = A B C
Label labC = "c₁" at center c1 offset (0, 16)

# 논리 구속: 바깥 점을 끌어도 이 관계가 유지됩니다.
Perpendicular(AB, BC)
EqualLength(AB, BC)
Midpoint(M, A, C)
OnCircle(B, c1)
OnCircle(P, c1)
`;

export const DEFAULT_STYLE = `# Kite Studio — Style DSL
point { r: 4.5; fill: #2563eb; stroke: #ffffff; width: 1.5; label: false }
segment { stroke: #475569; width: 2; ticks: true }
line { stroke: #475569; width: 2 }
ray { stroke: #475569; width: 2 }
circle { stroke: #94a3b8; width: 1.75; fill: none }
arc { stroke: #f59e0b; width: 1.75 }
polygon { stroke: #475569; width: 2; fill: none }
angle-mark { stroke: #f59e0b; width: 1.5; radius: 22; label: false }
label-anchor { fill: #334155; fontSize: 15 }

A { label: "A" }
B { label: "B" }
C { label: "C" }
M { label: "M" }
P { label: "P"; fill: #dc2626 }
c1 { label: false }
angB { label: "90°"; fontSize: 13 }
`;

export const DEFAULT_SCOPE: Omit<ScopeProps, 'entityBindings' | 'convergedSeeds'> = Object.freeze({
  schemaVersion: 1,
  domainDsl: DEFAULT_DOMAIN,
  substanceDsl: DEFAULT_SUBSTANCE,
  styleDsl: DEFAULT_STYLE,
  solverConfig: DEFAULT_SOLVER_CONFIG,
});

export function createScopeDefaults(): ScopeProps {
  return {
    schemaVersion: 1,
    domainDsl: DEFAULT_DOMAIN,
    substanceDsl: DEFAULT_SUBSTANCE,
    styleDsl: DEFAULT_STYLE,
    solverConfig: { ...DEFAULT_SOLVER_CONFIG },
    entityBindings: {},
    convergedSeeds: {},
  };
}

export function normalizeSolverConfig(input: Partial<SolverConfig> | undefined): SolverConfig {
  const source = input ?? {};
  const maxSubsteps = Number(source.maxSubstepsPerFrame);
  const tolerance = Number(source.convergenceTolerance);
  const damping = Number(source.damping);
  return {
    maxSubstepsPerFrame: Number.isFinite(maxSubsteps) ? Math.max(1, Math.min(64, Math.round(maxSubsteps))) : DEFAULT_SOLVER_CONFIG.maxSubstepsPerFrame,
    convergenceTolerance: Number.isFinite(tolerance) && tolerance > 0 ? Math.min(1, tolerance) : DEFAULT_SOLVER_CONFIG.convergenceTolerance,
    damping: Number.isFinite(damping) ? Math.max(0.5, Math.min(1, damping)) : DEFAULT_SOLVER_CONFIG.damping,
    autoPromoteSnap: source.autoPromoteSnap === undefined ? DEFAULT_SOLVER_CONFIG.autoPromoteSnap : Boolean(source.autoPromoteSnap),
  };
}

export function readScope(source: Partial<ScopeProps> | undefined): ScopeProps {
  return {
    schemaVersion: 1,
    domainDsl: typeof source?.domainDsl === 'string' ? source.domainDsl : DEFAULT_DOMAIN,
    substanceDsl: typeof source?.substanceDsl === 'string' ? source.substanceDsl : DEFAULT_SUBSTANCE,
    styleDsl: typeof source?.styleDsl === 'string' ? source.styleDsl : DEFAULT_STYLE,
    entityBindings: source?.entityBindings && typeof source.entityBindings === 'object' ? source.entityBindings : {},
    convergedSeeds: source?.convergedSeeds && typeof source.convergedSeeds === 'object' ? source.convergedSeeds : {},
    solverConfig: normalizeSolverConfig(source?.solverConfig),
  };
}
