/**
 * Workspace tool discovery for the canvas agent. `workspace.tools` is a host
 * service (docs/workspace-tools.md): callbacks may read and *prepare* a change
 * plan, never mutate the document. Creating an entity is allowed through
 * `prepareChange`; the host shows the approval card and applies it.
 *
 * Without this the agent can only edit existing scopes (`changes_propose`),
 * which is why "add another Penrose scope below" was impossible.
 */
import type { EntityDescriptor, EntityId, WorkspaceToolAccess } from '../host.ts';
import { DEFAULT_SCOPE_SIZE, DEFAULT_SOURCE } from './defaults.ts';
import { planMembers, randomId, topStackingKey, viewportCentre, type PenroseHost } from './documents.ts';
import { DEFAULT_SOLVER_CONFIG, MEMBER_ASPECT, SCOPE_ASPECT, type PenroseScopeAspect } from './schema.ts';

export const CREATE_SCOPE_TOOL = 'penrose.studio:create-scope';
export const LIST_SCOPES_TOOL = 'penrose.studio:list-scopes';

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function registerPenroseTools(tools: WorkspaceToolAccess, host: PenroseHost): (() => void)[] {
  const offs: (() => void)[] = [];
  offs.push(tools.register({
    id: LIST_SCOPES_TOOL,
    description: 'List the Penrose scopes in this document (id, box, applied trio, owner count, error). Use it to place a new scope relative to the existing ones.',
    inputSchema: { type: 'object', properties: {} },
    execute: async (_input, { signal }) => {
      signal.throwIfAborted();
      const view = host.context.world.getCanonicalView();
      const scopes = host.context.world.listEntityIds().flatMap((id: EntityId) => {
        const scope = view.getCanonical<PenroseScopeAspect>(id, SCOPE_ASPECT);
        const box = view.getCanonical<{ x?: number; y?: number; width?: number; height?: number; rotation?: number }>(id, 'core.transform');
        const bounds = view.getCanonical<{ width?: number; height?: number }>(id, 'core.bounds');
        if (!scope) return [];
        return [{
          id,
          box: {
            x: number(box?.x) ?? 0,
            y: number(box?.y) ?? 0,
            width: number(bounds?.width) ?? DEFAULT_SCOPE_SIZE.width,
            height: number(bounds?.height) ?? DEFAULT_SCOPE_SIZE.height,
            rotation: number(box?.rotation) ?? 0,
          },
          applied: scope.topologyDigest !== '',
          variation: scope.variation,
          owners: Object.keys(scope.entityBindings ?? {}).length,
          pins: (scope.pins ?? []).length,
        }];
      });
      return { scopes };
    },
  }));

  offs.push(tools.register({
    id: CREATE_SCOPE_TOOL,
    description: 'Create a Penrose scope (a canvas entity that renders a Penrose Domain/Substance/Style diagram). x/y are the centre of the new scope in canvas coordinates; they default to the current viewport centre. Returns an approval proposal that the host applies.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
    },
    execute: async (input, { signal }) => {
      signal.throwIfAborted();
      const world = host.context.world;
      const scopeId = randomId('ent_penrose_scope');
      const source = DEFAULT_SOURCE;
      const variation = '0';
      // Compile the default example so the new scope arrives with a real digest
      // and converged inputs (a scope with an empty digest renders as "not
      // applied" until someone presses apply). This only fills the engine cache.
      const { compiled, layout } = await host.runtime.apply(scopeId, source, variation);
      signal.throwIfAborted();
      const canvas = layout.canvas.width > 1 && layout.canvas.height > 1 ? layout.canvas : DEFAULT_SCOPE_SIZE;
      const width = Math.min(2400, Math.max(60, Math.round(number(input.width) ?? canvas.width)));
      const height = Math.min(2400, Math.max(60, Math.round(number(input.height) ?? canvas.height)));
      const centre = viewportCentre(host.context);
      const x = Math.round(number(input.x) ?? centre.x - width / 2);
      const y = Math.round(number(input.y) ?? centre.y - height / 2);
      const scopeKey = `${topStackingKey(world)}V`;
      const plan = planMembers(world, scopeId, compiled.owners, {}, scopeKey);
      const scope: PenroseScopeAspect = {
        schemaVersion: 2,
        ...source,
        variation,
        topologyDigest: compiled.digest,
        varyingValues: [...compiled.varyingValues],
        pins: [],
        entityBindings: plan.bindings,
        solverConfig: { ...DEFAULT_SOLVER_CONFIG },
      };
      const operations = [
        { id: scopeId, aspect: 'core.transform', patch: { x, y, rotation: 0 } },
        { id: scopeId, aspect: 'core.bounds', patch: { width, height } },
        { id: scopeId, aspect: 'core.stacking', patch: { order: scopeKey } },
        { id: scopeId, aspect: SCOPE_ASPECT, patch: scope },
        ...plan.ops,
      ];
      const change = tools.prepareChange(operations);
      return {
        changeProposalId: change.changeProposalId,
        operations: change.operations,
        entityId: scopeId,
        box: { x, y, width, height, rotation: 0 },
        owners: compiled.owners.length,
      };
    },
  }));

  // Descriptors are discovery metadata only; a host that does not expose the
  // extension's aspect ids must not lose the create tool because of them.
  const descriptors: EntityDescriptor[] = [
    {
      aspect: SCOPE_ASPECT,
      description: 'Penrose 도해 스코프. Domain · Substance · Style trio와 수렴된 자유 입력을 담습니다.',
      fields: {
        domainDsl: 'Domain DSL 텍스트',
        substanceDsl: 'Substance DSL 텍스트',
        styleDsl: 'Style DSL 텍스트',
        variation: '결정적 샘플 시드 (variation)',
        topologyDigest: '마지막으로 적용한 trio의 다이제스트 (비어 있으면 미적용)',
        varyingValues: '수렴된 자유 입력 배열',
        pins: '고정한 입력 핸들',
        entityBindings: 'substance owner 키 → penrose.member 엔티티 ID',
        solverConfig: 'maxSteps · dragSteps · dragBudgetMs',
      },
    },
    {
      aspect: MEMBER_ASPECT,
      description: 'Penrose 도해의 owner(컴포넌트/노드) 하나를 가리키는 멤버 엔티티. 기즈모와 선택의 단위입니다.',
      fields: {
        scopeId: '소속 penrose.scope 엔티티 ID',
        ownerKey: 'substance owner 키',
        label: '표시 이름',
        pinned: '드래그로 움직이지 않게 고정했는지',
      },
    },
  ];
  for (const descriptor of descriptors) {
    try {
      offs.push(tools.registerDescriptor(descriptor));
    } catch (error) {
      console.warn('[penrose] tool descriptor rejected', descriptor.aspect, error);
    }
  }

  return offs;
}
