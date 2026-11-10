import { describe, expect, it } from 'vitest';
import { compileSession, layoutOf } from '../engine/core.ts';
import { renderScene } from '../render.ts';

const source = {
  digest: 'equation-label',
  domain: 'type Node',
  substance: 'Node n\nLabel n $x_0$',
  style: 'canvas {\n  width = 100\n  height = 100\n}\nforall Node n where n has label {\n  n.equation = Equation {\n    string: n.label\n    center: (0,0)\n  }\n}',
  variation: '0',
};

describe('equation labels', () => {
  it('stores the MathJax drawing, not its mjx-container wrapper', async () => {
    const session = await compileSession(source as never);
    const layout = layoutOf(session);
    const markup = layout.labels['`n`.equation'];
    expect(markup).toBeTruthy();
    expect(markup!.startsWith('<svg')).toBe(true);
    expect(markup).not.toContain('mjx-container');
    // The label is measured through the same DOM-free path.
    const equation = layout.shapes.find(shape => shape.shapeType === 'Equation');
    expect(equation?.props.width).toBeGreaterThan(0);
    expect(equation?.props.height).toBeGreaterThan(0);
  });

  it('paints the glyphs with the shape fill colour', () => {
    const markup = '<svg viewBox="0 0 10 10"><g stroke="currentColor" fill="currentColor"><path d="M0 0"/></g></svg>';
    const svg = renderScene([{
      shapeType: 'Equation',
      name: 'eq',
      owner: 'a',
      props: { center: [0, 0], width: 10, height: 10, fillColor: [0.5, 0.2, 0.1, 1] },
      passthrough: { fontStyle: 'italic' },
    }], { canvas: { width: 100, height: 100 }, labels: { eq: markup } });
    // MathJax paints with currentColor, so the CSS colour must carry the fill.
    expect(svg).toContain('color="rgba(128,51,26,1)"');
    expect(svg).toContain('font-style="italic"');
  });

  it('strips a legacy mjx-container wrapper at render time', () => {
    const svg = renderScene([{
      shapeType: 'Equation',
      name: 'eq',
      owner: 'a',
      props: { center: [0, 0], width: 10, height: 10 },
      passthrough: {},
    }], {
      canvas: { width: 100, height: 100 },
      labels: { eq: '<mjx-container class="MathJax"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></mjx-container>' },
    });
    expect(svg).not.toContain('mjx-container');
    expect(svg).toContain('<path d="M0 0"');
  });
});
