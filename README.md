# EucliDraw Kite Studio 확장 (`jiwonme/euclidraw-kite-extension`)

alid(EucliDraw) 캔버스용 **Kite Studio** 확장(`kite.studio` 0.2.0)입니다. Domain · Substance · Style 세 DSL로 기하 도해를 선언하면, 확장이 직접 가진 **Wasm SIMD 솔버**(`crate-kite-solver`)가 구속 다양체 위로 정사영해 배치합니다. 점 · 선분 · 직선 · 반직선 · 원 · 호 · 다각형 · 각도 표시 · 라벨이 각각 **일급 캔버스 엔티티**(PRD의 패턴 A 서브그래프)라서 선택, 연결선, 클립보드, SVG 내보내기가 다른 도형처럼 동작합니다.

- 커널과 Rust 코어는 바꾸지 않습니다. 모든 기능은 공개 확장 계약으로 들어갑니다.
- 소스는 TypeScript와 Rust입니다. 배포물은 하나의 ESM(`dist/plugin.js`, Wasm을 base64로 내장, 런타임 import 없음)과 `alid.extension.json`입니다.
- 정본에는 의도(DSL)와 마지막 수렴 시드만 저장합니다. 화면 기하는 전부 계산 그래프가 파생합니다.

## 설치

1. alid → 확장 관리 → "저장소에서 설치"에 `jiwonme/euclidraw-kite-extension`을 입력합니다.
2. 설치기는 `alid.extension.json`의 `sha256`으로 `dist/plugin.js`를 검증합니다.
3. 선택 의존성: `core.select-suite`, `core.clipboard`, `sys.minibuffer`, `doc.markdown-math`, `vector.pen-suite`. 없으면 해당 기능만 꺼집니다(예: `vector.path`가 없으면 베이킹 불가, `markdown.card`가 없으면 `card` 라벨을 SVG 텍스트로 그림).

개발 중에는 `pnpm dev`로 감시 빌드 서버(`http://127.0.0.1:5174`)를 띄우고 alid의 "개발 중인 확장 연결"에 주소를 넣습니다.

## 사용법

