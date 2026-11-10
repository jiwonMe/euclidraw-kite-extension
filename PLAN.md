# Penrose × Alid Editor 익스텐션 전체 구현 계획

Nov 10, 2026 · @Sungmin

**권장안:** 자체 DSL과 XPBD 솔버를 계속 넓히지 말고 `@penrose/core` 3.3.1(MIT)을 엔진으로 내장한 뒤, 현재 익스텐션이 이미 갖춘 alid 통합 계층을 그 위에 다시 얹습니다. 현재 익스텐션은 구속 14종과 프리미티브 9종의 고정 문법입니다. Penrose는 Style 선택자, 계산 함수 228개, 제약 30개, 목적 함수 24개, 셰이프 11종, 단계별 최적화를 갖고 있어 재구현으로는 따라잡기 어렵습니다.

목표는 Penrose 다이어그램에서 자유도가 있는 객체를 기즈모로 움직일 수 있게 하는 것입니다. 구현 범위는 core의 언어와 엔진이고, editor 패키지는 패널을 붙일 때 참고만 합니다. v1 엔진과 정확한 기하 드래그는 삭제합니다.

작업은 P0부터 P6까지 일곱 단계입니다. P0에서 먼저 답해야 하는 불확실성은 세 가지입니다: 번들을 얼마나 줄일 수 있는지(메인·워커 이중 포함 여부), 피어 간 결정적인 텍스트 측정과 `<text>` 렌더의 정합, 그리고 워커 응답 한 건이 유발하는 전역 Computed 재계산 비용입니다. 비동기 결과를 Computed에 반영하는 경로 자체는 `invalidateComputed()`로 이미 존재합니다([호스트 변경 필요사항](#호스트-변경-필요사항)).

분석 기준은 첨부한 호스트·익스텐션 스냅샷과 Penrose `main` 브랜치 커밋 `d46d92b`(2026-11-06)입니다. 이 문서의 줄 수와 API 인용은 그 커밋에서 읽었고, 실제로 번들할 아티팩트는 npm `@penrose/core@3.3.1`(MIT, tarball integrity `sha512-QofvV/91aZg10nMMIR05asWkFLlDTmn+As5yo4DIpG4/eQDbeZZmJeAu/vC9hvjyOG8eomq0JXL5596KGAw+qQ==`, `gitHead edad5498…`)으로 고정합니다. 두 기준은 같은 스냅샷이 아니므로 P0에서 고정 아티팩트의 실제 동작과 크기를 다시 확인합니다. 코드를 빌드하거나 실행하지는 않았으므로 번들 크기와 성능 수치는 아직 없습니다.

## 현재 상태

출발점은 하나가 아니라 셋입니다. 외부 익스텐션은 호스트 통합이 완성돼 있지만 언어가 작고, 호스트 저장소 안의 미등록 패키지는 Penrose식 파서만 있고 실행부가 없습니다.

| 자산 | 있는 것 | 없는 것 |
| --- | --- | --- |
| 외부 익스텐션 `kite.studio` 0.2.0 | 스코프+멤버 엔티티(패턴 A), Rust→Wasm XPBD 솔버, Cold·Interactive·Dirty 계산 모드, 드래그 1회 커밋, Space 2A 기즈모와 2B 팝오버, Tri-DSL 패널, 진단 패널, 명령 24개, 클립보드·베이킹, 실제 커널 위 테스트 4종 | Penrose 문법, 임의의 목적·제약 함수, 셰이프 라이브러리, 변이 |
| 호스트 내 `packages/extensions/kite-studio` (`@alid/ext-kite`) | Domain·Substance·Style 파서, `forall`·`collect`·`where` 관계 매처, TeX 사전 측정기, 전체 구현을 염두에 둔 정본 스키마. 여섯 파일 2,123줄¹ | 식 평가기, 솔버, 렌더러, 호스트 연결. builtins에 등록돼 있지 않음 |
| 호스트 확장 계약 | 설치 API 2, `ExtensionPackageSpec`, 동기 Computed, ScratchOverlay, 기즈모·HSM, 패널, `svgDefs` | 아래 "호스트 변경 필요사항" 참조 |

¹ 2026-11-10 기준 이 패키지는 `~/Workspace/alid`의 작업 트리와 어느 브랜치에도 없고, t3 체크포인트 ref(`2660f21` 등 dangling)에만 남아 있습니다. P1에서 v1 코드를 지우기 전에 브랜치나 압축본으로 **먼저 보존**해야 합니다. 보존하지 않으면 스키마 설계 참고자료가 사라집니다.

### 현재 익스텐션의 언어 범위

- **Domain**: 타입에 프리미티브 모양을 붙이고, 내장 술어에 별칭과 인자 타입을 주는 정도입니다. 새 술어의 의미를 정의할 수 없습니다.
- **Substance**: `Point A = (120, 260) pin`처럼 좌표와 고정 여부가 선언에 섞여 있습니다. Penrose에서는 이것이 Style의 몫입니다.
- **Style**: 셰이프·타입·이름 선택자에 속성 맵을 붙이는 CSS형 규칙과 `param` 슬라이더입니다. 수식 함수는 `sin cos tan sqrt abs deg rad min max pow` 10개입니다.
- **솔버**: Distance, Coincident, Midpoint, OnCircle, OnLine, Perpendicular, Parallel, EqualLength, Horizontal, Vertical, Tangent, Radius, AngleAt 13종과 Fixed. 구속 종류가 Rust 코드에 고정돼 있습니다.

### 익스텐션이 지켜야 하는 호스트 제약

- 배포물은 Blob으로 로드하는 단일 ES 모듈 하나이며 5 MiB 이하입니다(개발 연결은 8 MiB). 상대 경로 import와 별도 에셋을 쓸 수 없습니다.
- 외부로 둘 수 있는 import는 `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`, `@alid/react`, `@alid/kernel` 일곱 개뿐입니다.
- 정본에는 사용자 의도만 둡니다. 읽기·페인트·내보내기는 커밋 0회여야 하고, 드래그는 놓을 때 Undo 그룹 하나로만 기록합니다.
- 화면과 출판이 같은 순수 SVG 문자열을 써야 합니다. `<foreignObject>`와 DOM 측정은 쓸 수 없습니다.
- 문서에 담긴 코드는 JS로 실행하지 않습니다. 현재 익스텐션은 수식을 연료 제한 Wasm VM에서만 평가합니다.
- 데스크톱(Tauri) CSP는 `'wasm-unsafe-eval'`과 `worker-src blob:`을 허용합니다.

## Penrose 구조

익스텐션이 내장할 대상은 `@penrose/core` 하나이고, 나머지 패키지는 기능 기준과 테스트 자료로 씁니다. 저장소는 모노레포이며 패키지는 열 개입니다.

| 패키지 | 역할 | 이 계획에서의 쓰임 |
| --- | --- | --- |
| `core` | 컴파일러, 자동미분, 최적화기, 셰이프, 렌더러. 테스트 제외 TypeScript 약 33,700줄, nearley 문법 3종 | 엔진으로 내장. 렌더러와 라벨 측정만 교체 |
| `examples` | 레지스트리 항목 191개, 도메인 디렉터리 55개 | 언어·엔진 구현의 회귀 기준. 번들에는 넣지 않음 |
| `components` | React 컴포넌트, CodeMirror용 Lezer 문법 3종 | 패널에 구문 강조를 붙일 때 참고 |
| `editor` | IDE. 워커 기반 최적화, 레이아웃 타임라인, 변이 그리드, Edit·Play 상호작용 | 패널과 워커 프로토콜을 만들 때 참고. 기능 이식 대상은 아님 |
| `roger` | CLI | 기준 SVG 생성 |
| `bloom` | JS로 다이어그램을 만드는 빌더 API | 범위 밖 |
| `vscode`, `edgeworth`, `solids`, `docs-site` | VS Code 확장, 문제 합성기, Solid 바인딩, 문서 | 범위 밖 |

### core의 파이프라인

1. **파싱.** nearley와 moo로 만든 `Domain.ne`, `Substance.ne`, `Style.ne`.
2. **Domain·Substance 검사.** 서브타입, 술어·함수·생성자 시그니처, 인덱스 문 전개, 라벨.
3. **Style 컴파일.** 선택자 매칭, 블록 적용, `override`·`delete`, 경로 해석, 레이어 순서, 단계별 제약 집합. `Style.ts` 한 파일이 4,161줄입니다.
4. **자동미분.** 셰이프 속성과 `ensure`·`encourage` 식이 계산 그래프가 되고, Rose가 실행 시점에 기울기 함수를 WebAssembly로 생성합니다.
5. **최적화.** 외부점 방법과 L-BFGS. Style의 `layout` 단계마다 따로 수렴시킵니다.
6. **셰이프 계산.** `computeShapes(varyingValues)`가 수치 셰이프 목록을 돌려줍니다.
7. **렌더.** `toSVG`가 DOM 노드를 만듭니다. Equation은 MathJax, Text는 캔버스 `measureText`로 치수를 재니다.

컴파일 결과인 `State`에서 다시 만들 수 없는 것은 trio 원문, `variation` 문자열, 최적화 변수 벡터 `varyingValues` 셋뿐입니다. 이 셋이 정본에 저장할 전부이고, 나머지는 파생입니다.

core에서 DOM에 기대는 곳은 렌더러, 라벨 수집(`CollectLabels.ts`), 상호작용 유틸(`InteractionUtils.ts`)입니다. 컴파일러와 최적화기는 DOM을 쓰지 않으므로 워커로 옮길 수 있습니다.

## 갭 분석

갭의 대부분은 언어와 엔진에 있고, 호스트 통합 쪽은 이미 Penrose 에디터보다 앞선 부분이 있습니다. 엔진 내장으로 한 번에 닫히는 행과 직접 만들어야 하는 행을 마지막 열에 나눴습니다.

| 영역 | Penrose | 현재 익스텐션 | 닫는 방법 |
| --- | --- | --- | --- |
| Domain | `type`, 서브타입 `<:`, `predicate`, `symmetric`, `function`, `constructor` | 타입→모양 매핑, 내장 술어 별칭 | 엔진 내장 |
| Substance | 선언, `:=` 바인딩, 술어 적용, `Let`, `Label`·`AutoLabel`·`NoLabel`, `for … in … where` 인덱스 문 | 좌표·핀이 섞인 고정 구문 | 엔진 내장 |
| Style 선택자 | 네임스페이스, `forall`·`where`·`with`·`as`, `repeatable`, `collect … into … foreach`, `match_id` | 셰이프·타입·이름 선택자 | 엔진 내장 |
| Style 식 | `?` 미지수, 벡터·행렬, 리스트, 경로 접근, `override`·`delete`, `listof`·`numberof`·`nameof` | 스칼라 수식과 `param` | 엔진 내장 |
| 최적화 선언 | `ensure`·`encourage`, `in` 단계 지정, `layout = […]`, `layer` | 고정 구속 13종과 `soft` | 엔진 내장 |
| 함수 라이브러리 | 계산 228, 제약 30, 목적 24 | 수식 함수 10 | 엔진 내장 |
| 솔버 | 자동미분, L-BFGS, 외부점 방법, 단계별 수렴 | XPBD와 하드 다양체 정사영 | 엔진 내장 + 워커 어댑터 제작 |
| 셰이프 | Circle, Ellipse, Equation, Image, Line, Path, Polygon, Polyline, Rectangle, Text, Group | 점·선분·직선·반직선·원·호·다각형·각 표시·라벨 | 순수 SVG 문자열 렌더러 제작 |
| 라벨 측정 | MathJax(브라우저 어댑터), 캔버스 `measureText` | 폭 추정 함수, `markdown.card` 멤버 | 결정적 측정기 제작 |
| 변이 | `variation` 시드, 재표본 | 결정적 초기 후보 탐색 | 정본 필드와 명령 추가 |
| 상호작용 | Edit 모드(이동·크기·핀), Play 모드(`draggingConstraint`) | 다양체 위 드래그, Shift 스냅 승격, 1회 커밋 | 자유도 기즈모 제작. Play 모드는 범위 밖 |
| 편집기 | CodeMirror 구문 강조·자동완성, 오류 위치, 예제 브라우저, 타임라인, 변이 그리드 | textarea 3탭, 줄 단위 진단 | 범위 밖. 패널을 붙일 때 참고만 |
| 예제 | 레지스트리 191개 | 탈레스 정리 1개 | 범위 밖. 회귀 기준으로만 사용 |
| 호스트 통합 | 해당 없음(독립 IDE) | 엔티티·Undo·클립보드·연결선·베이킹·미니버퍼 | 유지하고 새 스키마에 맞춤 |

현재 익스텐션에만 있는 기능은 가져가지 않습니다. 하드 구속을 매 프레임 정확히 만족시키는 다양체 정사영, 자유도·과구속 진단, 구속 배지, Shift 스냅 승격은 v1 엔진과 함께 삭제합니다. 드래그는 Penrose 방식으로 바뀝니다. 끄는 객체의 입력을 포인터 위치에 고정하고 나머지 입력을 다시 최적화합니다.

## 목표 아키텍처

최적화는 워커에서 돌고, 메인 스레드의 Computed는 캐시된 결과만 동기로 읽으며, 정본에는 trio·`variation`·수렴값만 남습니다.

```text
메인 스레드 (호스트)                              워커 (Blob, 번들에 문자열 내장)
──────────────────────────────────────────        ──────────────────────────────────
penrose.scope 정본 ── trio · variation ──────▶    compileTrio (nearley + Style)
                                                    │ 라벨 목록
결정적 측정 ◀───────────────────────────────────────┘
  └─ 라벨 치수 ───────────────────────────────────▶ 최적화 (L-BFGS, 단계별)
                                                    │
  Computed (동기, 캐시만 읽음)                       │
    penrose.compiled  ◀── Shape[] · 진단 ───────────┤
    penrose.layout    ◀── Shape[] ──────────────────┘
Space 1 렌더 (순수 SVG 문자열)
Space 2A 기즈모 (로컬 상태만)
커밋 1회: trio · variation · varyingValues ──▶ 정본
```

메인 스레드는 `@penrose/core`를 **타입으로만** import합니다. 값 import는 엔진을 메인 번들과 워커 문자열에 두 번 넣게 되어 5 MiB 한도를 넘깁니다(P0·P1 참조).

정본에서 읽은 trio는 워커에서 컴파일·최적화되고, 메인 스레드는 돌아온 셰이프 목록을 SVG 문자열로 바꿉니다. 수렴값이 정본에 쓰이는 것은 사용자 커밋 때 한 번뿐입니다.

### 엔진 선택

| 안 | 내용 | 판단 |
| --- | --- | --- |
| A. `@penrose/core` 내장 | MIT 패키지를 번들에 넣고 워커에서 실행 | **권장.** 언어, 함수 라이브러리, 예제 191개 호환을 한 번에 얻음. 비용은 번들 크기와 DOM 의존 제거 |
| B. 호스트 내 파서에 평가기·자동미분·함수를 직접 구현 | `packages/extensions/kite-studio`를 이어 감 | 비권장. `Style.ts` 4,161줄과 `Functions.ts` 8,044줄을 다시 써야 하고 상류 변경을 계속 따라가야 함 |
| C. 현재 XPBD 솔버 확장 | 구속 종류를 Rust에 추가 | 불가. 임의의 목적 함수와 Style 식을 표현할 수 없음 |

### 설계 결정

1. **익스텐션 ID는 `penrose.studio`.** 어스펙트는 `penrose.scope`와 `penrose.member`, 서비스는 `penrose.api`, 명령은 `penrose.studio:*`로 맞춥니다. v1과의 호환은 고려하지 않습니다. 스코프 필드는 세 DSL, `variation`, `topologyDigest`, `entityBindings`, 수렴값, 핀입니다.
2. **외부 저장소에서, 전부 TypeScript로.** 현재 외부 익스텐션 저장소에서 이어 갑니다. Rust 크레이트, DSL 컴파일러, 스냅, 구속 카탈로그와 배지는 제거하고 Rust 빌드 단계도 없앱니다. 호스트 내 `packages/extensions/kite-studio`는 스키마 설계의 참고 자료로만 씁니다.
3. **번들은 최소로.** 호스트 한도는 올릴 수 있지만 크기를 줄이는 쪽을 우선합니다. MathJax는 호스트의 TeX 렌더에 맡기고, 구문 강조 같은 선택 기능은 기본 번들에서 뺍니다.
4. **수렴값은 입력 벡터 그대로.** `varyingValues`를 Style 경로 키와 함께 저장합니다. `topologyDigest`가 맞으면 최적화 없이 `computeShapes`만 호출합니다. digest 입력은 trio 원문, `variation`, 고정한 core 버전, 측정기 버전(또는 폰트·자산 신원), Style `layout` 단계 구성입니다.
5. **멤버는 셰이프가 아니라 소유자.** Substance 객체, 술어 매치, 컬렉션 하나가 멤버 하나이고, 그 소유자가 만든 셰이프 여러 개를 묶습니다.
6. **페인트는 스코프가 담당.** 스코프 엔티티가 다이어그램 전체를 한 레이어로, Penrose 레이어 순서대로 그립니다. 멤버는 선택 기하, `layoutBounds`, 연결선 앵커, 기즈모의 대상만 제공합니다. 다른 캔버스 객체는 다이어그램 전체의 앞이나 뒤에만 놓입니다.
7. **기즈모는 최적화 입력에 붙음.** 셰이프의 위치·크기 속성이 최적화 입력(`?` 또는 기본 표본값)일 때만 핸들을 만듭니다. 식으로 계산된 속성에는 움직일 자유도가 없으므로 핸들이 없습니다. 이 판정은 core의 `interactivityInfo`가 제공합니다.
8. **계산 모드 세 가지를 유지.** Cold는 저장된 수렴값으로 셰이프만 계산합니다. Dirty는 워커에서 최적화하고 결과를 로컬에만 보여 줍니다. Interactive는 드래그 세션이 오버레이에 씁니다. 정본 쓰기는 DSL 적용, 드래그 놓기, 재표본 같은 사용자 커밋에서만 일어납니다.
9. **라벨 측정은 메인 스레드의 측정기.** 워커는 컴파일 후 라벨 목록을 보내고, 메인이 치수를 돌려줍니다. Penrose 에디터의 `optimizer/worker.ts`가 이미 같은 분업을 씁니다. 측정기가 결정적이어야 피어 간 SVG가 같고, 그 신원이 `topologyDigest`에 들어갑니다. `<text>`로 내보낼 때 측정값과 실제 폰트가 어긋나는 문제는 P0에서 정책을 결정합니다(B).
10. **`draggingConstraint`는 지원하지 않음.** JS 함수 본문 문자열이고, Penrose 에디터가 `new Function`으로 실행하는 editor 쪽 기능입니다. core 범위 밖이며 문서에 담긴 JS를 실행하지 않는 호스트 원칙과도 충돌합니다.
11. **워커는 번들 안에서 생성.** 별도 파일을 둘 수 없으므로 워커 코드를 문자열로 내장하고 Blob URL로 띄웁니다. 메인 청크는 `@penrose/core`를 **값으로 import하지 않습니다**(타입 전용). 값 import는 엔진을 두 번 넣어 5 MiB 한도를 넘깁니다.

## 단계별 구현 계획

P0의 측정 결과가 나머지 단계의 형태를 정하므로 P0은 건너뛸 수 없는 게이트입니다. P1→P2→P3→P4는 순서대로 가야 하고, P5는 P1이 끝나면 병행할 수 있습니다.

| 단계 | 산출물 | 완료 기준 |
| --- | --- | --- |
| P0 스파이크 | 번들 크기 측정(메인·워커 이중 포함 여부 포함), 워커 왕복 시연, 텍스트 측정 정책 결정, 스키마 결정 | 레지스트리 예제 3개가 워커에서 수렴하고 셰이프 목록이 메인으로 돌아옴. 메인 청크의 엔진 코드 0바이트 확인. 크기·시간 수치와 측정 정책 기록 |
| P1 엔진 어댑터와 스키마 v2 | 워커 프로토콜, `penrose.scope@2`, Computed 2개, 진단 변환, 2단계 빌드 | 읽기 시 커밋 0회. Cold 열기에서 최적화 0스텝. 메인 청크 엔진 0바이트·번들 5 MiB 이하. 콜드 열기 지연 측정값 기록 |
| P2 렌더링과 측정 | 셰이프 11종 순수 SVG, 결정적 라벨 측정 | 레지스트리 191개를 기준 SVG와 비교한 불일치 목록. 피어 간 SVG 바이트 동일 |
| P3 호스트 통합 재배선 | 멤버 동기화, 선택, 연결선, 클립보드, 베이킹, 명령 | v2 스코프에서 기존 interop 테스트 대응분 통과 |
| P4 자유도 기즈모 | 이동·크기·정점 핸들, 핀, 재표본 | 드래그 중 문서 불변, 놓을 때 커밋 1회, Undo 1회로 원복. 중간 예제 드래그 응답 p95 50ms 이내(또는 로컬 미리보기 폴백 동작 기록) |
| P5 패널 | Tri-DSL 패널, 진단 패널 | 튜토리얼 3개를 패널만으로 따라 할 수 있음 |
| P6 정리와 출시 | v1 잔여 정리, 성능 계측, 문서, 마켓플레이스 등록 | v1 코드가 번들에 남지 않음. 측정값이 README에 기록됨 |

### P0 스파이크

- **번들 크기(A).** `@penrose/core`와 `rose`를 단일 ESM으로 묶어 크기를 쟽니다. MathJax를 넣은 경우와 뺀 경우, 그리고 **엔진을 메인 청크에 포함한 경우와 워커 문자열에만 넣은 경우**를 각각 측정합니다. 후자가 목표 구성입니다.
- 워커 코드를 문자열로 인라인하는 2단계 빌드가 가능한지 확인합니다: 워커 엔트리를 따로 번들 → `?raw`로 메인 번들에 삽입 → 메인 번들 크기에 엔진이 한 번만 포함되는지 검사. 메인 스레드의 `@penrose/core` import는 타입 전용(`import type`)이어야 하며, 값 import가 섞이면 실패로 봅니다.
- 감량 수단별 효과를 기록합니다: MathJax 제외, lodash·immutable 트리 셰이킹, 압축 설정. 목표는 현재 한도인 5 MiB 이하이고, 넘으면 초과분을 호스트 한도 조정의 근거로 남깁니다. CI에 번들 크기 예산 검사를 넣는 비용도 함께 봅니다.
- **텍스트 측정 정책(B).** 결정적 측정기와 `<text>` 렌더의 정합 문제를 여기서 결정합니다. 후보는 (a) 텍스트를 경로로 베이킹(폰트 동봉, 크기 증가), (b) 호스트 `measureText`를 쓰고 측정 치수를 정본에 저장(v1 `markdown.card` 방식), (c) 호스트 측정 서비스 요구입니다. 결정 전에는 P2를 시작하지 않습니다.
- 문자열로 내장한 Blob 워커에서 컴파일 → 라벨 치수 왕복 → 최적화 → 셰이프 목록 반환을 시연합니다. 예제 3개는 라벨(Text·Equation), Path·Polygon, Line 시작·끝(상호작용 입력)을 각각 포함해 드래그 경로까지 스파이크에서 지나가게 고릅니다.
- Rose의 실행 시점 WebAssembly 생성과 top-level await가 Tauri 앱과 웹 배포 양쪽에서 동작하는지 확인합니다.
- 실제 커널 테스트 하네스(Node)에서 워커 없이 같은 엔진 경로를 돌릴 방법을 정합니다(상류 `optimizer/worker.ts`처럼 compile → 라벨 치수 → optimize를 직접 호출).
- 워커 응답 한 건이 전역 Computed 재계산을 얼마나 유발하는지 측정합니다. 반영 경로는 `invalidateComputed()`로 이미 확정돼 있고, 남은 문제는 비용입니다.

### P1 엔진 어댑터와 스키마 v2

- 저장소를 정리합니다. `crate-kite-solver`, `src/dsl/`, `solver-runtime.ts`, Rust 빌드 스크립트와 툴체인 설정을 지웁니다. 삭제 전에 호스트의 `packages/extensions/kite-studio` 참고본을 브랜치나 압축본으로 보존합니다(현재 체크포인트 ref에만 존재, §현재 상태 ¹).
- **번들 파이프라인(A).** 워커 엔트리를 별도로 빌드해 문자열로 인라인하고, 메인 번들은 엔진을 `import type`으로만 참조합니다. 빌드 결과 검사로 메인 청크에 `@penrose/core` 코드가 없고 전체 번들이 5 MiB 이하임을 확인합니다.
- 매니페스트 ID를 `penrose.studio`로 바꾸고 명령, 서비스, HSM 슬롯의 접두사를 맞춥니다.
- 워커 메시지: `compile`, `labels`(치수 응답), `optimize`(단계·취소), `shapesAt`, `resample`, `drag`, `dispose`. 요청 ID와 세대 번호로 낡은 응답을 버립니다.
- 스코프별 엔진 인스턴스 풀. 현재 `SolverPool`을 대체합니다.
- `penrose.scope`, `penrose.member` 어스펙트와 `topologyDigest` 계산. **(C)** 해시 입력은 trio 원문, `variation`, 고정한 core 버전, 측정기 버전(또는 폰트·자산 신원), Style `layout` 단계 구성입니다. 이 중 하나라도 빠지면 낡은 수렴값으로 틀린 기하를 조용히 그립니다.
- `computed.penrose.compiled`, `computed.penrose.layout` 두 Computed와 Cold·Dirty 모드. Cold는 저장된 `varyingValues`로 `computeShapes`만 호출하지만 **컴파일은 매번** 수행하므로, 콜드 열기 지연 목표를 측정해 기록하고 해법(P6 셰이프 캐시)을 이 단계에 명시합니다.
- `PenroseError`를 `{source, line, column, message}` 진단으로 변환합니다.
- `documents.ts`에 trio 적용 트랜잭션을 둡니다. DSL, 수렴값, 멤버 동기화가 한 번에 들어갑니다.

### P2 렌더링과 측정

- 셰이프 11종을 SVG 문자열로 냅니다. 속성 대응은 core의 `renderer/`와 `AttrMapSvg.ts`를 따릅니다.
- 화살촉은 Penrose처럼 `<marker>`를 참조하지 않고 경로로 직접 그립니다. 호스트의 연결선 확장이 쓰는 방식과 같습니다.
- Group의 클립은 엔티티 범위에서 유일한 ID의 `<clipPath>`로 냅니다.
- Equation은 TeX를 경로 글리프로, Text는 P0에서 정한 측정 정책(B)에 따라 처리합니다. `<text>`를 내보내는 경우에도 측정 치수와 실제 폰트가 어긋날 수 있으므로, 렌더 패리티 비교에 텍스트 오버플로 검사를 넣습니다.
- Image는 Style의 `href`를 블롭 저장소나 data URI로 해석하고, 인라인하는 SVG는 정화합니다.
- 패스스루 속성은 허용 목록으로 거르고, 색과 문자열은 이스케이프합니다.
- Penrose 캔버스(중심 원점, y축 위쪽)를 스코프 프레임의 균일 상사변환으로 사상합니다.

### P3 호스트 통합 재배선

- 멤버 동기화: 소유자가 생기거나 사라지면 커밋 경로에서만 엔티티를 만들고 지웁니다. 붙여넣기 후 바인딩 복원은 지금의 `resolveBindings` 방식을 유지합니다.
- 선택 기여: 소유자의 셰이프 합집합으로 히트 테스트하고 `canTransform: false`를 유지합니다. 멤버는 자기 SVG를 내지 않습니다.
- `layoutBounds` 공급으로 연결선이 멤버를 따라가게 합니다.
- 클립보드 전체 복제와 `bake-to-vector`를 셰이프 11종에 맞춥니다.
- 명령을 정리합니다. v1 문법에 묶인 `add-*`, `constrain-*`, `relax-constraint`, `remove-constraint`, `extract-subgraph`, `set-param`은 제거하고, 삽입·DSL 적용·재수렴·핀·베이킹·패널 열기만 남깁니다.
- 완화 애니메이션은 이전 셰이프와 새 셰이프 사이를 오버레이에서 보간합니다.

### P4 자유도 기즈모

- **이동 핸들.** `center`의 두 좌표가 모두 입력인 셰이프, `start`·`end`가 모두 입력인 Line, 모든 점이 입력인 Polygon·Polyline에 붙입니다. core의 `translatableShapePaths`가 대상 목록입니다.
- **크기 핸들.** `r`, `width`·`height`, `rx`·`ry`가 입력인 셰이프에 붙입니다. core의 `scalableShapePaths`가 대상 목록입니다.
- **정점 핸들.** Line의 끝점과 Polygon·Polyline의 점은 좌표마다 입력이 따로 있으므로 점 하나씩 끄는 핸들을 추가로 제공합니다. core에는 없는 기능입니다.
- Path와 Group은 core가 상호작용 정보를 주지 않으므로 핸들이 없습니다.
- 핸들은 지금처럼 select-suite 기즈모 레지스트리에 등록하고 `root.select.penrose.studio:manipulate` 상태에서 다룹니다.
- 드래그 중에는 포인터 이벤트가 목표만 기록합니다. 프레임 래치에서 끄는 입력을 목표값에 고정해 워커로 보내고, 최신 응답을 오버레이에 씁니다. 문서 셰이프와 기즈모는 같은 응답으로 그립니다.
- **(D) 지연 대비책을 먼저 정합니다.** 매 프레임 전체 재최적화가 한 프레임 안에 끝난다고 가정하지 않습니다. 기본 동작은 끈 셰이프(와 그 자식 입력)만 로컬 평행이동·크기변경으로 미리 보여 주고, 워커 응답이 오면 오버레이를 그 응답으로 교체하는 것입니다. 놓을 때 전체 단계 최적화를 한 번 돌립니다. 응답이 예산 안에 오는 경우에만 매 프레임 재최적화를 켭니다. 드래그 예산은 중간 예제(레지스트리 191개 중 중앙 크기)에서 p95 50ms로 잡고, P4 초기에 측정해 조정합니다. 예산을 넘으면 전체 최적화 대신 스텝 제한 점진 수렴을 씁니다.
- 놓으면 수렴시킨 뒤 수렴값과 핀을 한 트랜잭션, Undo 그룹 하나로 기록합니다.
- 끈 객체는 Penrose처럼 핀으로 고정되고, 핀 표시와 `toggle-pin` 명령으로 풉니다. 핀은 정본에 저장합니다.
- `variation`을 바꾸는 재표본 명령을 넣습니다.
- Esc, blur, `pointercancel`, IME 조합 시작은 지금처럼 아무것도 쓰지 않고 취소합니다.

### P5 패널

- Tri-DSL 패널은 지금 구조를 유지합니다: 탭 3개, ⌘/Ctrl+Enter 적용, 오류 줄 표시. 오류 위치는 `PenroseError`에서 가져옵니다.
- 진단 패널을 새 엔진에 맞춥니다: 총 에너지, 제약·목적별 값(`evalFns`), 단계별 스텝 수, Style 경고. 자유도와 야코비안 계수 표시는 없앱니다.
- 재표본 버튼과 `variation` 입력을 패널에 둡니다.
- v1의 `param` 슬라이더는 제거합니다.
- editor의 예제 브라우저, 변이 그리드, 레이아웃 타임라인은 구현 대상이 아닙니다. 패널 배치와 워커 메시지를 설계할 때 참고만 합니다.
- 구문 강조는 번들 예산이 남을 때만 `@penrose/components`의 Lezer 문법을 참고해 붙입니다.

### P6 정리와 출시

- 컴파일, 수렴, 드래그 프레임 시간을 큰 예제에서 재고 README의 측정값을 갱신합니다.
- 다시 열 때 컴파일을 기다리지 않도록 `topologyDigest`를 키로 한 로컬 셰이프 캐시를 둡니다. 정본에는 넣지 않습니다.
- core 버전을 고정하고, 올릴 때마다 회귀 스위트를 돌리는 절차를 문서화합니다.
- README, `AGENTS.md`, `docs/`를 새 구조에 맞게 다시 씁니다.
- `penrose.studio`로 마켓플레이스에 등록합니다. 번들에 넣은 패키지의 실제 라이선스 고지를 함께 배포합니다: `@penrose/core` MIT, `mathjax-full` **Apache-2.0**, `nearley`·`moo`·`lodash`·`immutable`·`ml-matrix` 등 MIT. 고지는 `node_modules`의 라이선스 필드에서 자동 생성하고, 폰트를 동봉하면 폰트 라이선스(예: OFL)도 포함합니다.

## 호스트 변경 필요사항

커널을 고치지 않고 가는 것이 원칙이고, 지금 확정적으로 필요한 커널 변경은 없습니다. 아래 세 항목은 P0에서 확인하거나 호스트 쪽에 요청해야 하고, 마지막 항목은 P0에서 비용만 재는 항목입니다. 익스텐션 ID와 어스펙트 ID가 `penrose.*`로 바뀌므로 호스트 내 미등록 패키지의 `kite.scope`와는 더 이상 충돌하지 않습니다. 참고로 그 패키지는 현재 작업 트리에 없고 체크포인트 ref에만 있으므로(§현재 상태 ¹) 등록 충돌 자체가 없습니다.

| 항목 | 현재 호스트 | 필요한 것 | 언제 |
| --- | --- | --- | --- |
| 번들 크기 한도 | `repository-plugins.ts`의 `MAX_SOURCE_BYTES`가 5 MiB | 한도 상향, 또는 해시로 검증하는 추가 에셋(워커·wasm) 지원 | P0 측정이 한도를 넘을 때만 |
| TeX 렌더 공개 | `renderTexSvg`는 `@alid/extension-markdown-card`의 패키지 export. 외부 번들은 이 패키지를 import할 수 없고, `doc.markdown-math`의 `activate`는 API를 반환하지 않음 | TeX→SVG와 치수를 확장 API나 서비스로 노출. 안 되면 MathJax를 익스텐션에 번들 | P1 전 |
| 결정적 텍스트 측정 | 텍스트 확장에 헤드리스 `layoutTextRuns()`가 있으나 서비스로 공개되지 않음(측정 함수 주입은 가능) | 측정 서비스 공개. 안 되면 익스텐션이 폰트 메트릭 표를 내장 | P2 전 |
| 비동기 결과의 Computed 반영 | `invalidateComputed()`는 **모든 셀을 무효화한다**(`kernel-data.ts`의 `preview.invalidateAll()`·`committed.invalidateAll()` + `markComputedDirty`). 공인 경로는 이미 있고 v1도 Wasm 로드 후 이 호출에 의존한다. 문제는 비용이 전역이라는 점 | 그대로 쓴다. 워커 응답 1건이 유발하는 전역 재계산 비용을 측정하고, 필요하면 셀 단위 무효화를 호스트에 요청 | P0(비용) / P1(필요 시) |

CSP는 문제가 될 가능성이 낮습니다. Tauri 설정은 `'wasm-unsafe-eval'`과 `worker-src blob:`을 허용하고, `deploy/vercel.json`은 COOP·COEP 헤더만 설정합니다. 그래도 P0에서 양쪽 모두 실제로 돌려 봐야 합니다.

TeX 렌더를 호스트에 위임하면 차이가 하나 생깁니다. 호스트 렌더러는 `base`와 `ams` 패키지만 켜고, Penrose는 `AllPackages`를 켭니다. 일부 예제의 매크로가 렌더되지 않을 수 있으므로 P2의 비교 목록에서 따로 집계합니다.

## 리스크와 결정 사항

가장 큰 리스크는 번들 크기와 드래그 지연이며, 둘 다 측정 전에는 크기를 알 수 없습니다.

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 번들이 5 MiB를 넘음 | 저장소 설치 불가 | 엔진을 메인 청크에서 제거하고 워커 문자열에만 넣기(타입 전용 import), MathJax 제외, 트리 셰이킹, 한도 상향 요청. P0에서 결정 |
| 워커 왕복으로 드래그가 한 프레임 이상 늦음 | 현재의 "같은 프레임에 풀고 그린다"가 깨짐 | 기본은 끈 셰이프만 로컬 미리보기, 응답 도착 시 오버레이 교체, 놓을 때 전체 최적화. 중간 예제 p95 50ms 예산을 P4 초기에 측정 |
| 페널티 기반 최적화는 제약을 근사적으로만 만족 | v1의 정확한 기하(정확한 직각, 원 위의 점)가 흐려짐 | 수용하기로 결정. v1 엔진은 삭제 |
| 피어마다 최적화 결과가 미세하게 다름 | 피어 간 SVG 불일치 | 수렴값을 정본에 저장해 다른 피어는 재최적화하지 않음. 출력 좌표 반올림 |
| 캔버스 `measureText`는 플랫폼마다 값이 다름 | Text 셰이프가 있는 다이어그램의 레이아웃이 피어마다 달라짐 | 결정적 측정기로 교체 |
| 큰 다이어그램의 컴파일·수렴 시간 | 첫 표시가 늦음 | 로컬 셰이프 캐시, 진행 표시, 취소 |
| 문서에 담긴 JS(`draggingConstraint`) | 호스트의 매크로 차단 불변식 위반 | 지원하지 않음. 속성은 무시하고 경고를 표시 |
| Image의 외부 `href`와 인라인 SVG | 외부 리소스 로드, 스크립트 주입 | 블롭 저장소와 data URI만 허용, 정화 |
| 상류 API 변경 | 어댑터 깨짐. v3.3.0에도 호환성을 깨는 변경이 있었음 | 버전 고정, 올릴 때 회귀 스위트 |

### 결정된 사항

- v1은 고려하지 않습니다. 엔진과 DSL을 삭제하고, 호환이나 변환은 만들지 않습니다.
- 목표는 자유도가 있는 Penrose 객체를 기즈모로 움직이는 것입니다.
- 범위는 core의 언어와 엔진입니다. editor는 패널을 붙일 때 참고만 하고, Bloom·Edgeworth·VS Code 확장은 다루지 않습니다.
- 다이어그램 전체를 스코프 엔티티가 한 레이어로 그립니다.
- 기준 저장소는 외부 익스텐션 저장소이고 TypeScript로 작성합니다.
- 번들 한도는 호스트에서 올릴 수 있지만 크기를 최대한 줄입니다.
- 익스텐션 ID는 `penrose.studio`입니다.

## 검증 계획

"전체 구현"의 판정 기준은 Penrose 레지스트리 191개 항목이고, alid 쪽 기준은 현재 익스텐션의 불변식 테스트 4종입니다.

- **레지스트리 회귀.** 항목마다 컴파일 성공, 수렴, `roger`로 만든 기준 SVG와의 래스터 비교를 기록합니다. 결과를 통과·불일치·미지원으로 나눈 표를 저장소에 커밋합니다.
- **불변식 테스트 이식.** `zero-write-on-read`, `manifold-drag-undo`, `headless-svg-determinism`, `interop`을 v2 스코프에 맞게 옮깁니다. 실제 커널과 Loro 코어 위에서 빌드된 번들을 돌리는 지금의 방식을 유지합니다.
- **피어 결정성.** 두 세션이 같은 문서를 열었을 때 SVG가 바이트 단위로 같은지 확인합니다. Text와 Equation이 들어간 예제를 반드시 포함합니다.
- **상류 테스트.** 고정한 core 버전의 자체 테스트를 번들 설정 그대로 한 번 돌려 번들링이 동작을 바꾸지 않았는지 봅니다.
- **성능 계측.** 작은·중간·큰 예제에서 컴파일 시간, 수렴 시간, 드래그 프레임 시간의 중앙값과 p95를 쟽니다.
- **수동 검증.** 실제 브라우저, 한글 IME, 터치 기기는 자동 테스트가 대신하지 못합니다. 검증하지 않은 항목은 완료로 보고하지 않는 현재 원칙을 그대로 둡니다.

## Sources

- [penrose/penrose](https://github.com/penrose/penrose), `main` 커밋 `d46d92b`(2026-11-06). 이 문서의 줄 수·API 인용 기준입니다. 읽은 파일: [core/src/index.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/index.ts), [compiler/Style.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/compiler/Style.ts), [parser/Style.ne](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/parser/Style.ne), [engine/Autodiff.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/engine/Autodiff.ts), [engine/Optimizer.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/engine/Optimizer.ts), [lib/Functions.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/lib/Functions.ts), [utils/CollectLabels.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/utils/CollectLabels.ts), [utils/InteractionUtils.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/utils/InteractionUtils.ts), [renderer/Renderer.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/core/src/renderer/Renderer.ts), [editor/src/optimizer/worker.ts](https://github.com/penrose/penrose/blob/d46d92b/packages/editor/src/optimizer/worker.ts), [docs/ref/Interactivity.md](https://github.com/penrose/penrose/blob/d46d92b/packages/docs-site/docs/ref/Interactivity.md), [examples/src/registry.json](https://github.com/penrose/penrose/blob/d46d92b/packages/examples/src/registry.json).
- 번들 대상 아티팩트: npm `@penrose/core@3.3.1`(MIT, `gitHead edad5498…`, tarball integrity `sha512-QofvV/91aZg10nMMIR05asWkFLlDTmn+As5yo4DIpG4/eQDbeZZmJeAu/vC9hvjyOG8eomq0JXL5596KGAw+qQ==`). 의존성 목록과 라이선스는 이 아티팩트의 `package.json`을 기준으로 합니다.
- 첨부한 호스트 스냅샷: `AGENT.md`, `docs/repository-extensions.md`, `docs/extension-dependencies.md`, `docs/extension-creation.md`, `docs/incremental-computed.md`, `docs/render-loop.md`, `apps/playground/src/repository-plugins.ts`, `apps/playground/src/dev-extensions.ts`, `apps/playground/vite.config.ts`, `src-tauri/tauri.conf.json`, `deploy/vercel.json`, `packages/kernel/src/kernel-data.ts`, `packages/extensions/kite-studio/src/`, `packages/extensions/markdown-card/src/math-svg.ts`, `packages/extensions/text/src/layout.ts`. 스냅샷 안에 중첩된 이전 팩(`repomix-output-alid.xml`)은 제외하고 읽었습니다.
- 첨부한 익스텐션 스냅샷: `README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/dsl.md`, `src/index.ts`, `src/host.ts`, `src/schema.ts`, `src/dsl/compile.ts`, `extension.json`, `vite.config.ts`.
