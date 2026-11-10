# Kite Tri-DSL 레퍼런스

Kite Studio는 세 개의 텍스트 소스를 한 스코프 안에 저장합니다.

| 탭 | 역할 | 정본 필드 |
| --- | --- | --- |
| **Domain** | 타입과 predicate 시그니처 | `kite.scope.domainDsl` |
| **Substance** | 기하 개체 선언과 논리 구속 | `kite.scope.substanceDsl` |
| **Style** | 시각 매핑 규칙 | `kite.scope.styleDsl` |

모든 소스는 줄 단위이며 `#` 또는 `//`로 시작하는 줄은 주석입니다. 문장 끝 `// 주석`도 허용합니다. 좌표계는 스코프 로컬 픽셀(`0..width`, `0..height`)이고, 스코프의 `core.transform` 회전·이동은 렌더 단계에서 적용됩니다.

---

## Domain

```text
type Point shape point
type Segment shape segment
type Circle shape circle
predicate OnCircle(Point, Circle)
predicate Perpendicular(Segment, Segment)
```

- `type <Name> shape <primitive>`
  - primitive: `point`, `segment`, `line`, `ray`, `circle`, `arc`, `polygon`, `angle-mark`, `label-anchor`
  - `type Foo extends Bar`로 부모의 shape를 상속할 수 있습니다.
- `predicate <Name>(<Type>, ...)`
  - 인자 개수 검증에 사용합니다. 실행 가능한 predicate는 아래 내장 목록뿐입니다.
  - 내장 목록에 없는 predicate는 컴파일 오류로 표시됩니다. 사용자 정의 술어를 임의 코드로 평가하지 않습니다.

---

## Substance

### 개체 선언

```text
Point A = (80, 240) pin
Point B = (260, 240)
Point P = (297, 150)

Segment AB = A .. B
Line l1 = A .. B
Ray r1 = A .. B

Circle c1 = center M r 127
Circle c2 = center A through B

Arc arc1 = center A r 90 from 0 to 180
Polygon poly = A B C
Angle angB = A B C
```

| 선언 | 의미 |
| --- | --- |
| `Point A = (x, y)` | 자유 점. 뒤에 `pin`을 붙이면 두 DOF를 고정합니다. |
| `Segment AB = A .. B` | 두 점을 잇는 선분. |
| `Line l = A .. B` | 두 점을 지나는 무한 직선. 스코프 박스로 클리핑해 렌더링합니다. |
| `Ray r = A .. B` | A에서 B 방향으로 뻗는 반직선. |
| `Circle c = center M r 127` | 점 M을 중심으로 하는 원. 반지름은 DOF입니다. |
| `Circle c = center M through B` | B를 지나는 원. `OnCircle(B, c)`가 자동 추가됩니다. |
| `Arc a = center M r 90 from 0 to 180` | 중심·반지름·시작/끝 각도(도)를 가진 호. 각도는 고정입니다. |
| `Polygon p = A B C` | 세 점 이상의 다각형. |
| `Angle a = A B C` | 꼭짓점 B에서 A·C 사이의 각도 표기. |
| `Label l = "텍스트" at <anchor> offset <값>` | 라벨. 아래 참고. |

#### 라벨

```text
Label labC = "c₁" at center c1 offset (0, 16)
Label labP = "P" at point P offset (10, -10)
Label labAB = "AB" at midpoint AB offset 14
```

- anchor: `point <id>` · `center <id>` (원/호/다각형) · `midpoint <선분>`
- offset: `(dx, dy)`는 벡터, 숫자 하나는 앵커 방향의 법선 거리입니다.
- 텍스트는 SVG `<text>`로 이스케이프되어 출력됩니다. 현재 MathJax/TeX 조판은 지원하지 않습니다.

### 구속

```text
Perpendicular(AB, BC)
EqualLength(AB, BC)
Midpoint(M, A, C)
OnCircle(P, c1)
soft Distance(A, B, 120)
```

