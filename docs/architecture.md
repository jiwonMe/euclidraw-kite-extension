# 아키텍처와 PRD 대비 구현 범위

이 문서는 PRD(`@alid/ext-kite` v1.0.0)의 각 절이 이 저장소에서 어떻게 구현되었는지, 그리고 의도적으로 다른 부분을 기록합니다.

---

## 1. 패턴 A: 스코프 + 일급 멤버

| 정본 | 필드 | 코드 |
| --- | --- | --- |
| `kite.scope` | `schemaVersion`, `domainDsl`, `substanceDsl`, `styleDsl`, `entityBindings`, `convergedSeeds`, `solverConfig` | `src/types.ts`, `src/aspects.ts`, `src/defaults.ts` |
| `kite.member` | `scopeId`, `substanceId`, `primitiveKind`, `pinnedDofs`, `slackWeight` | `src/types.ts`, `src/aspects.ts` |

- 스코프는 `core.transform` · `core.bounds` · `core.stacking`을 함께 가집니다.
- 멤버는 `core.transform`을 저장하지 않습니다. `layout: true`와 `derive()`가 `computed.layoutBounds`를 공급합니다.
- `kite.member.scopeId`는 `cascade-hide` 참조 정책입니다. 스코프를 삭제해도 멤버 정본은 남고, 투영에서만 숨겨집니다.
- 멤버 선택 기하는 `selection.getBounds`/`hitTest`/`intersectsRect`로 등록됩니다. `canTransform`은 `false`라서 기본 이동 기즈모가 솔버를 우회하지 않습니다.

### 생성

`insertDiagram()`은 하나의 `withHistory` 그룹 안에서 다음을 한 배치로 씁니다.

1. 스코프의 `core.transform`, `core.bounds`, `core.stacking`
2. `kite.scope` (기본 DSL + 바인딩 + 수렴 시드)
3. 각 멤버의 `kite.member`와 `core.stacking`

`canvas.creation`은 단일 엔티티만 만들 수 있어 사용하지 않습니다. 대신 호스트의 공개 `canvas.surface`/`canvas.interaction`에서 화면 중앙을 읽고 `world.applyCanonicalTransaction`을 한 번 호출합니다.

### DSL 적용

`applyDsl()`은 다음 순서로 동작합니다.

1. 새 DSL을 순수 컴파일하고 오류가 있으면 **쓰기 전에** 거부합니다.
2. `syncMembers()`가 유지할 바인딩·새 멤버·삭제할 멤버를 계산합니다.
3. 새 바인딩으로 다시 컴파일하고 240회 초기 수렴합니다.
4. `convergedSeeds`, `entityBindings`, 세 DSL, `solverConfig`를 멤버 생성/삭제와 함께 한 배치로 씁니다.

`repair-bindings`는 스코프 복사 등으로 깨진 `substanceId ↔ EntityId` 맵을 실제 멤버에서 재구성합니다.

---

## 2. 계산 그래프와 제로카피 경계

PRD는 `computed.kite.compiledVm`, `computed.kite.solvedGeometry`를 별도 노드로 두라고 제안합니다. 외부 확장은 호스트의 `computed.layoutBounds`/`computed.effectiveBounds` 같은 이름을 덮어쓸 수 없고, 새 `computed.*` 노드를 전역으로 등록하면 다른 문서·확장과 수명이 섞입니다. 이 저장소는 대신 **`computed.kite.member` derive 내부의 순수 캐시**로 같은 3단계를 구현합니다.

```text
[kite.scope DSL] ──(DSL 문자열 변경 시에만)──▶ compileCached() ──▶ CompiledScope
                                                              │
[kite.scope.convergedSeeds] ──────────────────────────────────┼──▶ solveScope() ──▶ SolvedState
                                                              │
[ScratchOverlay.convergedSeeds] ──────────────────────────────┘
                                                                     │
                                                                     ▼
                                                     projectMember() ──▶ DerivedGeometry
                                                                     │
                                                                     ▼
                                          computed.layoutBounds / computed.effectiveBounds
```

- `compileCached()`는 `domainDsl + substanceDsl + styleDsl`을 키로 LRU 캐시합니다. DSL이 바뀌지 않는 프레임에서는 파싱·위상 구성이 0회입니다.
- `solveScope()`는 스코프 정본 객체, 시드 객체, 멤버 핀 시그니처를 키로 결과를 캐시합니다.
- 시드가 현재 DOF 레이아웃과 맞으면 `iterations: 0`으로 값만 투영합니다. `LoroDoc` 쓰기는 없습니다.
- 시드가 없거나 길이가 맞지 않으면 선언 좌표에서 180회 초기 수렴합니다. 이 역시 메모리에서만 일어나며, 다음 명시적 적용/드래그 전까지 정본을 쓰지 않습니다.
- **Wasm 경계는 아직 없습니다.** `SolvedState.values`는 JS `Float64Array`입니다. PRD의 `world_prim_buf`·`constraint_stress_buf`·Wasm 선형 메모리 뷰는 향후 Rust 커널로 대체할 자리이며, 현재 구현은 JS 힙을 씁니다. 120fps·0-GC를 주장하지 않습니다.

