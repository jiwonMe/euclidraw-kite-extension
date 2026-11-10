/**
 * The slice of alid's public extension contract this package uses, declared
 * structurally so the bundle has no SDK import. Shapes follow @alid/kernel
 * (porcelain-and-trust.ts, kernel-data.ts, workbench-types.ts, tool-input.ts,
 * selection-contributions.ts) and core.clipboard / sys.minibuffer types.
 * `src/__tests__/alid-kernel.test.ts` checks them against a real kernel.
 */
export type EntityId = string;
export type SymbolId = `${string}:${string}`;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface ComputedReadView {
  listEntityIds?(): readonly EntityId[];
  getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined;
  getComputed<T>(id: EntityId, aspect: string): Readonly<T> | undefined;
  isAlive(id: EntityId): boolean;
  getPaintRank?(id: EntityId): number | undefined;
}

export interface CanonicalPatchOp {
  id: EntityId;
  aspect: string;
  patch: Record<string, unknown> | null;
}

export interface ScratchOverlay {
  set(id: EntityId, aspect: string, patch: Record<string, unknown> | null): void;
  setBatch(ops: readonly CanonicalPatchOp[]): void;
  clear(): void;
  dispose(): void;
}

export interface ComputedAspectSpec<TOut = unknown> {
  readonly id: `computed.${string}`;
  readonly symbol: SymbolId;
  readonly dependsOnCanonical: string[];
  readonly dependsOnComputed?: string[];
  compute(entityId: EntityId, view: ComputedReadView): TOut | undefined;
  readonly equals?: (previous: TOut, next: TOut) => boolean;
}

export interface CanvasWorld {
  getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined;
  getComputed<T>(id: EntityId, aspect: string): Readonly<T> | undefined;
  applyCanonicalTransaction(caller: SymbolId, ops: readonly CanonicalPatchOp[], origin?: string): void;
  createScratchOverlay(owner: string): ScratchOverlay;
  getPreviewView(): ComputedReadView;
  getCanonicalView(): ComputedReadView;
  registerComputed?<T>(spec: ComputedAspectSpec<T>): () => void;
  registerSelectionExpander?(expand: (ids: readonly EntityId[], scope?: EntityId | null) => readonly EntityId[]): () => void;
  subscribe(listener: () => void): () => void;
  subscribePreview?(listener: () => void): () => void;
  listEntityIds(): readonly EntityId[];
  isAlive(id: EntityId): boolean;
  isEntityReadOnly(id: EntityId): boolean;
  exportCanonicalSnapshot?(): Record<EntityId, Record<string, Record<string, unknown>>>;
  hasCanonicalSpec?(id: string): boolean;
}

export interface MutablePoint { x: number; y: number }
export interface ToolModifiers { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }

export interface ToolStateMachine {
  readonly stateId: string;
  mountChildState(parentId: string, spec: { id: string; onExit?(context: unknown): void; onModifiersChanged?(context: unknown, modifiers: Readonly<ToolModifiers>): void }): () => void;
  transition(id: string): void;
}

export interface GizmoHit { id: string; priority: number; distanceScreenPx: number }
export interface GizmoRegistry {
  register(handle: {
    id: string; priority: number; shape: 'circle' | 'rect'; radiusScreenPx?: number;
    getWorldPosition(out: MutablePoint): boolean; onPointerDown?(event: PointerEvent): boolean;
  }): () => void;
  hitTest(clientX: number, clientY: number, worldToScreen: (x: number, y: number, out: MutablePoint) => void, out: GizmoHit): boolean;
}

export interface WorkbenchHistory { begin(): void; commit(): void; abort(): void }

export interface CanvasToolSurface {
  surface: { element: HTMLElement; hud: HTMLElement };
  selection: { readonly stateMachine: ToolStateMachine; readonly gizmos: GizmoRegistry; getSelection(): readonly EntityId[]; select(id: EntityId | null): void };
  host: {
    screenToWorld(x: number, y: number, out: MutablePoint): void;
    worldToScreen(x: number, y: number, out: MutablePoint): void;
    getZoom(): number;
    requestRender(): void;
    readonly history: WorkbenchHistory;
    readonly world?: CanvasWorld;
    isPanGesture?(event: PointerEvent): boolean;
    isSelectionEnabled?(): boolean;
    onError?(error: Error): void;
  };
}
export interface CanvasToolSurfaceProvider { get(): CanvasToolSurface | undefined; subscribe(listener: () => void): () => void }
export interface CanvasFrameScheduler { subscribe(paint: () => void): () => void }
export interface CanvasToolInputRegistry { register(owner: string, handler: { handleKeyDown(event: KeyboardEvent): boolean }): () => void }

