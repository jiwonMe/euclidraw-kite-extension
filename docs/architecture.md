# 아키텍처와 PRD v1.0.0 대응

## 1. 패턴 A: 스코프 + 일급 멤버

| 엔티티 | 정본 어스펙트 | 역할 |
|---|---|---|
| 스코프 | `kite.scope`, `core.transform`, `core.bounds`, `core.stacking` | 세 DSL, `entityBindings`, `convergedSeeds`, `solverConfig`. 프레임 상자만 그리고, DSL 오류 시 배지를 그림 |
| 멤버 | `kite.member`, `core.stacking` (+ `markdown.card`, `core.transform/bounds` — `card` 라벨만) | `scopeId`(cascade-hide), `substanceId`, `primitiveKind`, `pinnedDofs`, `slackWeight` |

멤버의 기하는 저장하지 않습니다. `layout: true`라서 `computed.kite.member`가 `computed.layoutBounds`로 이어지고, select-suite와 connector-wire는 이를 일반 상자로 봅니다. 선택 기여는 정확한 히트 테스트(점·선·원·호·다각형·라벨)를 제공하고 `canTransform: false`로 기본 이동을 막습니다. 멤버는 Kite 핸들로만 움직입니다.

`card` 라벨은 `markdown.card` 멤버(MathJax는 `doc.markdown-math`가 담당)이며, 그 상자는 Kite가 **자기 커밋 안에서만** 씁니다. 읽기 경로에서는 쓰지 않습니다.

## 2. 파생 파이프라인 (PRD §4)

```
kite.scope (DSL) ─────────▶ computed.kite.compiledVm(scope)
                                     │  (resolveBindings: 멤버의 scopeId가 진실)
kite.scope.convergedSeeds ───────────┼──▶ computed.kite.solvedGeometry(scope)
ScratchOverlay(드래그·완화·param) ───┘              │
core.transform / core.bounds (프레임) ──────────────┤
                                                     ▼
                       computed.kite.member(member) → computed.layoutBounds → effectiveBounds
```

`solvedGeometry`의 세 모드:

| 모드 | 조건 | 동작 |
|---|---|---|
| Cold | 모든 자유도에 유효한 시드 | 시드를 쓰고 `project`만(반복 0회). 열기·읽기·이동·크기·회전·내보내기 |
| Interactive | 이 스코프가 드래그 중 | 드래그 세션이 이미 투영한 오버레이 시드를 그대로 사용 |
| Dirty | 시드 없는 자유도 존재 | `discrete_init` 후보 탐색 → XPBD → 하드 다양체 투영 |

시드는 DSL 캔버스 중심 기준, 큰 변의 절반 = 1로 정규화하고 1e-9로 반올림합니다. 프레임은 균일 상사변환(`frameFor`)이라 스코프 변형은 각도를 보존하고 재해를 요구하지 않습니다.

## 3. 솔버 (`crate-kite-solver`)

- `vm.rs`: TS 컴파일러가 만든 `i32` 테이프 + `f64` 상수 풀을 한 번 검증해 위상(DOF 배치, 행 수, 프리미티브 표)을 만듭니다. 모든 참조를 경계 검사합니다. Style/Substance 수식은 스택 바이트코드로 컴파일되어 연료(256) 제한 VM `kite_eval_expr`에서 평가됩니다. 문서 코드는 JS로 실행되지 않습니다.
- `xpbd_manifold.rs`: 해석적 그래디언트의 XPBD. 하드 행 α=0, `soft` 행과 포인터 스프링 α>0. 서브스텝마다 Gauss–Seidel 4회. `project_manifold`는 포인터 스프링을 끄고 하드 행만 잔차 1e-6까지 투영합니다. 구속 13종(Distance, Coincident, Midpoint, OnCircle, OnLine, Perpendicular, Parallel, EqualLength, Horizontal, Vertical, Tangent, Radius, AngleAt) + Fixed.
- `discrete_init.rs`: splitmix64 기반 결정적 후보(원래 배치, 지터, 중심 대칭)에서 짧게 완화해 최저 에너지를 고르고 워밍 스타트합니다.
- `memory_view.rs`: 고정 레이아웃 버퍼(PRD §4.2). JS는 `memory.buffer`가 바뀔 때마다 뷰를 다시 만듭니다.
- `simd.rs`: wasm32에서 `f64x2`(`simd128`), 네이티브 테스트에서는 같은 IEEE 결과의 스칼라. 빌드 산출물에 `f64x2.add/sub/mul/splat` 명령이 실제로 들어 있음을 확인했습니다.

## 4. 조작 (PRD §5, §7.1)

