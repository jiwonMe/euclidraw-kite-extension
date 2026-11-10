import type { CommandSpec, EntityId, JsonValue } from '../host.ts';
import { COMMANDS, PANELS } from '../manifest.ts';
import {
  applySource,
  insertScope,
  optionalService,
  readScope,
  reprojectScope,
  resampleScope,
  scopeMembers,
  scopeOfSelection,
  select,
  selectedIds,
  togglePin,
  type PenroseHost,
} from './documents.ts';
import { DEFAULT_SOURCE } from './defaults.ts';
import { MEMBER_ASPECT, type PenroseMemberAspect } from './schema.ts';
import { bakeScope } from './bake.ts';
import { type CompiledScope } from './computed.ts';
import { COMPUTED } from '../manifest.ts';

interface ApplyArgs {
  scopeId?: string;
  domainDsl?: string;
  substanceDsl?: string;
  styleDsl?: string;
}

function openPanel(host: PenroseHost, panelId: string): void {
  const { context } = host;
  const workbench = optionalService<{ openPanel?(id: string): void }>(context, 'workspace.layout')
    ?? optionalService<{ openPanel?(id: string): void }>(context, 'ui.workbench');
  if (workbench?.openPanel) { workbench.openPanel(panelId); return; }
  console.info(`[penrose] 패널을 열 수 없습니다: ${panelId}`);
}

function requireScope(host: PenroseHost, explicit?: string): EntityId {
  const scopeId = scopeOfSelection(host.context, explicit);
  if (!scopeId) throw new Error('Penrose 스코프를 선택하세요.');
  return scopeId;
}

/** The selected member's owner key, or the single member under the selection. */
function selectedOwner(host: PenroseHost): { scopeId: EntityId; ownerKey: string } {
  const { context } = host;
  for (const id of selectedIds(context)) {
    const member = context.world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId && member.ownerKey) return { scopeId: member.scopeId, ownerKey: member.ownerKey };
  }
  const scopeId = requireScope(host);
  const scope = readScope(context.world, scopeId);
  const members = Object.values({ ...(scope?.entityBindings ?? {}), ...scopeMembers(context.world.getCanonicalView(), scopeId) });
  if (members.length === 1) {
    const member = context.world.getCanonical<PenroseMemberAspect>(members[0]!, MEMBER_ASPECT);
    if (member?.ownerKey) return { scopeId, ownerKey: member.ownerKey };
  }
  throw new Error('멤버를 선택하세요.');
}

export function createCommands(host: PenroseHost): CommandSpec[] {
  const { context } = host;
  return [
    {
      id: COMMANDS.insert,
      title: 'Penrose 다이어그램 삽입',
      summary: '예제 trio를 스코프와 멤버로 삽입합니다.',
      keys: ['p'],
      shortcutScope: 'canvas',
      run: async () => insertScope(host),
    },
    {
      id: COMMANDS.apply,
      title: 'Tri-DSL 적용',
      summary: 'Domain · Substance · Style을 다시 컴파일하고 수렴시킵니다.',
      run: async (params) => {
        const args = (params ?? {}) as ApplyArgs;
        const scopeId = requireScope(host, args.scopeId);
        return applySource(host, scopeId, {
          ...(args.domainDsl !== undefined ? { domainDsl: args.domainDsl } : {}),
          ...(args.substanceDsl !== undefined ? { substanceDsl: args.substanceDsl } : {}),
          ...(args.styleDsl !== undefined ? { styleDsl: args.styleDsl } : {}),
        });
      },
    },
    {
      id: COMMANDS.reset,
      title: '예제로 되돌리기',
      summary: '선택한 스코프의 trio를 기본 예제로 바꿉니다.',
      run: async () => {
        const scopeId = requireScope(host);
        return applySource(host, scopeId, DEFAULT_SOURCE, 'reset-example');
      },
    },
    {
      id: COMMANDS.reproject,
      title: '다시 수렴',
      summary: '현재 입력에서 최적화를 다시 돌립니다.',
      run: async () => reprojectScope(host, requireScope(host)),
    },
    {
      id: COMMANDS.resample,
      title: '변이 재표본',
      summary: 'variation 시드를 올려 초기 배치를 다시 뽑습니다.',
      run: async () => resampleScope(host, requireScope(host)),
    },
    {
      id: COMMANDS.pin,
      title: '핀 고정 / 해제',
      summary: '선택한 멤버의 최적화 입력을 고정하거나 풉니다.',
      run: () => {
        const { scopeId, ownerKey } = selectedOwner(host);
        togglePin(host, scopeId, ownerKey);
      },
    },
    {
      id: COMMANDS.bake,
      title: '벡터로 베이킹',
      summary: '수렴한 도형을 vector.path로 바꾸고 스코프를 제거합니다.',
      run: () => bakeScope(host, requireScope(host)),
    },
    {
      id: COMMANDS.openEditor,
      title: 'Tri-DSL 편집기',
      summary: 'Domain · Substance · Style 탭 편집기를 엽니다.',
      run: () => openPanel(host, PANELS.triEditor),
    },
    {
      id: COMMANDS.openDiagnostics,
      title: 'Penrose 진단',
      summary: '에너지, 단계, 경고와 수렴 입력을 보여 줍니다.',
      run: () => {
        const scopeId = scopeOfSelection(context);
        if (scopeId) select(context, scopeId);
        openPanel(host, PANELS.diagnostics);
      },
    },
  ];
}

/** Shape owner keys currently in the compiled scope (panel helper). */
export function ownersOf(world: { getComputed<T>(id: EntityId, aspect: string): T | undefined }, scopeId: EntityId): readonly string[] {
  return world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled)?.owners ?? [];
}

export type { JsonValue };
