/** The example a new scope starts from: Thales' theorem with live labels. */

export const DEFAULT_DOMAIN = `# Domain — 타입, 술어, 생성자
type Point shape point
type Segment shape segment
type Line shape line
type Ray shape ray
type Circle shape circle
type Arc shape arc
type Polygon shape polygon
type Angle shape angle-mark
type Label shape label-anchor

predicate On(Point, Circle) = OnCircle
predicate OnLine(Point, Line)
predicate Perpendicular(Segment, Segment)
predicate Parallel(Segment, Segment)
predicate EqualLength(Segment, Segment)
predicate Tangent(Line, Circle)
predicate Distance(Point, Point, Number)
predicate Fixed(Point)

# 생성자: 만들어진 개체가 기본 술어의 첫 인자가 됩니다.
constructor MidpointOf(Point, Point) -> Point = Midpoint
constructor PointOn(Circle) -> Point = OnCircle
`;

export const DEFAULT_SUBSTANCE = `# Substance — 개체와 논리적 구속
canvas 520 380

Point A = (120, 260) pin
Point B = (400, 260) pin
Point O = MidpointOf(A, B)
Circle c = center O through A
Point P = PointOn(c)
Point Q = (320, 90)

Segment AB = A .. B
Segment AP = A .. P
Segment PB = P .. B
Segment OQ = O .. Q
Polygon tri = A P B
Angle angP = A P B

Label labC = "c" at center c normal 8
Label labThales = "∠APB = 90°" at bisector angP card

On(Q, c)
`;

export const DEFAULT_STYLE = `# Style — 시각 매핑과 목적 함수
param k = 1 range(0.5, 3) step 0.1
param ink = 2 range(1, 6) step 0.5

point { r: 4.5 * k; fill: #2563eb; stroke: #ffffff; width: 1.5 }
segment, line, ray { stroke: #475569; width: ink }
circle { stroke: #94a3b8; width: ink * 0.8; dash: 0 }
polygon { stroke: none; fill: #6366f1; fillOpacity: 0.08 }
angle-mark { stroke: #f59e0b; width: 1.5; radius: 18 * k }
label-anchor { fill: #1e293b; fontSize: 15 * k }

A, B { label: true; fill: #1d4ed8 }
O { label: true; r: 3 * k; fill: #64748b }
P { label: true; fill: #dc2626; r: 5.5 * k }
Q { label: true; fill: #16a34a }
OQ { stroke: #16a34a; dash: 4 }
labThales { cardWidth: 128; cardHeight: 40 }

# @술어 규칙은 소프트 구속의 컴플라이언스(작을수록 단단함)를 정합니다.
@soft { compliance: 0.002 }
`;

export const DEFAULT_SCOPE_SIZE = Object.freeze({ width: 520, height: 380 });
