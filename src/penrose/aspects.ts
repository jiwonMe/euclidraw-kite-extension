import type { AspectSpec, ComputedReadView, EntityId, UiControl } from '../host.ts';
import { COMMANDS, COMPUTED } from '../manifest.ts';
import { DEFAULT_SOLVER_CONFIG, MEMBER_ASPECT, SCOPE_ASPECT, type PenroseMemberAspect, type PenroseScopeAspect } from './schema.ts';
import { DEFAULT_SOURCE } from './defaults.ts';
import { frameFor, frameTransform, readScopeBox } from './frame.ts';
import { memberGeometry, memberHit, readScopeView, type CompiledScope, type MemberGeometry, type SolvedLayout } from './computed.ts';
import { renderScene } from './render.ts';

export interface ScopeDerived {
  x: number; y: number; width: number; height: number; rotation: number;
  /** Rendered SVG for the whole diagram, computed once per layout. */
  svg?: string;
  error?: string;
  pending?: boolean;
}

export type MemberDerived = MemberGeometry | { readonly error: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rotation: 0 };

const isGeometry = (value: MemberDerived | undefined): value is MemberGeometry => !!value && 'ownerKey' in value;

function badge(x: number, y: number, text: string): string {
  const width = Math.min(520, 24 + text.length * 7.2);
  return (
    `<g><rect x="${x}" y="${y - 22}" width="${width}" height="22" rx="4" fill="rgba(254,226,226,0.96)" stroke="#dc2626" stroke-width="1"/>` +
    `<text x="${x + 8}" y="${y - 7}" font="12px 'Helvetica Neue', Helvetica, Arial, sans-serif" fill="#991b1b">${escapeText(text)}</text></g>`
  );
}

/**
 * A quiet, centred status pill while the worker compiles. Static (no SMIL or
 * CSS animation) so screen and export stay byte-identical.
 */
