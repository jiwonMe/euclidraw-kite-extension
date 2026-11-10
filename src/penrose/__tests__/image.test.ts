import { describe, expect, it } from 'vitest';
import { renderScene } from '../render.ts';
import type { WireShape } from '../wire.ts';

const canvas = { width: 200, height: 200 };

const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs><radialGradient id="shade"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs>
  <circle cx="50" cy="50" r="50" style="fill:url(#shade)"/>
</svg>`;

const image = (name: string, href: string, extra: Partial<WireShape['props']> = {}): WireShape => ({
  shapeType: 'Image',
  name,
  props: { center: [0, 0], width: 80, height: 80, href, ...extra },
  passthrough: {},
});

const render = (shapes: WireShape[]) => renderScene(shapes, { canvas, idPrefix: 'p' });

describe('image / gradient rendering', () => {
  it('inlines a base64 data URI and keeps its gradient definitions', () => {
    const href = `data:image/svg+xml;base64,${Buffer.from(gradientSvg).toString('base64')}`;
    const svg = render([image('a.shading', href)]);
    expect(svg).toContain('<radialGradient id="a_shading-shade"');
    expect(svg).toContain('url(#a_shading-shade)');
    expect(svg).toContain('width="80" height="80"');
    // The viewBox must survive or the artwork is not scaled to 80x80.
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('scopes ids per instance so two copies do not share one gradient', () => {
    const href = `data:image/svg+xml;base64,${Buffer.from(gradientSvg).toString('base64')}`;
    const svg = render([image('a.shading', href), image('b.shading', href)]);
    expect(svg).toContain('id="a_shading-shade"');
    expect(svg).toContain('id="b_shading-shade"');
    expect(svg.match(/id="a_shading-shade"/g)).toHaveLength(1);
    expect(svg.match(/id="b_shading-shade"/g)).toHaveLength(1);
  });

  it('resolves the bundled Penrose example assets by name', () => {
    const svg = render([image('bg', 'background.svg', { width: 200, height: 200, preserveAspectRatio: 'none' })]);
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('honours preserveAspectRatio and drops external references', () => {
    const href = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/x.png"/><rect width="10" height="10" fill="url(https://example.com/y)"/></svg>`,
    )}`;
    const svg = render([image('a', href)]);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).not.toContain('example.com');
    expect(svg).toContain('fill="none"');
  });

  it('passes a style through (blur) but not script or remote urls', () => {
    const group: WireShape = {
      shapeType: 'Group',
      name: 'shadows',
      props: {},
      passthrough: { style: 'filter:blur(5px);background:url(https://example.com/a.png)', opacity: 0.1 },
      children: [{ shapeType: 'Circle', name: 'c', props: { center: [0, 0], r: 5 }, passthrough: {} }],
    };
    const svg = render([group]);
    expect(svg).toContain('style="filter:blur(5px);background:none"');
    expect(svg).not.toContain('example.com');
  });
});
