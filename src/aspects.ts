import type {
  AspectSpec, ComputedReadView, DerivedGeometry, EntityId, MemberProps, ScopeProps,
} from './types.ts';
import { COMMANDS, MEMBER_ASPECT_ID, SCOPE_ASPECT_ID } from './manifest.ts';
import { createScopeDefaults } from './defaults.ts';
import { compileCached, solveScope } from './solver/runtime.ts';
import {
  angleWithin, lineDistance, pointDistance, polygonContainment, projectMember, rayDistance,
  scopeBox, segmentDistance,
} from './geometry.ts';
import { escapeXml, memberSvg } from './render/member.ts';

export function deriveMember(props: Readonly<MemberProps>, _id: EntityId, view: ComputedReadView): DerivedGeometry | undefined {
  const scope = view.getCanonical<ScopeProps>(props.scopeId, SCOPE_ASPECT_ID);
  if (!scope) return undefined;
  const box = scopeBox(props.scopeId, view);
  if (!box) return undefined;
  const solved = solveScope(scope, view);
  if (!solved.compiled.ok) return undefined;
  return projectMember(solved.compiled, solved, box, props, solved.pins);
}

export const scopeAspect: AspectSpec<ScopeProps, { x: number; y: number; width: number; height: number; rotation: number }> = {
  id: SCOPE_ASPECT_ID,
  label: 'Kite 스코프',
  summary: 'Kite 다이어그램의 Domain · Substance · Style 정본과 수렴 시드를 보관합니다.',
  defaults: createScopeDefaults(),
  textFields: ['domainDsl', 'substanceDsl', 'styleDsl'],
  textSearchFields: ['substanceDsl'],
  dependsOnCanonical: [SCOPE_ASPECT_ID, 'core.transform', 'core.bounds'],
  dependsOnComputed: [],
  derive(_props, id, view) {
    const transform = view.getCanonical<{ x?: number; y?: number; rotation?: number }>(id, 'core.transform');
    const bounds = view.getCanonical<{ width?: number; height?: number }>(id, 'core.bounds');
    if (!transform || !bounds) return undefined;
    return { x: Number(transform.x) || 0, y: Number(transform.y) || 0, width: Math.max(1, Number(bounds.width) || 520), height: Math.max(1, Number(bounds.height) || 360), rotation: Number(transform.rotation) || 0 };
  },
  renderSvg(props, derived) {
    if (!derived) return { svg: '' };
    const compiled = compileCached(props);
    if (compiled.ok) return { svg: '' };
    const error = compiled.errors[0];
    const label = `Kite DSL 오류 · L${error?.line ?? 0}: ${error?.message ?? '알 수 없는 오류'}`;
    return { svg: `<g transform="translate(${derived.x},${derived.y})"><rect x="0" y="0" width="${Math.min(derived.width, 560)}" height="30" rx="6" fill="#fef2f2" stroke="#fca5a5"/><text x="10" y="19" font-family="system-ui,sans-serif" font-size="11" fill="#b91c1c">${escapeXml(label)}</text></g>` };
  },
};