---

## 3. 솔버

`src/solver/solve.ts`는 다음 DOF 레이아웃을 씁니다.

| 개체 | DOF |
| --- | --- |
| 점 | `x`, `y` (2) |
| 원 | `r` (1). 중심은 별도 점 참조 |
| 선분/직선/반직선 | 자체 DOF 없음. 두 끝점 참조 |
| 호 | 자체 DOF 없음. 중심 점 참조 + 고정 반지름/각도 |
| 다각형/각도/라벨 | 끝점·중심·앵커 참조 |

한 패스는 다음 순서입니다.

1. **소프트 핀**: 드래그 중 마우스 목표로 자유 DOF를 `strength`만큼 당깁니다.
2. **Gauss-Seidel 투영**: 하드/소프트 구속을 순서대로 투영합니다.
3. **감쇠**: `solverConfig.damping`을 각 투영 스케일에 반영합니다.

- 핀 고정은 역질량 0으로 처리합니다. 점이 핀 고정이면 `OnCircle`은 점 대신 원의 반지름을 조정합니다.
- `Midpoint`, `Perpendicular`, `Parallel`, `EqualLength`, `AngleAt`, `Tangent`는 해석적 투영을 사용합니다. 유한 차분은 진단 랭크 계산에만 사용합니다.
- `Shift` 스냅은 현재 해에서 `Midpoint` / `Perpendicular` / `OnCircle` 후보를 찾고, 후보가 있으면 임시 구속을 넣어 한 번 더 수렴시킵니다.
- `finish()`는 핀을 제거하고 90회 폴리시한 뒤 시드를 만듭니다. 드래그 전체는 `pointerup`의 단일 `withHistory` 그룹으로 기록됩니다.

진단 패널의 "구속 DOF"는 수치 야코비안의 수정 Gram-Schmidt 랭크 추정입니다. 220 DOF/구속을 넘으면 비용을 제한하기 위해 방정식 수 기반 근사로 대체하며, 이는 **추정치**입니다.

---

## 4. 조작 상태 머신과 입력

- `KiteManipulator`는 `canvas.active-tool-surface`의 `selection.stateMachine`에 `root.select.kite.studio:manipulate` 자식 상태를 마운트합니다.
- 선택된 스코프/멤버의 점·원 반지름에 `priority: 45` 기즈모를 등록합니다. select-suite의 리사이즈(10)·회전(5)보다 우선합니다.
- `canvas.active-tool-surface`가 없는 호스트에서는 `canvas.surface` + `canvas.interaction` + `canvas.selection`으로 폴백하고, 포인터 히트 테스트로 직접 드래그합니다.
- 포인터 이동 이벤트는 목표 좌표만 저장하고, 실제 솔버는 `canvas.frames`의 단일 프레임 콜백에서 돕니다.
- `ScratchOverlay`는 스코프의 `convergedSeeds`만 패치합니다. 멤버 렌더는 미리보기 뷰에서 새 시드를 읽습니다.
- `pointerup`은 `commitScopePatch()`로 `convergedSeeds`(+승격 시 `substanceDsl`)를 한 번 씁니다. `Escape`, `pointercancel`, 창 blur, `lostpointercapture`는 스크래치만 지웁니다.
- HUD에는 선택 점의 1차원 다양체 궤적(원/수평/수직/거리 원), 스냅 배지, 과응력 글로우가 표시됩니다.

### IME

- `compositionstart`/`compositionend` 사이, `isComposing`, `keyCode === 229`, `key === 'Process'`, `compositionend` 후 16ms 동안 `Escape`를 무시합니다.
- 캔버스 도구 입력은 `canvas.tool-input` 등록표가 있으면 그쪽에서 먼저 보호합니다.
- 패널 텍스트영역은 네이티브 Undo/클립보드를 유지하고, `Ctrl/⌘+Enter`만 적용 단축키로 씁니다.

---

## 5. 렌더링과 출판

- 멤버는 `renderMode: 'vector'`에 가깝게 `renderSvg`만 제공합니다(DOM 아일랜드 없음).
- `renderSvg`는 세계 좌표의 `DerivedGeometry`만 읽습니다. DOM 측정, `ResizeObserver`, `<foreignObject>`가 없습니다.
- 각도 표기·직교 사각형·등길이 틱·핀 링은 모두 계산된 `<path>`/`<circle>`/`<line>`입니다.
- 라벨은 현재 순수 SVG `<text>`입니다. `markdown-card`의 MathJax SVG를 합성하는 경로는 아직 없습니다.
- 색상은 허용 목록으로 검증하고, 사용자 텍스트는 XML 이스케이프합니다.
- 스트레스가 높은 멤버는 주황색 점선 글로우를 그립니다(과구속 히트맵의 최소 구현).