| predicate | 인자 | 수학적 의미 |
| --- | --- | --- |
| `Distance(A, B, d)` | 점, 점, 숫자 | `‖B−A‖ = d` |
| `OnCircle(P, c)` | 점, 원 | `‖P−center(c)‖ = r(c)` |
| `OnLine(P, l)` | 점, 선 | P를 l 위로 정사영 |
| `Midpoint(M, A, B)` | 점, 점, 점 | `M = (A+B)/2` |
| `Perpendicular(l1, l2)` | 선, 선 | 방향 벡터의 내적 0 |
| `Parallel(l1, l2)` | 선, 선 | 방향 벡터의 외적 0 |
| `EqualLength(l1, l2)` | 선, 선 | 두 길이 같음 |
| `Tangent(l, c)` | 선, 원 | 중심–직선 거리 = 반지름 |
| `Coincident(A, B)` | 점, 점 | 같은 위치 |
| `Horizontal(l)` | 선 | 두 끝점의 y 같음 |
| `Vertical(l)` | 선 | 두 끝점의 x 같음 |
| `Radius(c, r)` | 원, 숫자 | 반지름 고정 |
| `AngleAt(B, A, C, 90)` | 점, 점, 점, 도 | 꼭짓점 B의 각도 |
| `Fixed(A)` | 점 | 핀 고정 (`pin A`와 동일) |

- `soft` 접두사는 소프트 제약(가중치 0.25)입니다. `soft Distance(...)`처럼 씁니다.
- `pin A` / `unpin A`로 점을 고정·해제할 수 있습니다.
- 중복 구속은 오류가 아니라 중복 residual로 계산됩니다. 진단 패널에서 잔차가 큰 구속을 확인하세요.
- DSL에 없는 predicate는 컴파일 오류입니다. 임의 JavaScript/DSL 평가기는 없습니다.

---

## Style

```text
point { r: 4.5; fill: #2563eb; stroke: #ffffff; width: 1.5; label: false }
segment, line { stroke: #475569; width: 2; ticks: true }
circle { stroke: #94a3b8; width: 1.75; fill: none }
A { label: "A"; fill: #1d4ed8 }
```

- 선택자는 쉼표로 여러 개를 쓸 수 있습니다.
- 선택자는 **substanceId**(`A`, `c1`), **Domain 타입명**(`Point`), **primitive kind**(`point`)와 매칭됩니다.
- 규칙은 파일 순서대로 병합되고 뒤 규칙이 이깁니다.
- 지원 필드:
  - `r` — 점 반지름
  - `fill`, `stroke`, `width`, `dash`
  - `label` — `false`, `true`(id 표시), `"임의 텍스트"`
  - `fontSize`, `fontWeight`, `labelBackground`
  - `radius` — 각도 표기의 호 반지름
  - `ticks` — 등길이 틱 표시 여부 (선분)
- 색상은 `#rgb`, `#rrggbb`, `#rrggbbaa`, `none`, `transparent`, `currentColor`, 단순 CSS 이름만 허용됩니다. 그 외 값은 안전한 기본 색으로 대체됩니다.

Style 탭의 숫자 필드는 패널의 인라인 슬라이더로도 편집할 수 있습니다. 슬라이더는 Style DSL 텍스트를 직접 수정하며, **적용** 전까지는 정본에 쓰지 않습니다.

---

## 진단과 오류

- 컴파일 오류는 `L<줄>: <메시지>` 형태로 패널과 명령 오류에 표시됩니다.
- 존재하지 않는 개체 참조, 잘못된 종류(점이 아닌데 점으로 사용), 인자 개수 불일치, 알 수 없는 타입/predicate는 모두 쓰기 전에 거부됩니다.
- 과구속 후보는 `Kite 진단` 패널의 잔차 목록에 표시됩니다. 구속을 `soft`로 완화하거나 삭제한 뒤 **다시 수렴**을 실행하세요.

---

## 완전한 예제

```text
# Domain
type Point shape point
type Segment shape segment
type Circle shape circle
predicate OnCircle(Point, Circle)
predicate Midpoint(Point, Point, Point)
predicate Perpendicular(Segment, Segment)
predicate EqualLength(Segment, Segment)

# Substance
Point A = (80, 240) pin
Point B = (260, 240) pin
Point C = (260, 60)
Point M = (170, 150)
Point P = (297, 150)

Segment AB = A .. B
Segment BC = B .. C
Segment CA = C .. A
Circle c1 = center M r 127
Angle angB = A B C
Label labC = "c₁" at center c1 offset (0, 16)

Perpendicular(AB, BC)
EqualLength(AB, BC)
Midpoint(M, A, C)
OnCircle(B, c1)
OnCircle(P, c1)

# Style
point { r: 4.5; fill: #2563eb; label: false }
segment { stroke: #475569; width: 2 }
circle { stroke: #94a3b8; width: 1.75; fill: none }
angle-mark { stroke: #f59e0b; width: 1.5; radius: 22; label: "90°" }
P { fill: #dc2626; label: "P" }
```
