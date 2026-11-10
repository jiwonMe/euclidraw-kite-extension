import { JSDOM } from 'jsdom';
import type {
  ActivationContext, CanonicalPatchOp, CanvasWorld, CommandSpec, ComputedReadView, EntityId, ScratchOverlay,
  ScopeProps, ServiceLookup, SymbolId,
} from '../src/types.ts';

type Canonical = Map<EntityId, Map<string, Record<string, unknown>>>;

export interface MockWorld extends CanvasWorld {
  canonical: Canonical;
  writes: number;
  transactions: { caller: SymbolId; ops: readonly CanonicalPatchOp[] }[];
  listenerCount(): number;
}

export function createMockWorld(seed?: Record<EntityId, Record<string, Record<string, unknown>>>): MockWorld {
  const canonical: Canonical = new Map();
  for (const [id, aspects] of Object.entries(seed ?? {})) canonical.set(id, new Map(Object.entries(aspects).map(([aspect, props]) => [aspect, structuredClone(props)])));
  const listeners = new Set<() => void>();
  const overlays = new Set<{ patches: Map<string, Record<string, unknown>> }>();
  let writes = 0;
  const transactions: { caller: SymbolId; ops: readonly CanonicalPatchOp[] }[] = [];
  const view = (merge: boolean): ComputedReadView => ({
    getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined {
      if (!merge) return canonical.get(id)?.get(aspect) as Readonly<T> | undefined;
      for (const overlay of overlays) {
        const patch = overlay.patches.get(`${id}:${aspect}`);
        if (patch) return { ...(canonical.get(id)?.get(aspect) ?? {}), ...patch } as Readonly<T>;
      }
      return canonical.get(id)?.get(aspect) as Readonly<T> | undefined;
    },
    getComputed: () => undefined,
    isAlive: id => canonical.has(id),
    listEntityIds: () => [...canonical.keys()],
  });
  const world: MockWorld = {
    canonical,
    writes: 0,
    transactions,
    getCanonical: view(false).getCanonical,
    applyCanonicalTransaction(caller, ops) {
      writes++;
      world.writes = writes;
      transactions.push({ caller, ops });
      for (const op of ops) {
        if (op.patch === null) { canonical.delete(op.id); continue; }
        const entity = canonical.get(op.id) ?? new Map<string, Record<string, unknown>>();
        entity.set(op.aspect, { ...(entity.get(op.aspect) ?? {}), ...structuredClone(op.patch) });
        canonical.set(op.id, entity);
      }
      for (const listener of listeners) listener();
    },
    createScratchOverlay(): ScratchOverlay {
      const overlay = { patches: new Map<string, Record<string, unknown>>() };
      overlays.add(overlay);
      return {
        set(id, aspect, patch) { overlay.patches.set(`${id}:${aspect}`, structuredClone(patch)); },
        setBatch(ops) { for (const op of ops) if (op.patch) overlay.patches.set(`${op.id}:${op.aspect}`, structuredClone(op.patch)); },
        clear() { overlay.patches.clear(); },
        dispose() { overlays.delete(overlay); },
      };
    },
    getPreviewView: () => view(true),
    getCanonicalView: () => view(false),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    listEntityIds: () => [...canonical.keys()],
    isAlive: id => canonical.has(id),
    isEntityReadOnly: () => false,
    listenerCount: () => listeners.size,
  };
  return world;
}

export interface MockHistory { begin(): void; commit(): void; abort(): void; stats(): { begins: number; commits: number; aborts: number } }

export function createMockHistory(): MockHistory {
  let begins = 0, commits = 0, aborts = 0;
  return {
    begin() { begins++; },
    commit() { commits++; },
    abort() { aborts++; },
    stats: () => ({ begins, commits, aborts }),
  };
}

export interface MockHost {
  context: ActivationContext;
  world: MockWorld;
  history: MockHistory;
  commands: Map<SymbolId, CommandSpec>;
  selection: EntityId[];
  service<T>(id: string): T | undefined;
  writes: () => number;
  dispose(): void;
  dom: JSDOM;
}

export function createMockHost(): MockHost {
  const dom = new JSDOM('<!doctype html><html><body><div id="surface" style="width:800px;height:600px"></div><div id="hud"></div></body></html>', { pretendToBeVisual: true });
  const element = dom.window.document.getElementById('surface') as HTMLElement;
  const hud = dom.window.document.getElementById('hud') as HTMLElement;
  const world = createMockWorld();
  const history = createMockHistory();
  const commands = new Map<SymbolId, CommandSpec>();
  const services = new Map<string, unknown>();
  const selection: EntityId[] = [];
  const frames = new Set<() => void>();
  const commandDisposers: (() => void)[] = [];
  const provideDisposers: (() => void)[] = [];
  services.set('canvas.surface', { element, hud });
  services.set('canvas.interaction', {
    world,
    screenToWorld(x: number, y: number, out: { x: number; y: number }) { out.x = x; out.y = y; },
    worldToScreen(x: number, y: number, out: { x: number; y: number }) { out.x = x; out.y = y; },
    getZoom: () => 1,
    requestRender: () => {},
    history,
    onSelectionChanged: (ids: readonly EntityId[]) => { selection.splice(0, selection.length, ...ids); },
  });
  services.set('canvas.selection', {
    getSelection: () => selection,
    select: (id: EntityId | null) => { selection.splice(0, selection.length, ...(id ? [id] : [])); },
  });
  const context: ActivationContext = {
    world,
    get commands() {
      return {
        register(spec: CommandSpec) {
          commands.set(spec.id, spec);
          const off = () => { commands.delete(spec.id); };
          commandDisposers.push(off);
          return off;
        },
      };
    },
    services: {
      get: <T>(id: string): T | undefined => services.get(id) as T | undefined,
      provide: <T>(id: string, value: T) => {
        services.set(id, value);
        const off = () => { if (services.get(id) === value) services.delete(id); };
        provideDisposers.push(off);
        return off;
      },
    } satisfies ServiceLookup,
    getExtensionApi: () => undefined,
    requireExtensionApi: () => { throw new Error('no extension api in tests'); },
  };
  // Frames are exposed through the same service surface the extension reads.
  services.set('canvas.frames', { subscribe: (paint: () => void) => { frames.add(paint); return () => { frames.delete(paint); }; } });
  return {
    context, world, history, commands, selection,
    service: <T>(id: string) => services.get(id) as T | undefined,
    writes: () => world.writes,
    dom,
    dispose() {
      for (const off of commandDisposers.reverse()) off();
      for (const off of provideDisposers.reverse()) off();
    },
  };
}

export function scopeOf(world: MockWorld, id: EntityId): ScopeProps {
  return world.getCanonical<ScopeProps>(id, 'kite.scope') as ScopeProps;
}