function pendingIndicator(box: { x: number; y: number; width: number; height: number }): string {
  const width = Math.max(96, Math.min(124, box.width - 16));
  const height = 26;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const left = cx - width / 2;
  const top = cy - height / 2;
  const ringX = left + 18;
  const radius = 5.5;
  return (
    `<g data-penrose-pending="1" opacity="0.95">` +
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${height / 2}" ` +
    `fill="rgba(148,163,184,0.10)" stroke="rgba(148,163,184,0.32)" stroke-width="1"/>` +
    `<circle cx="${ringX}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(148,163,184,0.32)" stroke-width="2"/>` +
    `<path d="M${ringX} ${cy - radius} A${radius} ${radius} 0 0 1 ${ringX + radius} ${cy}" ` +
    `fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>` +
    `<text x="${left + 30}" y="${cy}" dominant-baseline="middle" ` +
    `font="11px 'Helvetica Neue', Helvetica, Arial, sans-serif" letter-spacing="0.2" fill="#94a3b8">컴파일 중</text>` +
    `</g>`
  );
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const RESAMPLE_ICON = {
  paths: ['M3 8a5 5 0 1 1 1.5 3.5', 'M3 4v4h4'],
} as const;

const REPROJECT_ICON = {
  paths: ['M8 2.5a5.5 5.5 0 1 1-5.2 7.3', 'M8 5.5v5M5.5 8h5'],
} as const;

export function scopeSpec(panels: NonNullable<AspectSpec<PenroseScopeAspect, ScopeDerived>['ui']>['panels']): AspectSpec<PenroseScopeAspect, ScopeDerived> {
  return {
    id: SCOPE_ASPECT,
    label: 'Penrose 스코프',
    summary: 'Domain · Substance · Style trio, 마지막 수렴 입력과 소유자 바인딩',
    defaults: {
      schemaVersion: 2,
      ...DEFAULT_SOURCE,
      variation: '0',
      topologyDigest: '',
      varyingValues: [],
      pins: [],
      entityBindings: {},
      solverConfig: { ...DEFAULT_SOLVER_CONFIG },
    },
    textFields: ['domainDsl', 'substanceDsl', 'styleDsl'],
    textSearchFields: ['substanceDsl'],
    dependsOnCanonical: [SCOPE_ASPECT, 'core.transform', 'core.bounds'],
    dependsOnComputed: [COMPUTED.compiled, COMPUTED.layout],
    renderMode: 'vector',
    derive(_props, id, view) {
      const box = readScopeBox(view, id);
      if (!box) return undefined;
      const compiled = view.getComputed<CompiledScope>(id, COMPUTED.compiled);
      if (compiled && !compiled.ok) {
        return { ...box, ...(compiled.pending ? { pending: true } : { error: compiled.error ?? 'DSL 오류' }) };
      }
      const layout = view.getComputed<SolvedLayout>(id, COMPUTED.layout);
      if (!layout) return { ...box, pending: true };
      const frame = frameFor(layout.canvas, box);
      const body = renderScene(layout.shapes, { canvas: layout.canvas, labels: layout.labels, idPrefix: id });
      // A nested <svg> viewport clips to the diagram canvas without url(#…)
      // references, so screen and export stay pure vector and deterministic.
      const clipped = `<svg x="0" y="0" width="${layout.canvas.width}" height="${layout.canvas.height}" overflow="hidden">${body}</svg>`;
      return { ...box, svg: `<g transform="${frameTransform(frame)}" data-penrose-scope="${escapeText(id)}">${clipped}</g>` };
    },
    renderSvg(_props, derived) {
      if (!derived) return { svg: '' };
      if (derived.error) return { svg: badge(derived.x, derived.y, `Penrose: ${derived.error}`.slice(0, 140)) };
      if (derived.pending && !derived.svg) return { svg: pendingIndicator(derived) };
      return { svg: derived.svg ?? '' };
    },
    selection: {
      priority: 5,
      getBounds(id, view, out) {
        const box = readScopeBox(view, id);
        if (!box) return false;
        out.x = box.x; out.y = box.y; out.width = box.width; out.height = box.height; out.rotation = box.rotation;
        return true;
      },
      hitTest(id, view, x, y) {
        const box = readScopeBox(view, id);
        if (!box) return Infinity;
        const inside = x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height;
        return inside ? 0 : Infinity;
      },
      intersectsRect(id, view, minX, minY, maxX, maxY) {
        const box = readScopeBox(view, id);
        if (!box) return false;
        return box.x <= maxX && box.y <= maxY && box.x + box.width >= minX && box.y + box.height >= minY;
      },
      canTransform: () => true,
    },
    ui: {
      panels,
      controls: [
        { id: 'penrose.scope.reproject', kind: 'action', label: '다시 수렴', placement: 'selection-bar', commandSymbol: COMMANDS.reproject, icon: REPROJECT_ICON, requiresSelection: true },
        { id: 'penrose.scope.resample', kind: 'action', label: '재표본', placement: 'selection-bar', commandSymbol: COMMANDS.resample, icon: RESAMPLE_ICON, requiresSelection: true },
        { id: 'penrose.scope.bake', kind: 'action', label: '벡터로 베이킹', placement: 'selection-bar', commandSymbol: COMMANDS.bake, requiresSelection: true },
      ] satisfies UiControl[],
    },
  };
}

export function memberSpec(): AspectSpec<PenroseMemberAspect, MemberDerived> {
  const derivedOf = (id: EntityId, view: ComputedReadView) => view.getComputed<MemberDerived>(id, COMPUTED.member);
  return {
    id: MEMBER_ASPECT,
    label: 'Penrose 멤버',
    summary: 'Penrose 객체 하나가 소유한 도형 묶음 — 선택과 연결선의 대상',
    defaults: { scopeId: '', ownerKey: '', pinned: false, label: '' },
    refs: { scopeId: 'cascade-hide' },
    textSearchFields: ['ownerKey', 'label'],
    layout: true,
    paintOverflow: 6,
    renderMode: 'vector',
    dependsOnCanonical: [MEMBER_ASPECT, SCOPE_ASPECT],
    dependsOnComputed: [COMPUTED.layout],
    derive(props, _id, view) {
      const scope = readScopeView(view, props.scopeId);
      if (!scope) return undefined;
      const geometry = memberGeometry(props, props.scopeId, view);
      if (geometry) return geometry;
      const box = readScopeBox(view, props.scopeId);
      if (!box) return undefined;
      return { error: `${props.ownerKey}: 레이아웃 준비 중`, x: box.x, y: box.y, width: 1, height: 1, rotation: 0 };
    },
    // The scope paints the whole diagram; members contribute selection only.
    renderSvg() {
      return { svg: '' };
    },
    selection: {
      priority: 20,
      getBounds(id, view, out) {
        const derived = derivedOf(id, view);
        if (!derived) return false;
        out.x = derived.x; out.y = derived.y; out.width = derived.width; out.height = derived.height; out.rotation = 0;
        return true;
      },
      hitTest(id, view, x, y, zoom) {
        const member = view.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
        if (!member) return Infinity;
        return memberHit(member, member.scopeId, view, x, y, zoom);
      },
      intersectsRect(id, view, minX, minY, maxX, maxY) {
        const derived = derivedOf(id, view);
        if (!derived) return false;
        return derived.x <= maxX && derived.y <= maxY && derived.x + derived.width >= minX && derived.y + derived.height >= minY;
      },
      getOutlinePath(id, view, projection) {
        const derived = derivedOf(id, view);
        if (!derived) return '';
        const out = { x: 0, y: 0 };
        const corners = [
          { x: derived.x, y: derived.y },
          { x: derived.x + derived.width, y: derived.y },
          { x: derived.x + derived.width, y: derived.y + derived.height },
          { x: derived.x, y: derived.y + derived.height },
        ];
        return corners.map((corner, index) => {
          projection.worldToScreen(corner.x, corner.y, out);
          return `${index ? 'L' : 'M'}${out.x} ${out.y}`;
        }).join('') + 'Z';
      },
      canTransform: () => false,
    },
    ui: {
      controls: [
        { id: 'penrose.member.pin', kind: 'action', label: '핀 고정 / 해제', placement: 'selection-bar', commandSymbol: COMMANDS.pin, requiresSelection: true },
      ] satisfies UiControl[],
    },
  };
}

export { isGeometry };
