import type { CanonicalPatchOp, EntityId } from '../host.ts';
import { arcCubics, type MemberGeometry, type Point } from '../geometry.ts';
import { color } from '../render/space1-renderer.ts';

/**
 * PRD §7.3 `kite: bake-to-vector`: convert the converged geometry into plain
 * `vector.path` (and `markdown.card` for labels) entities with no solver
 * dependency. Coordinates are written in each path's own local frame so the
 * path is an ordinary, editable vector object.
 */

interface Vertex { x: number; y: number; inX: number; inY: number; outX: number; outY: number; mirroring: 'none' }
interface Contour { vertices: Vertex[]; closed: boolean }

const vertex = (x: number, y: number): Vertex => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0, mirroring: 'none' });

function cubicsToContour(cubics: ReturnType<typeof arcCubics>, closed: boolean): Contour {
  const vertices: Vertex[] = [];
  cubics.forEach((cubic, index) => {
    if (index === 0) vertices.push({ ...vertex(cubic.p0.x, cubic.p0.y), outX: cubic.c1.x - cubic.p0.x, outY: cubic.c1.y - cubic.p0.y });
    else vertices[vertices.length - 1] = { ...vertices[vertices.length - 1]!, outX: cubic.c1.x - cubic.p0.x, outY: cubic.c1.y - cubic.p0.y };
    if (closed && index === cubics.length - 1) vertices[0] = { ...vertices[0]!, inX: cubic.c2.x - cubic.p3.x, inY: cubic.c2.y - cubic.p3.y };
    else vertices.push({ ...vertex(cubic.p3.x, cubic.p3.y), inX: cubic.c2.x - cubic.p3.x, inY: cubic.c2.y - cubic.p3.y });
  });
  return { vertices, closed };
}

/** World-space contours of one member, or undefined when it paints no path. */
export function contoursOf(geometry: MemberGeometry): { contours: Contour[]; filled: boolean } | undefined {
  const p = geometry.points;
  switch (geometry.kind) {
    case 'point': {
      const r = Number(geometry.style.r) > 0 ? Number(geometry.style.r) : 4.5;
      return { contours: [cubicsToContour(arcCubics(p[0]!, r, 0, Math.PI * 2), true)], filled: true };
    }
    case 'segment': case 'line': case 'ray':
      return { contours: [{ vertices: [vertex(p[0]!.x, p[0]!.y), vertex(p[1]!.x, p[1]!.y)], closed: false }], filled: false };
    case 'circle':
      return { contours: [cubicsToContour(arcCubics(p[0]!, geometry.radius, 0, Math.PI * 2), true)], filled: geometry.style.fill !== undefined && geometry.style.fill !== 'none' };
    case 'arc':
      return { contours: [cubicsToContour(arcCubics(p[0]!, geometry.radius, geometry.start, geometry.end), false)], filled: false };
    case 'polygon':
      return { contours: [{ vertices: p.map(point => vertex(point.x, point.y)), closed: true }], filled: geometry.style.fill !== undefined && geometry.style.fill !== 'none' };
    case 'angle-mark': {
      const square = geometry.squares[0];
      if (square) {
        const s = Math.min(geometry.radius * 0.6, 10);
        const a: Point = { x: square.o.x + square.u.x * s, y: square.o.y + square.u.y * s };
        const b: Point = { x: a.x + square.v.x * s, y: a.y + square.v.y * s };
        const c: Point = { x: square.o.x + square.v.x * s, y: square.o.y + square.v.y * s };
        return { contours: [{ vertices: [vertex(a.x, a.y), vertex(b.x, b.y), vertex(c.x, c.y)], closed: false }], filled: false };
      }
      return { contours: [cubicsToContour(arcCubics(p[0]!, geometry.radius, geometry.start, geometry.end), false)], filled: false };
    }
    case 'label-anchor':
      return undefined;
  }
}

export interface BakeOptions {
  readonly newId: (prefix: string) => EntityId;
  readonly stackingKey: (index: number) => string;
  readonly hasVectorPath: boolean;
  readonly hasMarkdownCard: boolean;
}

/** Ops that create the baked entities. The caller deletes the scope in the same batch. */
export function bakeOps(members: readonly { entityId: EntityId; geometry: MemberGeometry; card?: { x: number; y: number; width: number; height: number; body: string } }[], options: BakeOptions): { ops: CanonicalPatchOp[]; created: EntityId[] } {
  const ops: CanonicalPatchOp[] = [];
  const created: EntityId[] = [];
  let index = 0;
  for (const { geometry, card } of members) {
    const text = geometry.text && geometry.textAt ? { text: geometry.text, at: geometry.textAt } : undefined;
    const shape = options.hasVectorPath ? contoursOf(geometry) : undefined;
    if (shape) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const contour of shape.contours) for (const v of contour.vertices) {
        for (const [x, y] of [[v.x, v.y], [v.x + v.inX, v.y + v.inY], [v.x + v.outX, v.y + v.outY]] as const) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      }
      const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
      const local = shape.contours.map(contour => ({ closed: contour.closed, vertices: contour.vertices.map(v => ({ ...v, x: v.x - minX, y: v.y - minY })) }));
      const id = options.newId('ent_kite_baked');
      const style = geometry.style;
      const stroke = geometry.kind === 'point' ? color(style.stroke, '#ffffff') : color(style.stroke, '#475569');
      const fill = shape.filled ? color(style.fill, geometry.kind === 'point' ? '#2563eb' : 'none') : 'none';
      const dash = Number(style.dash) > 0 ? 'dashed' : 'solid';
      ops.push(
        { id, aspect: 'core.transform', patch: { x: minX, y: minY, rotation: 0 } },
        { id, aspect: 'core.bounds', patch: { width, height } },
        { id, aspect: 'core.stacking', patch: { order: options.stackingKey(index++) } },
        { id, aspect: 'vector.path', patch: { contours: local, baseWidth: width, baseHeight: height, stroke, strokeWidth: Number(style.width) >= 0 ? Number(style.width) : 2, strokeDash: dash, strokeCap: 'round', strokeJoin: 'round', fill, fillOpacity: Number(style.fillOpacity) >= 0 ? Number(style.fillOpacity) : 1, fillRule: 'nonzero', arrowStart: geometry.kind === 'line', arrowEnd: geometry.kind === 'line' || geometry.kind === 'ray' } },
      );
      created.push(id);
    }
    if (options.hasMarkdownCard && (card || (text && (geometry.kind === 'label-anchor' || geometry.text)))) {
      const id = options.newId('ent_kite_label');
      const body = card?.body ?? text!.text;
      const width = card?.width ?? Math.max(32, body.length * geometry.fontSize * 0.62 + 16), height = card?.height ?? geometry.fontSize * 2 + 8;
      const x = card?.x ?? text!.at.x - width / 2, y = card?.y ?? text!.at.y - height / 2;
      ops.push(
        { id, aspect: 'core.transform', patch: { x, y, rotation: 0 } },
        { id, aspect: 'core.bounds', patch: { width, height } },
        { id, aspect: 'core.stacking', patch: { order: options.stackingKey(index++) } },
        { id, aspect: 'markdown.card', patch: { body, color: 'white' } },
      );
      created.push(id);
    }
  }
  return { ops, created };
}
