import type { ActivationContext, CanvasToolInputRegistry, CanvasToolSurface, CanvasToolSurfaceProvider, EntityId } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import type { SolvedGeometry } from '../computed-bridge.ts';
import { applySource, readScope, scopeOfSelection, type ApplyResult } from '../documents.ts';
import { toLocal } from '../geometry.ts';
import { COMPUTED, EXTENSION_ID } from '../manifest.ts';

/**
 * Quick construction inside a selected scope (`root.select.kite.studio:create`).
 *
 *   P  then click        → Point at the click
 *   S  click, click      → Segment between two existing points (or new ones)
 *   C  click, click      → Circle: centre, then a point it passes through
 *   Escape               → leave the tool without writing
 *
 * Each completed construction is one DSL edit (one undo step). Keys arrive
 * through `canvas.tool-input`, which already applies the IME and
 * native-control guards; nothing here listens to document keydown.
 */
export const CREATE_STATE = `${EXTENSION_ID}:create`;
const IDLE = 'root.select.core.select-suite:idle';
type Mode = 'point' | 'segment' | 'circle';
const SNAP_PX = 10;

export class KiteCreateTool {
  private mode?: Mode;
  private scopeId?: EntityId;
  private pending: string[] = [];
  private surface?: CanvasToolSurface;
  private abort?: AbortController;
  private stateOff?: () => void;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly context: ActivationContext, private readonly afterApply: (result: ApplyResult) => void) {
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) { this.bind(provider.get()); this.disposers.push(provider.subscribe(() => this.bind(provider.get()))); }
    const input = context.services.get<CanvasToolInputRegistry>('canvas.tool-input');
    if (input) this.disposers.push(input.register(CREATE_STATE, { handleKeyDown: event => this.key(event) }));
  }

  get activeMode(): Mode | undefined { return this.mode; }

  private bind(surface: CanvasToolSurface | undefined): void {
    if (surface === this.surface) return;
    this.exit();
    this.abort?.abort();
    this.stateOff?.();
    this.surface = surface;
    if (!surface) return;
    const doc = surface.surface.element.ownerDocument;
    this.abort = new (doc.defaultView?.AbortController ?? AbortController)();
    surface.surface.element.addEventListener('pointerdown', this.press, { capture: true, signal: this.abort.signal });
    try { this.stateOff = surface.selection.stateMachine.mountChildState('root.select', { id: CREATE_STATE, onExit: () => { this.mode = undefined; this.pending = []; } }); } catch { this.stateOff = undefined; }
  }

  /** Enter a construction mode on the selected scope. */
  start(mode: Mode): boolean {
    const scopeId = scopeOfSelection(this.context);
    if (!scopeId || !this.surface || this.context.world.isEntityReadOnly(scopeId)) return false;
    this.mode = mode; this.scopeId = scopeId; this.pending = [];
    try { this.surface.selection.stateMachine.transition(`root.select.${CREATE_STATE}`); } catch { /* slot missing */ }
    return true;
  }

  exit(): void {
    if (!this.mode) return;
    this.mode = undefined; this.pending = [];
    try { if (this.surface?.selection.stateMachine.stateId.endsWith(CREATE_STATE)) this.surface.selection.stateMachine.transition(IDLE); } catch { /* idle missing */ }
  }

  private key(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === 'Escape' && this.mode) { this.exit(); return true; }
    const map: Record<string, Mode> = { p: 'point', s: 'segment', c: 'circle' };
    const mode = map[event.key.toLowerCase()];
    return mode !== undefined && Boolean(scopeOfSelection(this.context)) && this.start(mode);
  }

  private readonly press = (event: PointerEvent) => {
    const surface = this.surface;
    if (!this.mode || !surface || !this.scopeId || event.button !== 0 || surface.host.isPanGesture?.(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const world = { x: 0, y: 0 };
    surface.host.screenToWorld(event.clientX, event.clientY, world);
    try { this.click(world); } catch (error) { surface.host.onError?.(error instanceof Error ? error : new Error(String(error))); this.exit(); }
  };

  /** One construction click, in world coordinates. Exposed for tests. */
  click(world: { x: number; y: number }): ApplyResult | undefined {
    const scopeId = this.scopeId!;
    const view = this.context.world.getCanonicalView();
    const compiled = view.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
    const solved = view.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
    const scope = readScope(this.context.world, scopeId);
    if (!compiled?.ok || !solved || !scope) return undefined;
    const local = toLocal(solved.frame, world.x, world.y);
    const zoom = Math.max(this.surface?.host.getZoom() ?? 1, 1e-3);
    const near = compiled.dofs.find(slot => slot.kind === 'point' && Math.hypot(solved.dofs[slot.off]! - local.x, solved.dofs[slot.off + 1]! - local.y) * solved.frame.scale * zoom <= SNAP_PX);
    const typeOf = (shape: string) => Object.values(compiled.types).find(type => type.shape === shape)?.name;
    const fresh = (prefix: string, taken: Set<string>) => { for (let i = 1; ; i++) if (!compiled.instances[`${prefix}${i}`] && !taken.has(`${prefix}${i}`)) return `${prefix}${i}`; };
    const lines: string[] = [];
    const taken = new Set<string>();
    let pointId = near?.substanceId;
    if (!pointId) {
      const type = typeOf('point'); if (!type) throw new Error('Domain에 point 타입이 없습니다.');
      pointId = fresh('P', taken); taken.add(pointId);
      lines.push(`${type} ${pointId} = (${Math.round(local.x * 10) / 10}, ${Math.round(local.y * 10) / 10})`);
    }
    if (this.mode === 'point') return this.write(scopeId, scope.substanceDsl, lines, true);
    if (!this.pending.length) {
      if (lines.length) { const result = this.write(scopeId, scope.substanceDsl, lines, false); this.pending = [pointId]; return result; }
      this.pending = [pointId];
      return undefined;
    }
    const first = this.pending[0]!;
    if (first === pointId) return undefined;
    if (this.mode === 'segment') {
      const type = typeOf('segment'); if (!type) throw new Error('Domain에 segment 타입이 없습니다.');
      lines.push(`${type} ${fresh('s', taken)} = ${first} .. ${pointId}`);
    } else {
      const type = typeOf('circle'); if (!type) throw new Error('Domain에 circle 타입이 없습니다.');
      lines.push(`${type} ${fresh('c', taken)} = center ${first} through ${pointId}`);
    }
    return this.write(scopeId, readScope(this.context.world, scopeId)!.substanceDsl, lines, true);
  }

  private write(scopeId: EntityId, substance: string, lines: string[], done: boolean): ApplyResult | undefined {
    if (!lines.length) { if (done) this.exit(); return undefined; }
    const result = applySource(this.context, scopeId, { substanceDsl: `${substance.replace(/\s*$/, '')}\n${lines.join('\n')}\n` }, `create-${this.mode}`);
    this.afterApply(result);
    if (done) { this.pending = []; if (this.mode !== 'point') this.exit(); }
    return result;
  }

  dispose(): void {
    this.exit();
    for (const off of this.disposers.splice(0).reverse()) off();
    this.abort?.abort();
    this.stateOff?.();
  }
}
