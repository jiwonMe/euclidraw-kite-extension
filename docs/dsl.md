# Kite Tri-DSL 레퍼런스

한 스코프는 세 텍스트로 정의됩니다. 주석은 `#`(행 처음 또는 공백 뒤, `#hex` 색상 제외) 또는 `//`입니다.

| DSL | 담당 |
|---|---|
| Domain | 타입, 술어, 생성자 |
| Substance | 개체 선언과 논리적 구속 |
| Style | 시각 매핑, `param`, 소프트 구속 컴플라이언스 |

수식(좌표, 반지름, 거리, 스타일 값)은 `+ - * / ^`, 괄호, `sin cos tan sqrt abs deg rad min max pow`, `pi`, Style `param` 이름을 쓸 수 있고, 연료 제한 Wasm VM에서 평가됩니다. `deg(x)`/`rad(x)`는 모두 도→라디안입니다.

## Domain

```text
type Point shape point
type Segment shape segment
type Diameter extends Segment        # 상위 타입의 shape 상속
predicate On(Point, Circle) = OnCircle   # 기본 술어에 별칭 + 인자 타입 제한
predicate Tangent(Line, Circle)          # 이름이 기본 술어면 '=' 생략
constructor MidpointOf(Point, Point) -> Point = Midpoint
constructor PointOn(Circle) -> Point = OnCircle
```

- shape: `point segment line ray circle arc polygon angle-mark label-anchor`.
- 기본 술어: `Distance(P, P, n)`, `Coincident(P, P)`, `Midpoint(M, A, B)`, `OnCircle(P, c)`, `OnLine(P, l)`, `Perpendicular(l, l)`, `Parallel(l, l)`, `EqualLength(l, l)`, `Horizontal(l)`, `Vertical(l)`, `Tangent(l, c)`, `Radius(c, n)`, `AngleAt(V, A, B, deg)`, `Fixed(P)`. 선 인자는 segment·line·ray를 받습니다.
- `constructor`가 만든 개체는 기본 술어의 **첫 인자**가 되므로 입력은 (기본 술어 인자 수 − 1)개입니다.
- 술어 인자 타입은 미니버퍼 후보와 Space 2B 버튼에도 적용됩니다.

## Substance

### 개체

```text
canvas 520 380                          # 로컬 좌표계 크기(기본 520×380)
Point A = (120, 260) pin                # pin: 고정
Point F                                 # 좌표 생략: 솔버가 배치
Point O = MidpointOf(A, B)              # 생성자
Segment AB = A .. B                     # Line, Ray도 같은 형식
Circle c = center O through A           # 또는 center O r 100, 또는 center O
Arc a = center O r 40 from 200 to 340   # 도 단위
Polygon tri = A P B
Angle angP = A P B                      # 가운데가 꼭짓점; 90°면 직각 표시
Label l1 = "c" at center c normal 8
Label l2 = "AB" at midpoint AB offset (0, -14)
Label l3 = "∠APB = 90°" at bisector angP card
pin X / unpin X
```

라벨 앵커: `point P`, `center c|arc|polygon`, `midpoint 선`, `bisector 각`. 오프셋: `normal d`(앵커 법선 방향 거리) 또는 `offset (x, y)`. `card`는 `markdown.card` 멤버(수식 지원)로 만들며, 해당 확장이 없으면 SVG 텍스트로 그립니다.

### 구속

```text
Perpendicular(AP, PB)
soft EqualLength(AP, PB)     # 소프트: 컴플라이언스만큼 양보
Distance(A, Q, 120 * k)
On(Q, c)                     # Domain 별칭
```

## Style

```text
param k = 1 range(0.5, 3) step 0.1   # DialKit 슬라이더
point { r: 4.5 * k; fill: #2563eb; stroke: #ffffff; width: 1.5 }
segment, line, ray { stroke: #475569; width: 2 }
A, B { label: true }                 # 개체 이름 선택자
Point { ... }                        # Domain 타입 선택자
OQ { dash: 4 }
labThales { cardWidth: 128; cardHeight: 40 }
@soft { compliance: 0.002 }          # 모든 soft 구속
@EqualLength { compliance: 0.01 }    # 특정 술어
```

선택자 우선순위는 뒤에 오는 규칙이 이깁니다(shape → 타입 → id 순서가 아니라 선언 순서). 주요 속성: `r fill stroke width dash fillOpacity label labelColor labelBackground fontSize fontWeight radius square ticks arrows cardWidth cardHeight compliance`. 값은 문자열(`"..."`), `true/false`, 색상(`#hex`, 이름), 수식입니다.

## 진단

오류는 `{source, line, message}`로 Tri-DSL 편집기 줄에 표시됩니다. 오류가 있으면 적용을 거부하고, 원격 피어가 쓴 깨진 DSL은 스코프 위치에 오류 배지로 보입니다(멤버 기하는 숨김).

## 예제

새 스코프의 기본값은 [src/defaults.ts](../src/defaults.ts)의 탈레스 정리 예제입니다.