- 도구 선반의 **Kite 도해** 또는 `M-x kite: insert-scope`로 예제(탈레스 정리)를 넣습니다. 스코프와 멤버가 한 번의 Undo로 생깁니다.
- 멤버를 선택하면 점·반지름 핸들이 나타납니다. 끌면 매 프레임 구속을 만족하는 위치로 투영되고, 놓을 때 한 번만 커밋됩니다(Undo 한 번으로 원복). Esc, 창 이탈, pointercancel은 아무것도 쓰지 않습니다.
- 드래그 중 **Shift**: 중점 · 원 위 · 일치 · 직교 스냅 후보를 배지로 보여 주고, Shift를 누른 채 놓으면 그 구속이 Substance에 추가됩니다(드래그 결과와 같은 Undo 단계).
- 멤버 1~3개를 선택하면 화면 HUD(Space 2B)에 가능한 구속 버튼이 뜹니다(예: 선분 둘 → ⊥ 직교, // 평행, = 등길이).
- 스코프를 선택하고 **Tri-DSL 편집기**(`kite: open-tri-editor`)에서 세 DSL을 고친 뒤 ⌘/Ctrl+Enter로 적용합니다. 새 기하는 약 180ms 동안 이전 상태에서 완화되며 보입니다(ScratchOverlay에서만; 문서는 한 번만 바뀜). Style `param`은 DialKit 슬라이더로 조절하며, 드래그 하나가 Undo 하나입니다.
- **솔버 진단** 패널(`kite: open-diagnostics`)은 자유도, 구속된 자유도(야코비안 수치 계수), 남은 자유도, 반복 횟수, 잔차 에너지 E(x), 과구속 구속 목록과 Quick Fix(소프트로 완화 / 삭제)를 보여 줍니다.
- 스코프 이동·크기 변경·회전은 프레임 변환만 바꾸므로 솔버를 다시 돌리지 않습니다.

### 주요 명령

| 명령 | 설명 |
|---|---|
| `kite: insert-scope` | 예제 스코프 추가 |
| `kite: add-point` / `add-segment` / `add-circle` / `add-label` | 선언 추가(부족한 인자는 미니버퍼에서 고름) |
| `kite: constrain` | 선택에 가능한 구속 고르기 |
| `kite: constrain-tangent` 등 7종 | 특정 구속, 중첩 `completingRead`로 인자를 차례로 선택 |
| `kite: relax-constraint` / `remove-constraint` | 과구속 Quick Fix |
| `kite: toggle-pin` | 점/원 자유도 고정 |
| `kite: reproject` | 현재 DSL과 시드에서 다시 수렴 |
| `kite: bake-to-vector` | 수렴 기하를 `vector.path` + `markdown.card`로 바꾸고 스코프 제거 |
| `kite: extract-subgraph` | 선택 멤버와 그 사이에 닫힌 구속만으로 새 스코프 |
| `kite: set-param` | Style `param` 값 변경 |

명령 요약에 한글 초성 별칭(예: 접선 `ㅈㅅ`)과 영문 별칭이 있어 미니버퍼 퍼지 검색에 걸립니다. P / S / C 키는 선택한 스코프 안에서 점 · 선분 · 원 빠른 작도 모드(`root.select.kite.studio:create`)를 엽니다.

## DSL 맛보기

```text
# Domain
type Point shape point
type Circle shape circle
predicate On(Point, Circle) = OnCircle
constructor MidpointOf(Point, Point) -> Point = Midpoint

# Substance
Point A = (120, 260) pin
Point B = (400, 260) pin
Point O = MidpointOf(A, B)
Circle c = center O through A
Point P = PointOn(c)
Label labThales = "∠APB = 90°" at bisector angP card

# Style
param k = 1 range(0.5, 3) step 0.1
point { r: 4.5 * k; fill: #2563eb }
@soft { compliance: 0.002 }
```

전체 문법은 [docs/dsl.md](docs/dsl.md), 설계와 PRD 대응표는 [docs/architecture.md](docs/architecture.md)를 보세요.

## 개발

```sh
pnpm install
pnpm build        # Wasm(변경 시) → dist/plugin.js → alid.extension.json
pnpm test         # 빌드 후 vitest (로컬 alid 체크아웃의 실제 커널 + Loro 코어)
pnpm test:rust    # crate-kite-solver cargo test
pnpm check        # typecheck + test + 커밋된 산출물 일치 확인
```

- Rust 툴체인은 `PATH`, `$KITE_RUST_TOOLCHAIN`, `$ALID/.toolchain`, `~/Workspace/alid/.toolchain` 순서로 찾습니다. wasm32-unknown-unknown 타깃이 필요합니다.
- `src/generated/kite-solver-wasm.ts`는 커밋됩니다. 크레이트 소스 해시가 같으면 Rust 없이도 빌드됩니다. 크레이트를 고쳤는데 툴체인이 없으면 빌드가 실패합니다.
- 통합 테스트는 `$ALID` 또는 `~/Workspace/alid`가 있어야 돌고, 없으면 건너뜁니다(커널은 npm에 없습니다).

## 측정값과 한계 (정직한 보고)

- Node + jsdom, 59개 개체 / 112개 구속에서 드래그 한 프레임의 **Wasm 솔브 중앙값 약 0.10ms**(p95 0.12ms), 오버레이 기록과 커널 재계산을 포함한 **전체 프레임 중앙값 약 7.2ms**(p95 9.3ms)를 측정했습니다. 실제 브라우저의 120fps나 GC 0회는 측정하지 않았으므로 주장하지 않습니다.
- 실제 브라우저, 실제 IME(한글 조합) 입력, 터치 기기는 수동 검증하지 않았습니다. IME 가드는 합성 이벤트(`isComposing`, keyCode 229, compositionend 후 16ms)로만 테스트했습니다.
- Space 2B 팝오버는 `@alid/react`의 `NodeAnchoredPopover`가 아니라 확장 자체의 HUD 요소입니다(React 의존성 없이 단일 번들을 유지하기 위해).
- 패널 열기 명령은 호스트의 `workspace.layout`/`ui.workbench`가 `openPanel`을 제공할 때만 동작합니다.
- 붙여넣은 스코프는 읽기만으로 올바르게 그려지지만(추가 쓰기 0회), 저장된 `entityBindings`/`convergedSeeds` 키는 다음 Kite 커밋 때 새 id로 갱신됩니다.
- XPBD는 비볼록 구속에서 국소해에 머물 수 있습니다. 시드가 없는 자유도만 결정적 후보 탐색(`discrete_init`)으로 배치하고, 기존 기하는 흔들지 않습니다.

## 라이선스

[LICENSE](LICENSE)
