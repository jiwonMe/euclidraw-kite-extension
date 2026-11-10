import type { ComputedReadView, EntityId } from '../host.ts';
import type { WireBounds, WireCanvas } from './wire.ts';

export interface Box { x: number; y: number; width: number; height: number; rotation: number }

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function readScopeBox(view: Pick<ComputedReadView, 'getCanonical'>, scopeId: EntityId): Box | undefined {
  const transform = view.getCanonical<{ x?: number; y?: number; rotation?: number }>(scopeId, 'core.transform');
  const bounds = view.getCanonical<{ width?: number; height?: number }>(scopeId, 'core.bounds');
  if (!transform || !bounds) return undefined;
  return {
    x: finite(transform.x, 0),
    y: finite(transform.y, 0),
    rotation: finite(transform.rotation, 0),
    width: Math.max(1, finite(bounds.width, 520)),
    height: Math.max(1, finite(bounds.height, 380)),
  };
}

export interface Frame {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  readonly rotation: number;
  readonly canvas: WireCanvas;
}

export function frameFor(canvas: WireCanvas, box: Box): Frame {
  return {
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    scale: Math.max(1e-6, Math.min(box.width / canvas.width, box.height / canvas.height)),
    rotation: box.rotation,
    canvas,
  };
}

/** Canvas (screen-space, y down) → world. */
export function toWorld(frame: Frame, x: number, y: number): { x: number; y: number } {
  const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  const dx = (x - frame.canvas.width / 2) * frame.scale;
  const dy = (y - frame.canvas.height / 2) * frame.scale;
  return { x: frame.cx + dx * cos - dy * sin, y: frame.cy + dx * sin + dy * cos };
}

/** World → canvas (screen-space, y down). */
export function toCanvas(frame: Frame, x: number, y: number): { x: number; y: number } {
  const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  const dx = x - frame.cx, dy = y - frame.cy;
  return {
    x: frame.canvas.width / 2 + (dx * cos + dy * sin) / frame.scale,
    y: frame.canvas.height / 2 + (-dx * sin + dy * cos) / frame.scale,
  };
}

/** The `transform` attribute that maps the renderer's 0..w/0..h canvas to the scope box. */
export function frameTransform(frame: Frame): string {
  const degrees = (frame.rotation * 180) / Math.PI;
  return (
    `translate(${round(frame.cx)} ${round(frame.cy)}) ` +
    `rotate(${round(degrees)}) ` +
    `scale(${round(frame.scale)}) ` +
    `translate(${-round(frame.canvas.width / 2)} ${-round(frame.canvas.height / 2)})`
  );
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Canvas-space bounds (y up, Penrose) → world bounds. */
export function canvasBoundsToWorld(frame: Frame, bounds: WireBounds): WireBounds {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map(point => toWorld(frame, point.x + frame.canvas.width / 2, frame.canvas.height / 2 - point.y));
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(1e-3, Math.max(...xs) - minX), height: Math.max(1e-3, Math.max(...ys) - minY) };
}
