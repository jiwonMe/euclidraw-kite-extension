import type { CanonicalPatchOp } from '../host.ts';
import { readScopeBox } from './frame.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, type PenroseMemberAspect } from './schema.ts';
import { type SolvedLayout } from './computed.ts';
import { COMPUTED } from '../manifest.ts';
import { commit, randomId, scopeMembers, type PenroseHost } from './documents.ts';
import type { Color, WireShape } from './wire.ts';

interface Contour {
  readonly vertices: readonly { x: number; y: number; inX: number; inY: number; outX: number; outY: number; mirroring: 'none' }[];
  readonly closed: boolean;
}

const rgba = (value: Color | undefined, fallback: string): string =>
  value ? `rgba(${Math.round(value[0] * 255)},${Math.round(value[1] * 255)},${Math.round(value[2] * 255)},${Math.round(value[3] * 1000) / 1000})` : fallback;

const vertex = (x: number, y: number) => ({ x, y, inX: x, inY: y, outX: x, outY: y, mirroring: 'none' as const });

function contoursOf(shape: WireShape, height: number): { contours: Contour[]; closed: boolean } | undefined {
  const flip = (x: number, y: number) => vertex(x, height - y);
  const props = shape.props;
  const vec = (value: unknown): [number, number] => Array.isArray(value) && value.length >= 2 ? [Number(value[0]) || 0, Number(value[1]) || 0] : [0, 0];
  switch (shape.shapeType) {
    case 'Circle': {
      const [cx, cy] = vec(props.center);
      const r = Math.max(0, Number(props.r) || 0);
      const vertices = Array.from({ length: 48 }, (_value, index) => {
        const angle = (index / 48) * Math.PI * 2;
        return flip(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      });
      return { contours: [{ vertices, closed: true }], closed: true };
    }
    case 'Ellipse': {
      const [cx, cy] = vec(props.center);
      const rx = Math.max(0, Number(props.rx) || 0), ry = Math.max(0, Number(props.ry) || 0);
      const vertices = Array.from({ length: 48 }, (_value, index) => {
        const angle = (index / 48) * Math.PI * 2;
        return flip(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
      });
      return { contours: [{ vertices, closed: true }], closed: true };
    }
    case 'Line': {
      const [sx, sy] = vec(props.start), [ex, ey] = vec(props.end);
      return { contours: [{ vertices: [flip(sx, sy), flip(ex, ey)], closed: false }], closed: false };
    }
    case 'Rectangle': {
      const [cx, cy] = vec(props.center);
      const w = Number(props.width) || 0, h = Number(props.height) || 0;
      const points: [number, number][] = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
      return { contours: [{ vertices: points.map(([x, y]) => flip(x, y)), closed: true }], closed: true };
    }
    case 'Polygon':
    case 'Polyline': {
      const points = (Array.isArray(props.points) ? props.points : []) as readonly (readonly number[])[];
      const vertices = points.map(point => flip(Number(point[0]) || 0, Number(point[1]) || 0));
      return { contours: [{ vertices, closed: shape.shapeType === 'Polygon' }], closed: shape.shapeType === 'Polygon' };
    }
    default:
      return undefined;
  }
}

/**
 * Replace the scope with `vector.path` entities. Text, Equation, Image, Path
 * and Group shapes are not representable and are reported as skipped.
 */
export function bakeScope(host: PenroseHost, scopeId: string): { created: number; skipped: number } {
  const { context } = host;
  const world = context.world;
  const scope = world.getCanonical<Record<string, unknown>>(scopeId, SCOPE_ASPECT);
  const layout = world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
  const box = readScopeBox(world.getCanonicalView(), scopeId);
  if (!scope || !layout || !box) throw new Error('Penrose 레이아웃이 아직 준비되지 않았습니다.');
  if (world.isEntityReadOnly(scopeId)) throw new Error('읽기 전용 Penrose 스코프입니다.');

  const ops: CanonicalPatchOp[] = [];
  let created = 0, skipped = 0;
  for (const shape of layout.shapes) {
    const contours = contoursOf(shape, layout.canvas.height);
    if (!contours) { skipped++; continue; }
    const id = randomId('ent_vector_penrose');
    const fill = rgba(shape.props.fillColor as Color | undefined, 'none');
    const stroke = rgba(shape.props.strokeColor as Color | undefined, 'none');
    ops.push({
      id,
      aspect: 'vector.path',
      patch: {
        contours: contours.contours,
        baseWidth: layout.canvas.width,
        baseHeight: layout.canvas.height,
        fill,
        fillOpacity: 1,
        stroke,
        strokeWidth: Number(shape.props.strokeWidth) || 0,
        strokeDash: 'solid',
        strokeCap: 'round',
        strokeJoin: 'round',
        fillRule: 'nonzero',
        arrowStart: false,
        arrowEnd: false,
      },
    });
    ops.push({ id, aspect: 'core.transform', patch: { x: box.x, y: box.y, rotation: box.rotation } });
    ops.push({ id, aspect: 'core.bounds', patch: { width: box.width, height: box.height } });
    created++;
  }
  if (!created) throw new Error('베이킹할 수 있는 도형이 없습니다(Text · Equation · Image · Path · Group은 지원하지 않음).');

  const members = { ...scopeMembers(world.getCanonicalView(), scopeId), ...((scope.entityBindings as Record<string, string> | undefined) ?? {}) };
  for (const id of Object.values(members)) {
    const member = world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
    if (member?.scopeId === scopeId) ops.push({ id, aspect: MEMBER_ASPECT, patch: null });
  }
  ops.push({ id: scopeId, aspect: MEMBER_ASPECT, patch: null });
  ops.push({ id: scopeId, aspect: SCOPE_ASPECT, patch: null });
  commit(context, 'bake-to-vector', ops);
  host.runtime.forget(scopeId);
  return { created, skipped };
}

export type { Contour };
