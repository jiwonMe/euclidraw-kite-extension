import { describe, expect, it } from 'vitest';
import { compileSession, layoutOf } from '../engine/core.ts';
import { renderScene } from '../render.ts';

const source = {
  digest: 'group-wire',
  domain: 'type Node',
  substance: 'Node n',
  style: `canvas {
  width = 100
  height = 100
}
forall Node n {
  n.clipShape = Rectangle {
    center: (0,0)
    width: 40
    height: 40
    fillColor: none()
  }
  n.dot = Circle {
    center: (0,0)
    r: 10
    fillColor: #93c697
  }
  n.group = Group {
    shapes: [n.dot]
    clipPath: clip(n.clipShape)
  }
}`,
  variation: '0',
};

describe('group wire format', () => {
  it('keeps a group\'s children and its clip shape', async () => {
    const session = await compileSession(source as never);
    const layout = layoutOf(session);
    const group = layout.shapes.find(shape => shape.shapeType === 'Group');
    expect(group).toBeTruthy();
    // Penrose stores the members in a ShapeListV value, not a plain array.
    expect(group!.children?.map(child => child.name)).toEqual(['`n`.dot']);
    expect(group!.clip?.map(child => child.name)).toEqual(['`n`.clipShape']);
  });

  it('renders the children inside the clip path', () => {
    const svg = renderScene([{
      shapeType: 'Group',
      name: 'g',
      props: {},
      passthrough: {},
      children: [{
        shapeType: 'Circle', name: 'dot', props: { center: [0, 0], r: 10, fillColor: [0.58, 0.78, 0.59, 1] }, passthrough: {},
      }],
      clip: [{
        shapeType: 'Rectangle', name: 'clip', props: { center: [0, 0], width: 40, height: 40 }, passthrough: {},
      }],
    }], { canvas: { width: 100, height: 100 } });
    expect(svg).toContain('<clipPath id="penrose-g-clip">');
    expect(svg).toContain('clip-path="url(#penrose-g-clip)"');
    expect(svg).toContain('<circle');
  });
});