export const memberAspect: AspectSpec<MemberProps, DerivedGeometry> = {
  id: MEMBER_ASPECT_ID,
  label: 'Kite 멤버',
  summary: '스코프 솔버가 계산한 점 · 선분 · 원 · 호 · 다각형 · 각도 · 라벨입니다.',
  defaults: {
    scopeId: '',
    substanceId: '',
    primitiveKind: 'point',
    pinnedDofs: [],
    slackWeight: 1,
  },
  refs: { scopeId: 'cascade-hide' },
  textFields: [],
  textSearchFields: ['substanceId'],
  dependsOnCanonical: [MEMBER_ASPECT_ID, SCOPE_ASPECT_ID, 'core.transform', 'core.bounds'],
  dependsOnComputed: [],
  layout: true,
  paintOverflow: 8,
  derive: deriveMember,
  renderSvg(_props, derived) {
    if (!derived) return { svg: '' };
    return { svg: memberSvg(derived) };
  },
  selection: {
    getBounds(id, view, out) {
      const geometry = view.getComputed<DerivedGeometry>(id, `computed.${MEMBER_ASPECT_ID}`);
      if (!geometry) return false;
      out.x = geometry.x; out.y = geometry.y; out.width = geometry.width; out.height = geometry.height; out.rotation = 0;
      return true;
    },
    hitTest(id, view, x, y, zoom) {
      const geometry = view.getComputed<DerivedGeometry>(id, `computed.${MEMBER_ASPECT_ID}`);
      if (!geometry) return Infinity;
      if (x < geometry.x - 4 / zoom || y < geometry.y - 4 / zoom || x > geometry.x + geometry.width + 4 / zoom || y > geometry.y + geometry.height + 4 / zoom) return Infinity;
      const point = { x, y };
      switch (geometry.kind) {
        case 'point': {
          const center = geometry.points[0];
          if (!center) return Infinity;
          const radius = typeof geometry.style.r === 'number' ? geometry.style.r : 4.5;
          return Math.max(0, pointDistance(point, center) - radius);
        }
        case 'segment':
          return geometry.points[0] && geometry.points[1] ? segmentDistance(point, geometry.points[0], geometry.points[1]) : Infinity;
        case 'ray':
          return geometry.points[0] && geometry.points[1] ? rayDistance(point, geometry.points[0], geometry.points[1]) : Infinity;
        case 'line':
          return geometry.points[0] && geometry.points[1] ? lineDistance(point, geometry.points[0], geometry.points[1]) : Infinity;
        case 'circle': {
          if (!geometry.center) return Infinity;
          return Math.abs(pointDistance(point, geometry.center) - (geometry.radius ?? 0));
        }
        case 'arc': {
          if (!geometry.center) return Infinity;
          const angle = Math.atan2(y - geometry.center.y, x - geometry.center.x);
          if (angleWithin(angle, geometry.startAngle ?? 0, geometry.endAngle ?? Math.PI)) {
            return Math.abs(pointDistance(point, geometry.center) - (geometry.radius ?? 0));
          }
          const [a, b] = geometry.points;
          return Math.min(a ? pointDistance(point, a) : Infinity, b ? pointDistance(point, b) : Infinity);
        }
        case 'polygon': {
          if (geometry.points.length < 2) return Infinity;
          if (polygonContainment(point, geometry.points)) return 0;
          let distance = Infinity;
          for (let index = 0; index < geometry.points.length; index++) {
            distance = Math.min(distance, segmentDistance(point, geometry.points[index]!, geometry.points[(index + 1) % geometry.points.length]!));
          }
          return distance;
        }
        case 'angle-mark': {
          const vertex = geometry.points[1];
          if (!vertex) return Infinity;
          if (geometry.radius && geometry.radius > 0) {
            const angle = Math.atan2(y - vertex.y, x - vertex.x);
            if (angleWithin(angle, geometry.startAngle ?? 0, geometry.endAngle ?? Math.PI)) {
              return Math.abs(pointDistance(point, vertex) - geometry.radius);
            }
          }
          return pointDistance(point, vertex);
        }
        case 'label-anchor':
          return geometry.textX !== undefined && geometry.textY !== undefined ? pointDistance(point, { x: geometry.textX, y: geometry.textY }) : Infinity;
      }
    },
    intersectsRect(id, view, minX, minY, maxX, maxY) {
      const geometry = view.getComputed<DerivedGeometry>(id, `computed.${MEMBER_ASPECT_ID}`);
      return !!geometry && geometry.x <= maxX && geometry.y <= maxY && geometry.x + geometry.width >= minX && geometry.y + geometry.height >= minY;
    },
    canTransform: () => false,
  },
  ui: {
    controls: [
      { id: `${MEMBER_ASPECT_ID}.add-constraint`, kind: 'action', label: 'Kite 구속 추가', placement: 'selection-bar', commandSymbol: COMMANDS.addConstraint, requiresSelection: true },
      { id: `${MEMBER_ASPECT_ID}.reproject`, kind: 'action', label: 'Kite 다시 수렴', placement: 'selection-bar', commandSymbol: COMMANDS.reproject, requiresSelection: true },
    ],
  },
};
