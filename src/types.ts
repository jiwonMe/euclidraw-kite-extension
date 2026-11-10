/**
 * The slice of EucliDraw/alid's public extension contract this package uses,
 * declared structurally so the bundle needs no SDK import. Shapes follow
 * @alid/kernel: porcelain-and-trust.ts, kernel-data.ts, workbench-types.ts,
 * entity-creation.ts, extension-manifest.ts, tool-input.ts.
 */

export type EntityId = string;
export type SymbolId = `${string}:${string}`;

export interface ComputedReadView {
  listEntityIds?(): readonly EntityId[];
  getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined;
  getComputed<T>(id: EntityId, aspect: string): Readonly<T> | undefined;
  isAlive(id: EntityId): boolean;
}

export interface CanonicalPatchOp {
  id: EntityId;
  aspect: string;
  patch: Record<string, unknown> | null;
}

export interface ScratchOverlay {
  set(id: EntityId, aspect: string, patch: Record<string, unknown>): void;
  setBatch(ops: readonly CanonicalPatchOp[]): void;
  clear(): void;
  dispose(): void;
}

export interface CanvasWorld {
  getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined;
  applyCanonicalTransaction(caller: SymbolId, ops: readonly CanonicalPatchOp[], origin?: string): void;
  createScratchOverlay(owner: string): ScratchOverlay;
  getPreviewView(): ComputedReadView;
  getCanonicalView(): ComputedReadView;
  subscribe(listener: () => void): () => void;
  listEntityIds(): readonly EntityId[];
  isAlive(id: EntityId): boolean;
  isEntityReadOnly(id: EntityId): boolean;
}

export interface MutablePoint { x: number; y: number }
export interface ToolModifiers { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }

export interface ToolStateMachine {
  readonly stateId: string;
  mountChildState(parentId: string, spec: {
    id: string;
    onExit?(context: unknown): void;
    onModifiersChanged?(context: unknown, modifiers: Readonly<ToolModifiers>): void;
  }): () => void;
  transition(id: string): void;
}

export interface GizmoHit { id: string; priority: number; distanceScreenPx: number }
export interface GizmoRegistry {
  register(handle: {
    id: string;
    priority: number;
    shape: 'circle' | 'rect';
    radiusScreenPx?: number;
    getWorldPosition(out: MutablePoint): boolean;
    onPointerDown?(event: PointerEvent): boolean;
  }): () => void;
  hitTest(clientX: number, clientY: number, worldToScreen: (x: number, y: number, out: MutablePoint) => void, out: GizmoHit): boolean;
}

export interface WorkbenchHistory { begin(): void; commit(): void; abort(): void }

export interface CanvasToolSurface {
  surface: { element: HTMLElement; hud: HTMLElement };
  selection: {
    readonly stateMachine: ToolStateMachine;
    readonly gizmos: GizmoRegistry;
    getSelection(): readonly EntityId[];
    select(id: EntityId | null): void;
  };
  host: {
    screenToWorld(x: number, y: number, out: MutablePoint): void;
    worldToScreen(x: number, y: number, out: MutablePoint): void;
    getZoom(): number;
    requestRender(): void;
    readonly history: WorkbenchHistory;
    isPanGesture?(event: PointerEvent): boolean;
    isSelectionEnabled?(): boolean;
    onError?(error: Error): void;
  };
}
export interface CanvasToolSurfaceProvider { get(): CanvasToolSurface | undefined; subscribe(listener: () => void): () => void }
export interface CanvasFrameScheduler { subscribe(paint: () => void): () => void }
export interface CanvasToolInputRegistry { register(owner: string, handler: { handleKeyDown(event: KeyboardEvent): boolean }): () => void }

export type WorkbenchIcon = string | { paths: readonly (string | { d: string; fill?: boolean })[]; fill?: boolean; size?: number };
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type UiControl =
  | { id: string; kind: 'slider' | 'number'; field: string; label: string; placement: 'inspector'; min?: number; max?: number; step?: number }
  | { id: string; kind: 'text' | 'color' | 'toggle'; field: string; label: string; placement: 'inspector' }
  | { id: string; kind: 'segmented'; field: string; label: string; placement: 'inspector'; options: { label: string; value: JsonValue }[] }
  | { id: string; kind: 'action'; label: string; placement: 'tool-shelf' | 'selection-bar'; commandSymbol: SymbolId; icon?: WorkbenchIcon; requiresSelection?: boolean };

