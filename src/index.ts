import type {
  ActivationContext, CommandSpec, ScopeProps,
} from './types.ts';
import { memberAspect, scopeAspect } from './aspects.ts';
import { createPackageManifest, COMMANDS, EXTENSION_MANIFEST, EXTENSION_SUMMARY, SCOPE_ASPECT_IDS } from './manifest.ts';
import { createCommandSpecs, freezeGeometry } from './commands.ts';
import { applyDsl, insertDiagram } from './tools/documents.ts';
import { KiteManipulator } from './tools/kite-manipulate.ts';
import { createTriEditorPanel } from './panel/tri-editor.ts';
import { createDiagnosticsPanel } from './panel/diagnostics.ts';
import { analyzeScope, clearRuntimeCaches, compileCached, solveScope } from './solver/runtime.ts';

export interface KiteApi {
  readonly version: string;
  readonly aspectIds: readonly string[];
  readonly commands: typeof COMMANDS;
  insert(): string;
  apply(input: Parameters<typeof applyDsl>[1]): ReturnType<typeof applyDsl>;
  compile(scope: Readonly<ScopeProps>): ReturnType<typeof compileCached>;
  analyze(scope: Readonly<ScopeProps>): ReturnType<typeof analyzeScope>;
  freeze(): unknown;
}

const KITE_ICON = Object.freeze({
  paths: Object.freeze([
    'M3 17L10 6l3 6 3-3 5 8',
    'M10 6v12',
    'M16 6v12',
  ]),
});

const spec = {
  ...createPackageManifest(),
  summary: EXTENSION_SUMMARY,
  aspects: [
    {
      ...scopeAspect,
      ui: {
        panels: [createTriEditorPanel()],
      },
    },
    memberAspect,
  ],
  ui: {
    panels: [createDiagnosticsPanel()],
    controls: [
      {
        id: 'kite.insert.shelf',
        kind: 'action' as const,
        label: 'Kite 다이어그램',
        icon: KITE_ICON,
        commandSymbol: COMMANDS.insert,
        placement: 'tool-shelf' as const,
        requiresSelection: false,
      },
      {
        id: 'kite.add-constraint.shelf',
        kind: 'action' as const,
        label: 'Kite 구속',
        icon: { paths: ['M4 12h6', 'M14 12h6', 'M12 4v6', 'M12 14v6'] },
        commandSymbol: COMMANDS.addConstraint,
        placement: 'selection-bar' as const,
        requiresSelection: true,
      },
    ],
  },
  activate(context: ActivationContext) {
    let active = true;
    const live = () => { if (!active) throw new Error('Kite Studio 확장이 비활성화되었습니다. 공개 API를 다시 조회하세요.'); };
    const disposers: (() => void)[] = [];
    const commands: CommandSpec[] = createCommandSpecs(context);
    for (const command of commands) disposers.push(context.commands.register(command));
    const manipulator = new KiteManipulator(context);
    disposers.push(() => manipulator.dispose());
    const api: KiteApi = Object.freeze({
      version: EXTENSION_MANIFEST.version,
      aspectIds: SCOPE_ASPECT_IDS,
      commands: COMMANDS,
      insert: () => { live(); return insertDiagram(context); },
      apply: (input: Parameters<typeof applyDsl>[1]) => { live(); return applyDsl(context, input); },
      compile: (scope: Readonly<ScopeProps>) => { live(); return compileCached(scope); },
      analyze: (scope: Readonly<ScopeProps>) => {
        live();
        const solved = solveScope(scope, context.world.getCanonicalView());
        return analyzeScope(solved.compiled, solved.state, solved.pins);
      },
      freeze: () => { live(); return freezeGeometry(context); },
    });
    const releaseApi = context.services.provide?.<KiteApi>('kite.api', api);
    if (releaseApi) disposers.push(releaseApi);
    return {
      api: Object.freeze({
        insert: () => { live(); return insertDiagram(context); },
        apply: (input: Parameters<typeof applyDsl>[1]) => { live(); return applyDsl(context, input); },
        commands: COMMANDS,
      }),
      dispose() {
        if (!active) return;
        active = false;
        for (const dispose of disposers.splice(0).reverse()) dispose();
        clearRuntimeCaches();
      },
    };
  },
};

export default spec;
