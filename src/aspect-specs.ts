import type { AspectSpec, ComputedReadView, EntityId } from './host.ts';
import type { CompiledScope } from './dsl/compile.ts';
import type { SolvedGeometry } from './computed-bridge.ts';
import { hitDistance, memberGeometry, readScopeBox, toWorld, type MemberGeometry } from './geometry.ts';
import { COMMANDS, COMPUTED } from './manifest.ts';
import { memberSvg, placeholderSvg } from './render/space1-renderer.ts';
import { DEFAULT_SOLVER_CONFIG, MEMBER_ASPECT, SCOPE_ASPECT, type KiteMemberAspect, type KiteScopeAspect } from './schema.ts';
import { DEFAULT_DOMAIN, DEFAULT_STYLE, DEFAULT_SUBSTANCE } from './defaults.ts';

/**
 * PRD §3.2. The scope owns `core.transform`/`core.bounds`; members own only
 * `kite.member` + `core.stacking` and derive their geometry (and with
 * `layout: true`, `computed.layoutBounds`) from the scope's solved state.
 */

export interface ScopeDerived { x: number; y: number; width: number; height: number; rotation: number; error?: string }
export type MemberDerived = MemberGeometry | { readonly error: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rotation: 0 };

const isGeometry = (value: MemberDerived | undefined): value is MemberGeometry => !!value && 'kind' in value;

export function scopeSpec(panels: NonNullable<AspectSpec<KiteScopeAspect, ScopeDerived>['ui']>['panels']): AspectSpec<KiteScopeAspect, ScopeDerived> {
  return {
    id: SCOPE_ASPECT,
    label: 'Kite 스코프',
    summary: 'Domain · Substance · Style DSL, 엔티티 바인딩, 마지막 수렴 시드와 솔버 설정',
    defaults: {
      schemaVersion: 1,
      domainDsl: DEFAULT_DOMAIN,
      substanceDsl: DEFAULT_SUBSTANCE,
      styleDsl: DEFAULT_STYLE,
      entityBindings: {},
      convergedSeeds: {},
      solverConfig: { ...DEFAULT_SOLVER_CONFIG },
    },
    textFields: ['domainDsl', 'substanceDsl', 'styleDsl'],
    textSearchFields: ['substanceDsl'],
    dependsOnCanonical: [SCOPE_ASPECT, 'core.transform', 'core.bounds'],
    dependsOnComputed: [COMPUTED.compiledVm],
    renderMode: 'vector',
    derive(_props, id, view) {
      const box = readScopeBox(view, id);
      if (!box) return undefined;
      const compiled = view.getComputed<CompiledScope>(id, COMPUTED.compiledVm);
      const first = compiled?.diagnostics[0];
      return { ...box, ...(first ? { error: `L${first.line} ${first.source}: ${first.message}` } : {}) };
    },
    // The frame paints nothing; only a DSL error badge so a broken scope is visible.
    renderSvg(_props, derived) {
      if (!derived?.error) return { svg: '' };
      return { svg: placeholderSvg(derived.x, derived.y - 26, `Kite: ${derived.error}`.slice(0, 160)) };
    },
    ui: {
      panels,
      controls: [
        { id: 'kite.scope.open-editor', kind: 'action', label: 'Tri-DSL 편집기', placement: 'selection-bar', commandSymbol: COMMANDS.openEditor, requiresSelection: true },
        { id: 'kite.scope.bake', kind: 'action', label: '벡터로 베이킹', placement: 'selection-bar', commandSymbol: COMMANDS.bake, requiresSelection: true },
      ],
    },
  };
}