### Space 매핑

| PRD | 구현 |
| --- | --- |
| Space 0 그리드 | 호스트의 배경 그리드 사용. Kite 전용 그리드는 없음 |
| Space 1 통합 씬 | 멤버별 벡터 `renderSvg`, `core.stacking` 순위 |
| Space 2A 기즈모 | HUD SVG 궤적, 스냅 배지, 멤버 내 직교/틱/핀 표식 |
| Space 2B HUD | 멤버 `selection-bar` 액션과 미니버퍼 구속 명령. `NodeAnchoredPopover` 전용 구현은 없음 |

---

## 6. 기존 확장과의 상호운용

- **select-suite**: 멤버는 `canTransform: false`와 우선순위 기즈모로 솔버 드래그를 유지합니다. 스코프는 일반 박스처럼 이동·리사이즈·회전합니다.
- **connector-wire**: 멤버의 `computed.layoutBounds`가 매 프레임 갱신되므로 화살표 끝점을 멤버 `EntityId`에 바인딩할 수 있습니다. 실제 라우팅 통합은 호스트에서 수동 확인해야 합니다.
- **clipboard**: 스코프+멤버를 함께 복사하면 새 `EntityId`와 기존 바인딩이 어긋납니다. `Kite: 바인딩 복구`로 재매핑합니다. 부분 서브그래프 추출·유도 부분그래프 복사는 미구현입니다.
- **minibuffer**: `sys.minibuffer`의 `completingRead`로 거리·구속 후보를 고릅니다. 없으면 선택 기반 기본값으로 동작합니다.
- **markdown-card**: 라벨 수식 통합은 미구현입니다.
- **vector-path**: `기하 고정`은 구속을 제거하고 좌표를 핀으로 고정하지만 `vector.path` 엔티티로 변환하지 않습니다.

---

## 7. 패널

### `kite.panel.tri-editor`

- `inspectorFor: kite.scope`이므로 스코프 선택 시 인스펙터에 나타납니다.
- Domain/Substance/Style 탭, 줄 번호 거터, 실시간 컴파일 오류, `Ctrl/⌘+Enter` 적용.
- 선택된 멤버의 substanceId가 포함된 Substance 줄을 "연관 구문"으로 보여 주고 클릭하면 해당 줄로 이동합니다.
- Style 탭의 숫자 필드를 슬라이더로 편집합니다. 슬라이더는 Style DSL 텍스트만 바꾸고, 적용 전에는 정본을 쓰지 않습니다.

### `kite.panel.diagnostics`

- 총 DOF, 구속 DOF(수치 랭크 추정), 잔여 DOF, 잔차, 반복 수.
- 잔차가 큰 구속 목록과 Quick Fix(다시 수렴/기하 고정).
- 모든 조회는 읽기 전용이며 정본을 쓰지 않습니다.

---

## 8. PRD 단계별 상태

| PRD 단계 | 상태 | 비고 |
| --- | --- | --- |
| Phase 1: 정본 스키마·읽기/출판 | 구현 | `kite.scope`/`kite.member`, 시드 기반 0회 반복 투영, 순수 SVG |
| Phase 2: Wasm XPBD·실시간 드래그 | 부분 구현 | JS XPBD/다양체 정사영·ScratchOverlay·단일 Undo. Wasm SIMD 커널 없음 |
| Phase 3: 기즈모·위상 스냅·상호운용 | 부분 구현 | 궤적·배지·Shift 스냅·`layoutBounds` 연동. 완전한 팝오버/클립보드 리매핑 없음 |
| Phase 4: 워크벤치·미니버퍼 | 부분 구현 | Tri-DSL/진단 패널, 선택 기반 구속, `completingRead` 거리 선택. 한·영 초성 검색은 미니버퍼 자체 기능에 위임 |

---

## 9. 검증 경계

`pnpm test`는 35개 테스트로 DSL·솔버·기하·플러그인 계약·번들 해시를 검증합니다. 다음은 자동 테스트가 아닙니다.

- 실제 EucliDraw 브라우저에서의 설치·선택·드래그·Undo·SVG 내보내기
- 실제 한글 IME 조합 중 Escape/Enter 동작
- 1,000개 엔티티·120fps·0-GC 성능
- `connector-wire` 실제 라우팅, `markdown-card` 수식 합성
- 다중 사용자 Loro 동시 편집

완료 보고에서는 실행한 명령과 결과, 수동 확인 여부, 미검증 범위를 구분합니다.
