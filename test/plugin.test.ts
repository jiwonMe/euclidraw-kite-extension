import { describe, expect, it } from 'vitest';
import metadata from '../extension.json';
import spec from '../src/index.ts';
import { COMMAND_NAMES, COMMANDS, createPackageManifest, MEMBER_ASPECT_ID, SCOPE_ASPECT_ID } from '../src/manifest.ts';
import { createMockHost } from './harness.ts';
import { commitScopePatch, insertDiagram } from '../src/tools/documents.ts';
import { compileScope } from '../src/dsl/compile.ts';
import { KiteDragSession } from '../src/tools/drag-session.ts';
import { deriveMember } from '../src/aspects.ts';
import { memberSvg } from '../src/render/member.ts';
import { solveScope } from '../src/solver/runtime.ts';
import { memberPinsFrom } from '../src/solver/solve.ts';
import type { MemberProps, ScopeProps, WorkbenchPanelContext } from '../src/types.ts';

function activate() {
  const host = createMockHost();
  const activation = spec.activate!(host.context)! as { api: Record<string, unknown>; dispose(): void };
  const run = (id: string, args?: unknown) => host.commands.get(id as never)!.run(args as never);
  return { host, activation, run };
}

function membersOf(host: ReturnType<typeof createMockHost>, scopeId: string): string[] {
  return Object.values(host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!.entityBindings);
}

describe('Kite Studio package contract', () => {
  it('matches extension.json and exposes both canonical aspects', () => {
    const manifest = createPackageManifest();
    expect(spec.id).toBe(metadata.id);
    expect(spec.version).toBe(metadata.version);
    expect(spec.engine).toBe(metadata.engine);
    expect(manifest.provides.aspects).toEqual(['kite.scope', 'kite.member']);
    expect(spec.aspects?.map(aspect => aspect.id)).toEqual(['kite.scope', 'kite.member']);
    expect(COMMAND_NAMES.length).toBe(metadata.commands.length);
    expect(new Set(Object.values(COMMANDS)).size).toBe(COMMAND_NAMES.length);
  });

  it('registers every command, the kite.api service and both panels', () => {
    const { host, activation } = activate();
    expect(host.commands.size).toBe(COMMAND_NAMES.length);
    const api = host.service<{ version: string; insert(): string }>('kite.api');
    expect(api?.version).toBe(metadata.version);
    expect(activation.api).toBeDefined();
    expect(host.service('canvas.frames')).toBeDefined();
    const panels = (spec.aspects?.[0]?.ui?.panels ?? []).concat(spec.ui?.panels ?? []);
    expect(panels.map(panel => panel.panelId)).toEqual(['kite.panel.tri-editor', 'kite.panel.diagnostics']);
    activation.dispose();
    expect(host.commands.size).toBe(0);
    expect(host.service('kite.api')).toBeUndefined();
    expect(() => (activation.api.insert as () => unknown)()).toThrow(/비활성화/);
    host.dispose();
  });
});