export function memberSpec(): AspectSpec<KiteMemberAspect, MemberDerived> {
  const derivedOf = (id: EntityId, view: ComputedReadView) => view.getComputed<MemberDerived>(id, COMPUTED.member);
  return {
    id: MEMBER_ASPECT,
    label: 'Kite 멤버',
    summary: '스코프 솔버가 배치하는 점 · 선분 · 직선 · 반직선 · 원 · 호 · 다각형 · 각도 · 라벨',
    defaults: { scopeId: '', substanceId: '', primitiveKind: 'point', pinnedDofs: [], slackWeight: 1 },
    refs: { scopeId: 'cascade-hide' },
    textSearchFields: ['substanceId'],
    layout: true,
    paintOverflow: 6,
    renderMode: 'vector',
    dependsOnCanonical: [MEMBER_ASPECT, SCOPE_ASPECT],
    dependsOnComputed: [COMPUTED.solvedGeometry, COMPUTED.compiledVm],
    derive(props, _id, view) {
      const scope = view.getCanonical<KiteScopeAspect>(props.scopeId, SCOPE_ASPECT);
      if (!scope) return undefined;
      const compiled = view.getComputed<CompiledScope>(props.scopeId, COMPUTED.compiledVm);
      const solved = view.getComputed<SolvedGeometry>(props.scopeId, COMPUTED.solvedGeometry);
      const box = readScopeBox(view, props.scopeId);
      if (!compiled || !solved || !box) {
        if (!box) return undefined;
        const error = compiled && !compiled.ok ? 'DSL 오류' : 'Kite 솔버 준비 중';
        return { error, x: box.x, y: box.y, width: 1, height: 1, rotation: 0 };
      }
      return memberGeometry(compiled, solved, props.scopeId, props.substanceId, props.pinnedDofs) ?? { error: `${props.substanceId}: Substance에 없는 개체`, x: box.x, y: box.y, width: 1, height: 1, rotation: 0 };
    },
    renderSvg(_props, derived) {
      if (!derived || !isGeometry(derived)) return { svg: '' };
      return { svg: memberSvg(derived) };
    },
    selection: {
      // Above plain boxes so a member wins over the scope frame under it.
      priority: 20,
      getBounds(id, view, out) {
        const derived = derivedOf(id, view);
        if (!isGeometry(derived)) return false;
        out.x = derived.x; out.y = derived.y; out.width = derived.width; out.height = derived.height; out.rotation = 0;
        return true;
      },
      hitTest(id, view, x, y, zoom) {
        const derived = derivedOf(id, view);
        if (!isGeometry(derived)) return Infinity;
        const slop = 4 / Math.max(zoom, 1e-3);
        if (x < derived.x - slop || y < derived.y - slop || x > derived.x + derived.width + slop || y > derived.y + derived.height + slop) return Infinity;
        return hitDistance(derived, { x, y });
      },
      intersectsRect(id, view, minX, minY, maxX, maxY) {
        const derived = derivedOf(id, view);
        if (!isGeometry(derived)) return false;
        if (derived.kind === 'point') { const p = derived.points[0]!; return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY; }
        return derived.x <= maxX && derived.y <= maxY && derived.x + derived.width >= minX && derived.y + derived.height >= minY;
      },
      getOutlinePath(id, view, projection) {
        const derived = derivedOf(id, view);
        if (!isGeometry(derived)) return '';
        const out = { x: 0, y: 0 };
        const screen = (p: { x: number; y: number }) => { projection.worldToScreen(p.x, p.y, out); return `${out.x} ${out.y}`; };
        if (derived.kind === 'segment' || derived.kind === 'line' || derived.kind === 'ray') return `M${screen(derived.points[0]!)}L${screen(derived.points[1]!)}`;
        if (derived.kind === 'polygon') return derived.points.map((point, index) => `${index ? 'L' : 'M'}${screen(point)}`).join('') + 'Z';
        if (derived.kind === 'circle') {
          const c = derived.points[0]!; let d = '';
          for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2; d += `${k ? 'L' : 'M'}${screen({ x: c.x + Math.cos(a) * derived.radius, y: c.y + Math.sin(a) * derived.radius })}`; }
          return d;
        }
        return `M${screen({ x: derived.x, y: derived.y })}L${screen({ x: derived.x + derived.width, y: derived.y })}L${screen({ x: derived.x + derived.width, y: derived.y + derived.height })}L${screen({ x: derived.x, y: derived.y + derived.height })}Z`;
      },
      // The default translate gizmo would move a box the solver owns. Members
      // are moved by the kite-manipulate handler instead (PRD §7.1).
      canTransform: () => false,
    },
    ui: {
      controls: [
        { id: 'kite.member.constrain', kind: 'action', label: '구속 추가', placement: 'selection-bar', commandSymbol: COMMANDS.constrain, requiresSelection: true },
        { id: 'kite.member.pin', kind: 'action', label: '핀 고정 / 해제', placement: 'selection-bar', commandSymbol: COMMANDS.pin, requiresSelection: true },
        { id: 'kite.member.slack', kind: 'slider', field: 'slackWeight', label: '드래그 저항', placement: 'inspector', min: 0.1, max: 10, step: 0.1 },
      ],
    },
  };
}

/** World position of a member's DOF handle (point or radius knob). */
export function handleWorld(compiled: CompiledScope, solved: SolvedGeometry, substanceId: string): { x: number; y: number } | undefined {
  const slot = compiled.dofs.find(entry => entry.substanceId === substanceId);
  if (!slot) return undefined;
  if (slot.kind === 'point') return toWorld(solved.frame, solved.dofs[slot.off]!, solved.dofs[slot.off + 1]!);
  const instance = compiled.instances[substanceId]!;
  const centre = compiled.dofs.find(entry => entry.substanceId === instance.center);
  if (!centre) return undefined;
  return toWorld(solved.frame, solved.dofs[centre.off]! + solved.dofs[slot.off]!, solved.dofs[centre.off + 1]!);
}

export { isGeometry };
