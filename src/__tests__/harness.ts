/**
 * The real alid kernel from a local checkout, wired like the playground host:
 * Rust/Wasm core (Loro CRDT + the single UndoManager) behind the world, the
 * repository installer's manifest checks, the package runtime, the computed
 * graph, the SVG compiler, a select-suite-style tool surface and the
 * clipboard suite. `__HAS_ALID__` is false without a checkout and suites skip.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInlineEngine } from '../penrose/engine/inline.ts';

declare const __HAS_ALID__: boolean;
declare const __ALID_CORE_WASM__: string;
export const hasAlid = __HAS_ALID__;

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

let coreReady: Promise<Any> | undefined;

export async function load(factory?: () => Any) {
  const kernel: Any = await import('@alid/kernel');
  const repo: Any = await import('alid-host:repository-plugins');
  const bounds: Any = await import('alid-host:effective-bounds');
  const clipboard: Any = await import('alid-host:clipboard');
  const core: Any = await import('alid-host:core');
  coreReady ??= core.default({ module_or_path: readFileSync(__ALID_CORE_WASM__) });
  await coreReady;
  // Node has no Web Worker: run the same engine code in-process.
  (globalThis as Any).__PENROSE_ENGINE_FACTORY__ = factory ?? (() => createInlineEngine());
  const plugin: Any = (await import('../../dist/plugin.js' as string)).default;
  const manifest = JSON.parse(file('alid.extension.json'));
  return { kernel, repo, bounds, clipboard, core, plugin, manifest, source: file('dist/plugin.js') };
}

export interface Host {
  kernel: Any; world: Any; wasm: Any; compiler: Any; commands: Any; services: Any; registry: Any; plugin: Any; manifest: Any; workbench: Any;
  history: { begin(): void; commit(): void; abort(): void };
  undo(): boolean; redo(): boolean;
  commits: () => number;
  groups: () => number;
  paint(): void;
  surface: HTMLElement; hud: HTMLElement; gizmos: Any; stateMachine: Any;
  selection: () => string[]; select(ids: string[]): void;
  pointer(type: string, x: number, y: number, init?: PointerEventInit): PointerEvent;
  press(x: number, y: number, init?: PointerEventInit): boolean;
  hitTest(x: number, y: number): boolean;
  gizmoHandles(): { id: string; x: number; y: number }[];
  completions: { prompt: string; labels: string[] }[];
  answer: (prompt: string, labels: string[]) => unknown;
  run<T = unknown>(command: string, args?: unknown): Promise<T>;
  api(): Any;
  jsonl(): string;
  tools: Any;
  changes: Any;
  dispose(): void;
}

export async function startHost(options: { clipboard?: boolean; minibuffer?: boolean; vectorPath?: boolean; markdown?: boolean; clientOffset?: { x: number; y: number }; engineFactory?: () => Any } = {}): Promise<Host> {
  const { kernel, repo, bounds, clipboard, core, plugin, manifest } = await load(options.engineFactory);
  const wasm = new core.WasmCanvasCore();
  let commits = 0, groups = 0;
  const world = new kernel.CanvasWorld({
    commitCanonicalBatch: (bytes: Uint8Array, origin: string) => { commits++; wasm.commit_canonical_batch(bytes, origin); },
    updateSpatialBounds: (...args: Any[]) => wasm.update_spatial_bounds(...args),
    clearSpatialBounds: (slot: number) => wasm.clear_spatial_bounds(slot),
  });
  world.registerCanonical({ id: 'core.transform', defaults: { x: 0, y: 0, rotation: 0 } });
  world.registerCanonical({ id: 'core.bounds', defaults: { width: 300 }, optionalFields: ['height'] });
  if (options.vectorPath) world.registerCanonical({ id: 'vector.path', defaults: { contours: [], baseWidth: 1, baseHeight: 1, stroke: '#18181b', strokeWidth: 2, strokeDash: 'solid', strokeCap: 'round', strokeJoin: 'round', fill: 'none', fillOpacity: 1, fillRule: 'evenodd', arrowStart: false, arrowEnd: false } });
  if (options.markdown) world.registerCanonical({ id: 'markdown.card', defaults: { body: '', color: 'yellow' }, textFields: ['body'] });
  bounds.registerEffectiveBoundsBridge(world);
  const history = {
    begin: () => { groups++; wasm.begin_undo_group(); },
    commit: () => wasm.end_undo_group(),
    abort: () => { wasm.abort_undo_group(); world.replaceCanonicalSnapshot(wasm.get_canonical_json()); },
  };
  const sync = (done: boolean) => { world.replaceCanonicalSnapshot(wasm.get_canonical_json()); return done; };
  const services = new kernel.ServiceRegistry(), commands = new kernel.CommandRegistry(world), compiler = new kernel.SceneVectorCompiler();
  const workbench = new kernel.WorkbenchRegistry();
  services.provide('ui.workbench', workbench);
  const stateMachine = new kernel.ToolStateMachine({});
  stateMachine.mountChildState('root', { id: 'select' });
  stateMachine.mountChildState('root.select', { id: 'core.select-suite:idle' });
  stateMachine.transition('root.select.core.select-suite:idle');
  const surface = document.createElement('div'), hud = document.createElement('div');
  document.body.append(surface, hud);
  Object.assign(surface, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  const gizmos = new kernel.GizmoRegistry(), painters = new Set<() => void>();
  let selection: string[] = [];
  const offset = options.clientOffset ?? { x: 0, y: 0 };
  const toScreen = (x: number, y: number, out: { x: number; y: number }) => { out.x = x + offset.x; out.y = y + offset.y; };
  const fromScreen = (x: number, y: number, out: { x: number; y: number }) => { out.x = x - offset.x; out.y = y - offset.y; };
  const tool = {
    surface: { element: surface, hud },
    selection: { stateMachine, gizmos, getSelection: () => selection, select(id: string | null) { selection = id ? [id] : []; } },
    host: { world, screenToWorld: fromScreen, worldToScreen: toScreen, getZoom: () => 1, requestRender() {}, history, isSelectionEnabled: () => true },
  };
  services.provide('canvas.active-tool-surface', { get: () => tool, subscribe: () => () => {} });
  services.provide('canvas.frames', { subscribe(paint: () => void) { painters.add(paint); return () => painters.delete(paint); } });
  services.provide('canvas.surface', { element: surface, hud });
  services.provide('canvas.interaction', { world, screenToWorld: fromScreen, worldToScreen: toScreen, getZoom: () => 1, requestRender() {}, history });
  services.provide('canvas.tool-input', new kernel.CanvasToolInputRegistry());
  const run = (caller: string, ops: Any[]) => { history.begin(); try { world.applyCanonicalTransaction(caller, ops, 'local:user'); history.commit(); } catch (error) { history.abort(); throw error; } };
  services.provide('canvas.clipboard-host', {
    getInsertionPoint: () => ({ x: 900, y: 300 }), getSelectedIds: () => selection,
    insertSnapshot(caller: string, snapshot: Any, ids: string[]) { run(caller, Object.entries(snapshot).flatMap(([id, aspects]: Any) => Object.entries(aspects).map(([aspect, patch]) => ({ id, aspect, patch })))); selection = [...ids]; },
    deleteEntities(caller: string, ids: string[]) { run(caller, ids.map(id => ({ id, aspect: 'core.transform', patch: null }))); },
    beginExclusiveCommand() {},
  });
  // Real workspace.tools + workspace.changes wiring (playground runtime.ts does
  // the same): tool callbacks may only prepare plans, the host applies them.
  const documentAbort = new AbortController();
  const changes = new kernel.createWorkspaceChanges(
    world,
    (caller: string, ops: Any[]) => run(caller, ops),
    () => ({ documentId: 'doc_test', viewId: 'view_test', signal: documentAbort.signal }),
  );
  services.provide('workspace.changes', { getContext: changes.getContext, apply: changes.apply, preview: changes.preview });
  const workspaceTools = new kernel.WorkspaceToolRegistry(changes);
  services.provide('workspace.tools', workspaceTools);
  // A consumer-scoped access the tests use the way the agent does.
  const toolsAccess = workspaceTools.forExtension('test.agent', ['penrose.scope', 'penrose.member'], () => {}, () => true);
  const completions: { prompt: string; labels: string[] }[] = [];
  const minibufferApi = {
    async completingRead(request: Any) {
      const list = typeof request.candidates === 'function' ? request.candidates('', new AbortController().signal) : request.candidates;
      const labels = list.map((candidate: Any) => candidate.label);
      completions.push({ prompt: request.prompt, labels });
      const picked = h.answer(request.prompt, labels);
      if (picked === null) return null;
      const match = list.find((candidate: Any) => candidate.label === picked || candidate.id === picked);
      return match ? match.value : picked;
    },
  };
  const packages: Any[] = [];
  packages.push({ spec: { id: 'core.select-suite', version: '0.1.0', summary: 'selection', provides: { services: ['canvas.selection'], aspects: [], hsmSlots: [] }, activate(ctx: Any) { return ctx.services.provide('canvas.selection', { getSelection: () => selection, select: tool.selection.select }); } } });
  if (options.minibuffer) packages.push({ spec: { id: 'sys.minibuffer', version: '0.1.0', summary: 'minibuffer', provides: { services: ['ui.completingRead'], aspects: [], hsmSlots: [] }, activate(ctx: Any) { const off = ctx.services.provide('ui.completingRead', minibufferApi.completingRead); return { api: minibufferApi, dispose: off }; } } });
  if (options.clipboard) packages.push({ spec: { ...clipboard.createClipboardSuite(), version: '0.1.0', provides: { services: ['canvas.clipboard'] } } });
  repo.validatePluginSpec(plugin, manifest);
  packages.push({ spec: plugin, manifest: repo.pluginRuntimeManifest(manifest, repo.visualAspectIdsOf(plugin), true) });
  const errors: unknown[] = [];
  const registry = new kernel.ExtensionRuntimeRegistry({ world, services, commands, compiler }, { onError: (error: unknown) => errors.push(error), history });
  registry.registerPackages(packages);
  const h: Host = {
    kernel, world, wasm, compiler, commands, services, registry, plugin, manifest, workbench, history,
    tools: toolsAccess, changes,
    undo: () => sync(wasm.undo()), redo: () => sync(wasm.redo()),
    commits: () => commits, groups: () => groups,
    paint: () => { world.flushComputedFrontier(); for (const paint of painters) paint(); world.flushComputedFrontier(); },
    surface, hud, gizmos, stateMachine,
    selection: () => selection, select(ids) { selection = [...ids]; },
    pointer(type, x, y, init = {}) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }) as PointerEvent;
      Object.defineProperty(event, 'pointerId', { value: 1 });
      surface.dispatchEvent(event);
      return event;
    },
    hitTest(x, y) {
      const hit = { id: '', priority: 0, distanceScreenPx: 0 };
      return gizmos.hitTest(x, y, toScreen, hit);
    },
    gizmoHandles() {
      return ((gizmos as Any).handles ?? []).map((handle: Any) => {
        const point = { x: 0, y: 0 };
        handle.getWorldPosition(point);
        return { id: handle.id, x: point.x, y: point.y };
      });
    },
    press(x, y, init = {}) {
      const hit = { id: '', priority: 0, distanceScreenPx: 0 };
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init }) as PointerEvent;
      Object.defineProperty(event, 'pointerId', { value: 1 });
      if (gizmos.hitTest(x, y, toScreen, hit)) return Boolean(gizmos.getHandle(hit.id)?.onPointerDown?.(event));
      surface.dispatchEvent(event);
      return false;
    },
    completions,
    answer: (_prompt, labels) => labels[0] ?? null,
    async run(command, args) { return await commands.execute(command, args) as never; },
    api: () => registry.getExtensionApi?.('penrose.studio') ?? (registry as Any).records?.get('penrose.studio')?.api,
    jsonl: () => wasm.dump_canonical_jsonl(),
    dispose() { registry.dispose(); commands.dispose(); services.dispose(); stateMachine.dispose(); wasm.free(); surface.remove(); hud.remove(); if (errors.length) console.warn('[host errors]', errors); },
  };
  return h;
}

/** Wait for the extension's async Wasm compile and the computed graph to settle. */
export async function settle(host: Host): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    host.paint();
    const scopes = host.world.listEntityIds().filter((id: string) => host.world.getCanonical(id, 'penrose.scope'));
    if (!scopes.length || scopes.every((id: string) => host.world.getComputed(id, 'computed.penrose.layout'))) return;
  }
}
