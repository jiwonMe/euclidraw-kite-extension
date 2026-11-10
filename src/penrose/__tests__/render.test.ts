import { describe, expect, it } from 'vitest';
import { renderScene, shapeBounds, ownerBounds, hitOwner } from '../render.ts';
import type { WireShape } from '../wire.ts';

const canvas = { width: 400, height: 300 };

const circle = (owner: string, x: number, y: number, r: number, extra: Partial<WireShape['props']> = {}): WireShape => ({
  shapeType: 'Circle',
  name: `${owner}.icon`,
  owner,
  props: {
    center: [x, y],
    r,
    fillColor: [0.145, 0.388, 0.921, 1],
    strokeColor: [0.117, 0.227, 0.541, 1],
    strokeWidth: 1,
    ...extra,
  },
  passthrough: {},
});

describe('penrose SVG renderer (no DOM)', () => {
  it('renders screen coordinates with a y flip and no external references', () => {
    const svg = renderScene([circle('A', 0, 0, 10)], { canvas });
    expect(svg).toContain('<circle cx="200" cy="150" r="10"');
    expect(svg).not.toMatch(/foreignObject|<script|url\(|javascript:/i);
  });

  it('escapes text and keeps math markup sanitised', () => {
    const text: WireShape = {
      shapeType: 'Text',
      name: 'A.tag',
      owner: 'A',
      props: { center: [0, 0], width: 80, height: 18, descent: 4, string: '<b>A</b> & "x"', fontSize: '14px' },
      passthrough: {},
    };
    const svg = renderScene([text], { canvas });
    expect(svg).toContain('&lt;b&gt;A&lt;/b&gt; &amp; &quot;x&quot;');
    const equation: WireShape = {
      shapeType: 'Equation',
      name: 'eq',
      owner: 'c',
      props: { center: [0, 0], width: 60, height: 20, string: 'x^2' },
      passthrough: {},
    };
    const withMath = renderScene([equation], { canvas, labels: { eq: '<svg viewBox="0 0 10 10"><script>alert(1)</script><path d="M0 0"/></svg>' } });
    expect(withMath).not.toContain('<script');
    expect(withMath).toContain('<path d="M0 0"');
  });

  it('draws line arrowheads as paths instead of url(#marker)', () => {
    const line: WireShape = {
      shapeType: 'Line',
      name: 's.icon',
      owner: 's',
      props: {
        start: [-100, 0], end: [100, 0], strokeWidth: 2,
        strokeColor: [0, 0, 0, 1], endArrowhead: 'straight', endArrowheadSize: 1,
      },
      passthrough: {},
    };
    const svg = renderScene([line], { canvas });
    expect(svg).toContain('<path d="M9.95 4.06');
    expect(svg).not.toContain('url(#');
  });

  it('computes owner bounds and hit distances in canvas coordinates', () => {
    const shapes = [circle('A', 0, 0, 10), circle('B', 100, 0, 5)];
    const bounds = ownerBounds(shapes);
    expect(bounds.A).toMatchObject({ x: -10.5, y: -10.5, width: 21, height: 21 });
    expect(hitOwner(shapes, 'A', 0, 0, 1)).toBeLessThan(0);
    expect(hitOwner(shapes, 'A', 200, 200, 1)).toBeGreaterThan(0);
    expect(shapeBounds(shapes[1]!)?.x).toBe(94.5);
  });

  it('writes complete arc commands (flags are not dropped)', () => {
    const path: WireShape = {
      shapeType: 'Path',
      name: 'arc',
      owner: 'e',
      props: {
        d: [
          { cmd: 'A', values: [{ kind: 'value', values: [5, 5, 0, 0, 1] }, { kind: 'coord', x: 10, y: 0 }] },
          { cmd: 'L', values: [{ kind: 'coord', x: 0, y: 10 }] },
        ],
      },
      passthrough: {},
    };
    const svg = renderScene([path], { canvas });
    // rx ry rotation large-arc sweep x y — seven values, then the next segment.
    expect(svg).toContain('d="A 5 5 0 0 1 210 150 L 200 140"');
  });

  it('renders identical output for identical input', () => {
    const shapes = [circle('A', 10, 20, 6), circle('B', -30, 40, 8)];
    expect(renderScene(shapes, { canvas })).toBe(renderScene(shapes, { canvas }));
  });
});
