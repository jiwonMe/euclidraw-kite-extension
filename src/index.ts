import type { ActivationContext, ComputedAspectSpec, EntityId, MinibufferApi, ScratchOverlay, UiControl } from './host.ts';
import { memberSpec, scopeSpec } from './aspect-specs.ts';
import { clearCompileCache, createComputedSpecs, type SolvedGeometry } from './computed-bridge.ts';
import { ASPECT_IDS, COMMANDS, COMPUTED, EXTENSION_ID, EXTENSION_SUMMARY, EXTENSION_VERSION, PANELS, createPackageManifest } from './manifest.ts';
import { readScope } from './documents.ts';
import { Space2AGizmos } from './render/space2a-gizmos.ts';
import { Space2BPopover } from './render/space2b-popover.ts';
import { SCOPE_ASPECT } from './schema.ts';
import { loadSolverModule, solverDigest, SolverPool } from './solver-runtime.ts';
import { KiteCreateTool } from './tools/kite-create.ts';
import { KiteManipulator } from './tools/kite-manipulate.ts';
import { RelaxAnimator } from './tools/relax-animation.ts';
import { createCommands, runAction } from './workbench/commands.ts';
import { createDiagnosticsPanel, diagnose } from './workbench/diagnostics-panel.ts';
import { createTriEditorPanel } from './workbench/tri-editor-panel.ts';
import type { CompiledScope } from './dsl/compile.ts';

/**
 * `kite.studio` — Kite Studio as a pattern-A subgraph extension (PRD v1.0.0).
 *
 * Everything is contributed through the public package contract; no kernel or
 * Rust core changes. The solver is this package's own Wasm module.
 */

export interface KiteApi {
  readonly version: string;
  readonly solverSha256: string;
  readonly aspectIds: readonly string[];
  insertScope(): EntityId;
  compiled(scopeId: EntityId): CompiledScope | undefined;
  solved(scopeId: EntityId): SolvedGeometry | undefined;
  diagnose(scopeId: EntityId): ReturnType<typeof diagnose> | undefined;
}

const ICON = { paths: ['M3 16 L10 4 L17 16 Z', 'M10 4 V16', { d: 'M9 3.2a1.2 1.2 0 1 0 2 0a1.2 1.2 0 1 0-2 0', fill: true }] } as const;

/** Mutable hooks the static panel specs call into once activation runs. */
const live: {
  highlight?: Space2AGizmos['setHighlight'];
  hovered?: () => { scopeId: EntityId; substanceId: string } | undefined;
  preview?: (scopeId: EntityId, styleDsl: string | undefined) => void;
  frames: Set<() => void>;
} = { frames: new Set() };

const triEditor = createTriEditorPanel({
  highlight: state => live.highlight?.(state),
  hovered: () => live.hovered?.(),
  previewParam: (scopeId, styleDsl) => live.preview?.(scopeId, styleDsl),
  subscribeFrame: listener => { live.frames.add(listener); return () => { live.frames.delete(listener); }; },
});

const shelf: UiControl[] = [
  { id: 'kite.insert', kind: 'action', label: 'Kite 도해', icon: ICON as never, placement: 'tool-shelf', commandSymbol: COMMANDS.insert, requiresSelection: false },
];

let interactiveScope: () => EntityId | undefined = () => undefined;
const pool = new SolverPool();
const computed = createComputedSpecs({ pool, interactive: () => interactiveScope() });