export type WorkbenchIcon = string | { paths: readonly (string | { d: string; fill?: boolean })[]; fill?: boolean; size?: number };

export type UiControl =
  | { id: string; kind: 'slider' | 'number'; field: string; label: string; placement: 'inspector'; min?: number; max?: number; step?: number; section?: string }
  | { id: string; kind: 'text' | 'color' | 'toggle'; field: string; label: string; placement: 'inspector'; section?: string }
  | { id: string; kind: 'action'; label: string; placement: 'tool-shelf' | 'selection-bar' | 'inspector'; commandSymbol: SymbolId; icon?: WorkbenchIcon; requiresSelection?: boolean; minSelectionCount?: number; maxSelectionCount?: number };

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
  navigation?: { group: 'document' | 'application'; order?: number; command?: SymbolId };
  isolation?: 'shadow' | 'container';
  mount?(host: HTMLElement, context: WorkbenchPanelContext): void | (() => void);
}

export interface SelectionContribution {
  priority?: number;
  getBounds(id: EntityId, view: ComputedReadView, out: { x: number; y: number; width: number; height: number; rotation?: number }): boolean;
  hitTest(id: EntityId, view: ComputedReadView, x: number, y: number, zoom: number): number;
  intersectsRect(id: EntityId, view: ComputedReadView, minX: number, minY: number, maxX: number, maxY: number): boolean;
  getOutlinePath?(id: EntityId, view: ComputedReadView, projection: { worldToScreen(x: number, y: number, out: MutablePoint): void; getZoom(): number }): string;
  canTransform?(id: EntityId, view: ComputedReadView): boolean;
}

export interface AspectSpec<TProps extends Record<string, unknown>, TDerived> {
  id: string;
  label?: string;
  summary?: string;
  defaults: TProps;
  refs?: Partial<Record<keyof TProps, 'cascade-hide' | 'nullify'>>;
  textFields?: (keyof TProps & string)[];
  textSearchFields?: (keyof TProps & string)[];
  dependsOnCanonical?: string[];
  dependsOnComputed?: string[];
  layout?: boolean;
  paintOverflow?: number;
  renderMode?: 'dom' | 'vector';
  selection?: SelectionContribution;
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
  run(params?: JsonValue): unknown;
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

// ── core.clipboard (packages/extensions/clipboard/src/types.ts) ─────────────

export interface ClipboardPasteContext {
  readonly world: CanvasWorld;
  readonly targetPoint: { readonly x: number; readonly y: number };
  readonly clipboardData: Pick<DataTransfer, 'getData'>;
}
export interface ClipboardService {
  registerPasteHandler(handler: {
    id: string; priority: number;
    canHandle(ctx: ClipboardPasteContext): boolean;
    buildOps(ctx: ClipboardPasteContext): CanonicalPatchOp[] | Promise<CanonicalPatchOp[]>;
  }): () => void;
}
export interface ClipboardHost {
  getInsertionPoint(): { x: number; y: number };
  getSelectedIds(): readonly EntityId[];
}

// ── sys.minibuffer (packages/extensions/minibuffer/src/types.ts) ────────────

export interface CompletionCandidate<T> {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly category?: string;
  readonly searchText?: string;
  readonly value: T;
}
export interface CompletingReadOptions<T> {
  readonly prompt: string;
  readonly candidates: readonly CompletionCandidate<T>[] | ((query: string, signal: AbortSignal) => readonly CompletionCandidate<T>[]);
  readonly initialQuery?: string;
  readonly signal?: AbortSignal;
  readonly onPreview?: (candidate: CompletionCandidate<T>) => void;
  readonly onRestore?: () => void;
}
export interface MinibufferApi { completingRead<T>(options: CompletingReadOptions<T>): Promise<T | null> }