export interface WorkbenchPanelContext {
  readonly world: CanvasWorld;
  getSelectedIds(): readonly EntityId[];
  onSelectionChange(callback: (selected: readonly EntityId[]) => void): () => void;
  onWorldMutated(callback: () => void): () => void;
  executeCommand(symbol: SymbolId, args?: JsonValue): Promise<unknown>;
}

export interface WorkbenchPanelSpec {
  panelId: `${string}.${string}`;
  title: string;
  icon?: WorkbenchIcon;
  defaultZone: 'left' | 'right' | 'bottom';
  inspectorFor?: string;
  isolation?: 'shadow' | 'container';
  mount?(host: HTMLElement, context: WorkbenchPanelContext): void | (() => void);
}

export interface SelectionContribution {
  getBounds(id: EntityId, view: ComputedReadView, out: { x: number; y: number; width: number; height: number; rotation?: number }): boolean;
  hitTest(id: EntityId, view: ComputedReadView, x: number, y: number, zoom: number): number;
  intersectsRect(id: EntityId, view: ComputedReadView, minX: number, minY: number, maxX: number, maxY: number): boolean;
  canTransform?(id: EntityId, view: ComputedReadView): boolean;
}

export interface AspectSpec<TProps extends Record<string, unknown>, TDerived> {
  id: string;
  selection?: SelectionContribution;
  label?: string;
  summary?: string;
  defaults: TProps;
  refs?: Partial<Record<keyof TProps, 'cascade-hide' | 'nullify'>>;
  textFields?: string[];
  textSearchFields?: string[];
  dependsOnCanonical?: string[];
  dependsOnComputed?: string[];
  layout?: boolean;
  paintOverflow?: number;
  derive?(props: Readonly<TProps>, id: EntityId, view: ComputedReadView): TDerived | undefined;
  renderSvg?(props: Readonly<TProps>, derived: TDerived | undefined, id: EntityId): { svg: string };
  ui?: { controls?: UiControl[]; panels?: WorkbenchPanelSpec[] };
}

export interface CommandSpec {
  id: SymbolId;
  title: string;
  summary: string;
  keys?: string[];
  shortcutScope?: 'canvas' | 'global';
  shortcutSelectionAspect?: string;
  run(params?: JsonValue): unknown;
}

export interface EntityCreationRequest {
  caller: SymbolId;
  aspects: Record<string, Record<string, unknown>>;
  width: number;
  height?: number;
  x?: number;
  y?: number;
}

export interface ServiceLookup {
  get<T>(id: string): T | undefined;
  provide?<T>(id: string, value: T): () => void;
}

export interface ActivationContext {
  readonly world: CanvasWorld;
  readonly services: ServiceLookup;
  readonly commands: { register(spec: CommandSpec): () => void };
  getExtensionApi?<T>(extensionId: string): T | undefined;
  requireExtensionApi?<T>(extensionId: string): T;
}

export interface PackageManifest {
  id: string;
  version: string;
  engine: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  conflicts: string[];
  provides: { services: string[]; aspects: string[]; hsmSlots: string[] };
}

// ── Kite document schema ───────────────────────────────────────────────────

export type PrimitiveKind =
  | 'point'
  | 'segment'
  | 'line'
  | 'ray'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'angle-mark'
  | 'label-anchor';

export interface SolverConfig {
  maxSubstepsPerFrame: number;
  convergenceTolerance: number;
  damping: number;
  autoPromoteSnap: boolean;
}

export interface ScopeProps extends Record<string, unknown> {
  schemaVersion: 1;
  domainDsl: string;
  substanceDsl: string;
  styleDsl: string;
  entityBindings: Record<string, EntityId>;
  convergedSeeds: Record<EntityId, number[]>;
  solverConfig: SolverConfig;
}

export interface MemberProps extends Record<string, unknown> {
  scopeId: EntityId;
  substanceId: string;
  primitiveKind: PrimitiveKind;
  pinnedDofs: number[];
  slackWeight: number;
}

export interface StyleProps { [key: string]: string | number | boolean | null }

export interface LabelSpec {
  text: string;
  anchor: { kind: 'point' | 'center' | 'midpoint'; id: string };
  offset?: number;
  offsetX?: number;
  offsetY?: number;
  offsetMode: 'normal' | 'vector';
}

