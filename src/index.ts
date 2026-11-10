import type { ActivationContext, ComputedAspectSpec, EntityId, UiControl } from './host.ts';
import { ASPECT_IDS, COMMANDS, COMPUTED, EXTENSION_SUMMARY, EXTENSION_VERSION, PANELS, createPackageManifest } from './manifest.ts';
import { memberSpec, scopeSpec } from './penrose/aspects.ts';
import { createComputedSpecs, type CompiledScope, type SolvedLayout } from './penrose/computed.ts';
import { createCommands } from './penrose/commands.ts';
import { insertScope, type PenroseHost } from './penrose/documents.ts';
import { PenroseManipulator } from './penrose/manipulate.ts';
import { createDiagnosticsPanel, createTriEditorPanel } from './penrose/panels.ts';
import { PenroseRuntime } from './penrose/runtime.ts';
import { PENROSE_CORE_VERSION } from './penrose/schema.ts';

/**
 * `penrose.studio` — Penrose diagrams as an alid pattern-A subgraph.
 *
 * The engine (`@penrose/core`) runs in a Blob worker; this bundle only carries
 * the worker source string, the pure SVG renderer and the host integration.
 */

export interface PenroseApi {
  readonly version: string;
  readonly coreVersion: string;
  readonly aspectIds: readonly string[];
  insertScope(): Promise<EntityId>;
  compiled(scopeId: EntityId): CompiledScope | undefined;
  layout(scopeId: EntityId): SolvedLayout | undefined;
  diagnose(scopeId: EntityId): readonly string[];
}

const ICON = {
  paths: [
    'M3 16 L10 4 L17 16 Z',
    'M10 4 V16',
    { d: 'M9 3.2a1.2 1.2 0 1 0 2 0a1.2 1.2 0 1 0-2 0', fill: true },
  ],
} as const;

const shelf: UiControl[] = [
  {
    id: 'penrose.insert',
    kind: 'action',
    label: 'Penrose 도해',
    icon: ICON as never,
    placement: 'tool-shelf',
    commandSymbol: COMMANDS.insert,
    requiresSelection: false,
  },
];

const panels = [createTriEditorPanel(), createDiagnosticsPanel()];

const spec = {
  ...createPackageManifest(),
  summary: EXTENSION_SUMMARY,
  aspects: [scopeSpec(panels), memberSpec()],
  ui: { controls: shelf, panels },
  activate(context: ActivationContext) {
    let active = true;
    const disposers: (() => void)[] = [];
    const runtime = new PenroseRuntime(context.world);
    const host: PenroseHost = { context, runtime };

    const register = <T>(computedSpec: ComputedAspectSpec<T>) => {
      const off = context.world.registerComputed?.(computedSpec);
      if (off) disposers.push(off);
    };
    const computed = createComputedSpecs(runtime);
    register(computed.compiled);
    register(computed.layout);

    for (const command of createCommands(host)) disposers.push(context.commands.register(command));
    const manipulator = new PenroseManipulator(host);
    disposers.push(() => manipulator.dispose());

    const guard = () => { if (!active) throw new Error('Penrose Studio 확장이 비활성화되었습니다.'); };
    const api: PenroseApi = Object.freeze({
      version: EXTENSION_VERSION,
      coreVersion: PENROSE_CORE_VERSION,
      aspectIds: ASPECT_IDS,
      insertScope: () => { guard(); return insertScope(host); },
      compiled: (scopeId: EntityId) => { guard(); return context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled); },
      layout: (scopeId: EntityId) => { guard(); return context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout); },
      diagnose: (scopeId: EntityId) => {
        guard();
        const compiled = context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled);
        const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
        const lines: string[] = [];
        if (compiled?.pending) lines.push('컴파일 중');
        if (compiled && !compiled.ok && !compiled.pending) lines.push(`오류: ${compiled.error ?? 'DSL 오류'}`);
        if (compiled) {
          lines.push(`owners ${compiled.owners.length} · inputs ${compiled.varyingValues.length}`);
          for (const diagnostic of compiled.diagnostics.slice(0, 8)) lines.push(`${diagnostic.source} L${diagnostic.line}: ${diagnostic.message}`);
        }
        if (layout) lines.push(`단계 ${layout.stages} · 에너지 ${layout.energy.toFixed(4)} · shapes ${layout.shapes.length}`);
        return lines;
      },
    });
    const releaseApi = context.services.provide?.<PenroseApi>('penrose.api', api);
    if (releaseApi) disposers.push(releaseApi);

    return {
      api: Object.freeze({ ...api, runtime, manipulator, panels: PANELS }),
      dispose() {
        if (!active) return;
        active = false;
        for (const off of disposers.splice(0).reverse()) { try { off(); } catch (error) { console.error('[penrose] cleanup failed', error); } }
        runtime.close();
      },
    };
  },
};

export default spec;
