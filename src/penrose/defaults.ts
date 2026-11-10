/** The example trio inserted by `penrose.studio:insert-scope`. */
export const DEFAULT_DOMAIN = `type Point
type Circle
`;

export const DEFAULT_SUBSTANCE = `Point A
Point B
Point C
Circle c
`;

export const DEFAULT_STYLE = `canvas {
  width = 520
  height = 380
}

forall Point p {
  p.icon = Circle {
    r: 6
    fillColor: #2563eb
    strokeColor: #1e3a8a
    strokeWidth: 1
  }
}

forall Circle c {
  c.icon = Circle {
    r: 96
    fillColor: #00000000
    strokeColor: #64748b
    strokeWidth: 2
  }
  c.equation = Equation {
    string: "x^2 + y^2 = r^2"
    center: (0, 150)
    fontSize: "16px"
  }
  c.title = Text {
    string: "Penrose × alid"
    center: (0, -164)
    fontSize: "15px"
    fillColor: #334155
  }
}
`;

export const DEFAULT_SOURCE = Object.freeze({
  domainDsl: DEFAULT_DOMAIN,
  substanceDsl: DEFAULT_SUBSTANCE,
  styleDsl: DEFAULT_STYLE,
});

export const DEFAULT_SCOPE_SIZE = Object.freeze({ width: 520, height: 380 });