export interface SubstanceInstance {
  id: string;
  typeName: string;
  kind: PrimitiveKind;
  line: number;
  x?: number;
  y?: number;
  pinned?: boolean;
  center?: string;
  radius?: number;
  through?: string;
  a?: string;
  b?: string;
  points?: string[];
  angle?: [string, string, string];
  startAngle?: number;
  endAngle?: number;
  label?: LabelSpec;
}

export interface ConstraintBase {
  soft: boolean;
  weight: number;
  sourceLine: number;
  text: string;
}

export type Constraint =
  | (ConstraintBase & { type: 'distance'; a: string; b: string; value: number })
  | (ConstraintBase & { type: 'onCircle'; point: string; circle: string })
  | (ConstraintBase & { type: 'onLine'; point: string; line: string })
  | (ConstraintBase & { type: 'midpoint'; point: string; a: string; b: string })
  | (ConstraintBase & { type: 'perpendicular' | 'parallel' | 'equallength'; a: string; b: string })
  | (ConstraintBase & { type: 'tangent'; line: string; circle: string })
  | (ConstraintBase & { type: 'coincident'; a: string; b: string })
  | (ConstraintBase & { type: 'horizontal' | 'vertical'; segment: string })
  | (ConstraintBase & { type: 'radius'; circle: string; value: number })
  | (ConstraintBase & { type: 'angleat'; vertex: string; a: string; b: string; value: number })
  | (ConstraintBase & { type: 'fixed'; point: string });

export interface DofSlot {
  instanceId: string;
  kind: 'point' | 'circle';
  offset: number;
  size: 1 | 2;
}

export interface CompileError { line: number; message: string }

export interface DomainType { name: string; shape?: PrimitiveKind; parent?: string; line: number }
export interface DomainPredicate { name: string; args: string[]; line: number }

export interface DomainModel {
  types: Map<string, DomainType>;
  predicates: Map<string, DomainPredicate>;
  errors: CompileError[];
  typeNames: string[];
  predicateNames: string[];
}

export interface StyleRule { selectors: string[]; props: StyleProps; line: number }
export interface StyleModel { rules: StyleRule[]; errors: CompileError[] }

export interface Badges {
  ticks: Map<string, number>;
  rightAngles: { vertex: string; a: string; b: string }[];
  onCircle: Map<string, string>;
}

export interface CompiledScope {
  key: string;
  ok: boolean;
  errors: CompileError[];
  domain: DomainModel;
  substance: {
    instances: Map<string, SubstanceInstance>;
    constraints: { name: string; args: string[]; soft: boolean; line: number }[];
    pinned: Set<string>;
    errors: CompileError[];
  };
  style: StyleModel;
  instances: Map<string, SubstanceInstance>;
  order: string[];
  constraints: Constraint[];
  pinned: Set<string>;
  dofs: DofSlot[];
  dofCount: number;
  layoutSignature: string;
  styles: Map<string, StyleProps>;
  badges: Badges;
  labels: SubstanceInstance[];
  bindings: Record<string, EntityId>;
}

export interface SolvedState {
  values: Float64Array;
  residual: number;
  perConstraint: number[];
  stress: Map<string, number>;
  iterations: number;
  dirty: boolean;
  converged: boolean;
}

export interface MemberPins {
  pinnedDofs: Map<string, number[]>;
  slackWeight: Map<string, number>;
}

export interface Point { x: number; y: number }

export interface DerivedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  kind: PrimitiveKind;
  name: string;
  style: StyleProps;
  points: Point[];
  center?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  textX?: number;
  textY?: number;
  textSize?: number;
  arrow?: number;
  squares: { x: number; y: number; ax: number; ay: number; bx: number; by: number; size: number }[];
  stress: number;
  badges: { ticks: number; rightAngle: boolean; pinned: boolean; onCircle: boolean };
}

export interface SolveOptions {
  memberPins?: MemberPins;
  iterations: number;
  pinTarget?: { substanceId: string; kind: 'point' | 'radius'; value: number; x?: number; y?: number; strength?: number };
  temporary?: Constraint[];
  polish?: boolean;
}

export interface SolvedScope {
  compiled: CompiledScope;
  state: SolvedState;
  seeds: Record<EntityId, number[]>;
  pins: MemberPins;
}