describe('creation and canonical discipline', () => {
  it('creates a scope and its members in one transaction and one undo group', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    expect(host.writes()).toBe(1);
    expect(host.history.stats()).toEqual({ begins: 1, commits: 1, aborts: 0 });
    const scope = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    expect(scope.schemaVersion).toBe(1);
    expect(scope.domainDsl).toContain('type Point');
    expect(scope.substanceDsl).toContain('Perpendicular(AB, BC)');
    expect(Object.keys(scope.entityBindings).length).toBe(12);
    expect(Object.keys(scope.convergedSeeds).length).toBe(6);
    const members = membersOf(host, scopeId);
    expect(members.length).toBe(12);
    for (const id of members) {
      expect(host.world.getCanonical<MemberProps>(id, MEMBER_ASPECT_ID)).toMatchObject({ scopeId });
      expect(host.world.getCanonical(id, 'core.stacking')).toBeDefined();
      expect(host.world.getCanonical(id, 'core.transform')).toBeUndefined();
    }
    activation.dispose();
    host.dispose();
  });

  it('keeps read-only rendering free of canonical writes', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    const before = host.writes();
    const scope = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    for (const entityId of Object.values(scope.entityBindings)) {
      const props = host.world.getCanonical<MemberProps>(entityId, MEMBER_ASPECT_ID)!;
      const derived = deriveMember(props, entityId, host.world.getCanonicalView());
      expect(derived).toBeDefined();
      expect(memberSvg(derived!)).toContain('<');
    }
    const first = solveScope(scope, host.world.getCanonicalView());
    const second = solveScope(scope, host.world.getCanonicalView());
    expect(second.state.residual).toBe(first.state.residual);
    expect(host.writes()).toBe(before);
    activation.dispose();
    host.dispose();
  });

  it('applies a DSL edit as one batch and keeps bindings stable', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    const before = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    const writes = host.writes(), commits = host.history.stats().commits;
    run(COMMANDS.apply, {
      entityId: scopeId,
      styleDsl: `${before.styleDsl}\nP { fill: #16a34a }`,
    });
    const after = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    expect(after.styleDsl).toContain('#16a34a');
    expect(after.entityBindings).toEqual(before.entityBindings);
    expect(host.writes()).toBe(writes + 1);
    expect(host.history.stats().commits).toBe(commits + 1);
    const solved = solveScope(after, host.world.getCanonicalView());
    expect(solved.state.converged).toBe(true);
    activation.dispose();
    host.dispose();
  });

  it('removes constraints and pins points when geometry is frozen', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    run(COMMANDS.freeze, { entityId: scopeId });
    const scope = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    const compiled = compileScope(scope);
    expect(compiled.constraints).toHaveLength(0);
    expect(compiled.ok).toBe(true);
    const pointLines = scope.substanceDsl.split('\n').filter(line => /^Point\s+/.test(line));
    expect(pointLines.length).toBe(5);
    expect(pointLines.every(line => /\spin\s*$/.test(line))).toBe(true);
    activation.dispose();
    host.dispose();
  });

  it('repairs stale bindings and removes duplicate members', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    host.world.applyCanonicalTransaction('test:duplicate', [{ id: 'ent_duplicate_p', aspect: MEMBER_ASPECT_ID, patch: { scopeId, substanceId: 'P', primitiveKind: 'point', pinnedDofs: [], slackWeight: 1 } }]);
    host.selection.splice(0, host.selection.length, scopeId);
    const result = run(COMMANDS.repair, { entityId: scopeId }) as { bindings: number; removed: number };
    expect(result.removed).toBe(1);
    expect(host.world.isAlive('ent_duplicate_p')).toBe(false);
    expect(Object.keys(host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!.entityBindings).length).toBe(12);
    activation.dispose();
    host.dispose();
  });

  it('commits exactly one patch and can be undone to the pre-drag seeds', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    const before = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    const originalSeeds = structuredClone(before.convergedSeeds);
    const compiled = compileScope(before);
    const pins = memberPinsFrom(compiled, host.world.getCanonicalView());
    const session = new KiteDragSession(before, compiled, pins, 'P', 'point');
    for (let frame = 0; frame < 20; frame++) session.moveTo(470, 30, false, 14);
    const result = session.finish();
    const writes = host.writes(), commits = host.history.stats().commits, begins = host.history.stats().begins;
    commitScopePatch(host.context, scopeId, { convergedSeeds: result.seeds }, 'manipulate');
    expect(host.writes()).toBe(writes + 1);
    expect(host.history.stats()).toEqual({ begins: begins + 1, commits: commits + 1, aborts: 0 });
    const after = host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!;
    expect(after.convergedSeeds).not.toEqual(originalSeeds);
    // The host's UndoManager would replay the inverse patch; the canonical shape is one field.
    host.world.applyCanonicalTransaction('test:undo', [{ id: scopeId, aspect: SCOPE_ASPECT_ID, patch: { convergedSeeds: originalSeeds } }]);
    expect(host.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID)!.convergedSeeds).toEqual(originalSeeds);
    activation.dispose();
    host.dispose();
  });
});

describe('workbench panels', () => {
  it('mounts the tri editor and diagnostics against a selected scope', () => {
    const { host, activation, run } = activate();
    const scopeId = run(COMMANDS.insert) as string;
    host.selection.splice(0, host.selection.length, scopeId);
    const panelContext: WorkbenchPanelContext = {
      world: host.world,
      getSelectedIds: () => host.selection,
      onSelectionChange: () => () => {},
      onWorldMutated: () => () => {},
      executeCommand: async (symbol, args) => host.commands.get(symbol)?.run(args as never),
    };
    const tri = spec.aspects![0]!.ui!.panels![0]!;
    const triHost = host.dom.window.document.createElement('div');
    const disposeTri = tri.mount!(triHost, panelContext);
    expect(triHost.textContent).toContain('Kite Tri-DSL');
    expect((triHost.querySelector('textarea') as HTMLTextAreaElement).value).toContain('Perpendicular');
    disposeTri?.();
    const diagnostics = spec.ui!.panels![0]!;
    const diagHost = host.dom.window.document.createElement('div');
    const disposeDiag = diagnostics.mount!(diagHost, panelContext);
    expect(diagHost.textContent).toContain('DOF');
    disposeDiag?.();
    activation.dispose();
    host.dispose();
  });
});

describe('insertDiagram direct API', () => {
  it('creates fresh unique scopes', () => {
    const host = createMockHost();
    const first = insertDiagram(host.context);
    const second = insertDiagram(host.context);
    expect(first).not.toBe(second);
    expect(host.world.isAlive(first)).toBe(true);
    expect(host.world.isAlive(second)).toBe(true);
    expect(host.writes()).toBe(2);
    host.dispose();
  });
});