const spec = {
  ...createPackageManifest(),
  summary: EXTENSION_SUMMARY,
  aspects: [scopeSpec([triEditor]), memberSpec()],
  ui: { controls: shelf, panels: [createDiagnosticsPanel()] },
  activate(context: ActivationContext) {
    let active = true;
    const disposers: (() => void)[] = [];
    const register = <T>(spec: ComputedAspectSpec<T>) => { const off = context.world.registerComputed?.(spec); if (off) disposers.push(off); };
    // compiledVm and solvedGeometry are kernel computed nodes; the member
    // aspect's own derive (computed.kite.member) depends on them.
    register(computed.compiledVm as unknown as ComputedAspectSpec<CompiledScope>);
    register(computed.solvedGeometry as unknown as ComputedAspectSpec<SolvedGeometry>);

    // The ~100 KB module compiles asynchronously; computed cells return
    // undefined until then, so the first paint shows nothing rather than
    // blocking. The invalidation below re-derives every Kite entity once.
    void loadSolverModule().then(() => {
      if (!active) return;
      (context.world as { invalidateComputed?(): void }).invalidateComputed?.();
    }).catch(error => console.error('[kite] solver failed to load', error));

    // Order matters inside the host's single frame latch: the drag solves
    // first, then Space 2A paints that same frame (no one-frame shear).
    let gizmos: Space2AGizmos | undefined;
    const manipulator = new KiteManipulator(context, { onFrame: state => gizmos?.setDrag(state) });
    disposers.push(() => manipulator.dispose());
    gizmos = new Space2AGizmos(context);
    const plane = gizmos;
    disposers.push(() => plane.dispose());
    interactiveScope = () => manipulator.interactiveScope();
    disposers.push(() => { interactiveScope = () => undefined; });

    const relax = new RelaxAnimator(context);
    disposers.push(() => relax.dispose());

    const minibuffer = (): MinibufferApi | undefined => {
      try { return context.getExtensionApi?.<MinibufferApi>('sys.minibuffer') ?? context.services.get<MinibufferApi>('ui.completingRead') ?? undefined; } catch { return undefined; }
    };
    const workbench = (): { openPanel?(id: string): void } | undefined => { try { return context.services.get('workspace.layout') ?? context.services.get('ui.workbench'); } catch { return undefined; } };
    const host = {
      context,
      minibuffer,
      afterApply: (result: { scopeId: EntityId; previousDofs?: readonly number[]; compiled: CompiledScope; dofs: readonly number[] }) => relax.start(result.scopeId, result.compiled, result.previousDofs, result.dofs),
      openPanel: (panelId: string) => workbench()?.openPanel?.(panelId),
      notify: (message: string) => console.info(`[kite] ${message}`),
    };
    for (const command of createCommands(host)) disposers.push(context.commands.register(command));

    const creator = new KiteCreateTool(context, host.afterApply);
    disposers.push(() => creator.dispose());
    const popover = new Space2BPopover(context, { run: (scopeId, action) => { void runAction(host, scopeId, action).catch(error => console.error('[kite]', error)); } });
    disposers.push(() => popover.dispose());

    // Style param previews (DialKit drags) live in a ScratchOverlay only.
    let paramOverlay: ScratchOverlay | undefined;
    live.highlight = state => plane.setHighlight(state);
    live.hovered = () => plane.getHover();
    live.preview = (scopeId, styleDsl) => {
      if (styleDsl === undefined) { paramOverlay?.clear(); return; }
      paramOverlay ??= context.world.createScratchOverlay(`${EXTENSION_ID}:param-preview`);
      paramOverlay.set(scopeId, SCOPE_ASPECT, { styleDsl });
    };
    const frames = context.services.get<{ subscribe(paint: () => void): () => void }>('canvas.frames');
    if (frames) disposers.push(frames.subscribe(() => { for (const listener of live.frames) listener(); }));
    disposers.push(() => { paramOverlay?.dispose(); live.highlight = undefined; live.hovered = undefined; live.preview = undefined; });

    const guard = () => { if (!active) throw new Error('Kite Studio 확장이 비활성화되었습니다.'); };
    const api: KiteApi = Object.freeze({
      version: EXTENSION_VERSION,
      solverSha256: solverDigest(),
      aspectIds: ASPECT_IDS,
      insertScope: () => { guard(); return context.commands && (createCommands(host).find(command => command.id === COMMANDS.insert)!.run() as EntityId); },
      compiled: (scopeId: EntityId) => { guard(); return context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm); },
      solved: (scopeId: EntityId) => { guard(); return context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry); },
      diagnose: (scopeId: EntityId) => {
        guard();
        const compiled = context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm), solved = context.world.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
        return compiled?.ok && solved && readScope(context.world, scopeId) ? diagnose(compiled, solved, []) : undefined;
      },
    });
    const releaseApi = context.services.provide?.<KiteApi>('kite.api', api);
    if (releaseApi) disposers.push(releaseApi);

    return {
      api: Object.freeze({ ...api, manipulator, creator, gizmos: plane, popover, panels: PANELS }),
      dispose() {
        if (!active) return;
        active = false;
        for (const off of disposers.splice(0).reverse()) { try { off(); } catch (error) { console.error('[kite] cleanup failed', error); } }
        pool.clear();
        clearCompileCache();
      },
    };
  },
};

export default spec;