- 핸들은 select-suite 기즈모 레지스트리에 우선순위 45로 등록됩니다. 누르면 `root.select.kite.studio:manipulate`로 전이합니다.
- 포인터 이벤트는 목표만 기록합니다. 해는 호스트의 단일 프레임 래치(`canvas.frames`)에서 `step(maxSubstepsPerFrame)` → `projectManifold(400, 1e-6)` 순으로 계산하고 `ScratchOverlay`에 시드를 씁니다. Space 2A는 같은 프레임에서 그 **뒤에** 그립니다(한 프레임 지연 없음).
- 다중 선택은 최대 8개 핀으로 함께 끕니다. 고정 자유도와 `pinnedDofs`는 역질량 0.
- Shift 스냅: 드래그 전용 위상(`withTemporary`)에 임시 구속 하나를 붙여 미리 보여 주고, Shift를 누른 채 놓으면 해당 문장을 Substance에 추가합니다(드래그와 같은 트랜잭션).
- 놓기: 핀 제거 → 20회 폴리시 → 하드 투영 → `commitDrag` 한 번.
- 취소: Esc, blur, pointercancel, lostpointercapture, compositionstart, HSM 이탈.
- IME: `isComposing`, keyCode 229, `Process`, compositionend 후 16ms 동안 키를 무시합니다.

DSL·명령 편집은 정본에 수렴 결과를 바로 쓰고, 화면만 180ms 동안 `1 − e^(−5t)`로 이전 상태에서 완화합니다(`relax-animation.ts`, ScratchOverlay).

## 5. 렌더링 (PRD §6)

| Space | 구현 |
|---|---|
| 1 (문서) | `renderSvg` 순수 SVG. 직각 표시, 등길이 틱, 화살표, 각도 호 모두 계산된 path. 화면과 `compileToPureSvg` 공용 |
| 2A (월드 기즈모) | HUD SVG: 자취 가이드(#6A6CD9 점선; 원·직선·탈레스 원), 구속 배지(// ⊥ = T ○ …), 📌 핀, 과구속 히트맵(#FF4800), 편집기 커서 강조, 스냅 배지 |
| 2B (스크린 HUD) | 선택 위에 고정된 구속 버튼 막대. `data-canvas-ui`. 확장 자체 HUD 요소이며 `@alid/react` `NodeAnchoredPopover`는 쓰지 않음 |

## 6. 상호 운용 (PRD §7)

- **select-suite**: 선택 기여 + 기즈모 + HSM 슬롯.
- **connector-wire**: 멤버 EntityId의 `layoutBounds`가 매 프레임 갱신되므로 연결선이 따라갑니다.
- **clipboard**: 스코프+멤버 전체 복사는 core.clipboard가 id를 원자적으로 재매핑합니다. `resolveBindings`가 멤버의 `scopeId`로 바인딩을 복원하고 옛 키로 시드를 찾으므로 추가 쓰기 없이 같은 기하가 그려집니다. 부분 복사는 `kite: extract-subgraph`(`inducedSubgraph`)로 새 독립 스코프를 만듭니다.
- **bake-to-vector**: 수렴 기하를 `vector.path`(호는 ≤90° 3차 베지어)와 `markdown.card`로 바꾸고 스코프·멤버를 같은 트랜잭션에서 제거합니다.
- **minibuffer**: 모든 기능이 명령이며 한글 초성·영문 별칭을 가집니다. `constrain-*`는 Domain 술어 시그니처로 후보를 좁힌 중첩 `completingRead`를 엽니다.

## 7. 워크벤치 (PRD §8)

- `kite.panel.tri-editor`: 탭 3개(네이티브 textarea), 로컬 초안, ⌘/Ctrl+Enter 적용, 진단 줄 표시, 캔버스↔편집기 양방향 강조, Style `param` DialKit 슬라이더(드래그 중 ScratchOverlay 미리보기, 놓을 때 커밋 1회, Esc 취소).
- `kite.panel.diagnostics`: Total/Constrained/Remaining DOF(Wasm 수치 야코비안 계수), Iterations, E(x), max |C|, 과구속 목록과 Quick Fix.

## 8. 테스트 (PRD §9)

| 파일 | 내용 |
|---|---|
| `zero-write-on-read.test.ts` | 다른 피어가 열어 읽기·페인트·내보내기 시 커밋 0, Cold 모드 반복 0; 스코프 변형이 재해를 부르지 않음; 피어 간 SVG 동일 |
| `manifold-drag-undo.test.ts` | 매 프레임 원 위 유지, 드래그 중 문서 불변, 커밋 1회, Undo 1회로 원복; Esc·IME; Shift 승격; 다중 선택; 59개체/112구속 성능 측정 |
| `headless-svg-determinism.test.ts` | 9종 프리미티브 순수 벡터, 이스케이프, z순서, 반복·피어 바이트 동일, DSL 오류 배지 |
| `interop.test.ts` | 선택 기하, 레이아웃 경계, 클립보드 복제, 서브그래프 분리, 베이킹 Undo, 카드 라벨, 중첩 completingRead, 초성 별칭, Space 2A/2B |
| `crate-kite-solver` (cargo) | 테이프 검증, 행 수, 연료, 원 위 투영, 직교·등길이, 결정성, FFI 왕복, 야코비안 계수 |

모두 로컬 alid 체크아웃의 실제 커널 + Loro Wasm 코어에서 빌드된 번들로 실행합니다. 실제 브라우저·IME·터치는 수동 검증하지 않았습니다.
