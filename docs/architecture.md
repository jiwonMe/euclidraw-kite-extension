# 아키텍처 — Penrose Studio

## 1. 엔티티 모델

| 엔티티 | 정본 어스펙트 | 역할 |
|---|---|---|
| 스코프 | `penrose.scope`, `core.transform`, `core.bounds`, `core.stacking` | trio, `variation`, `topologyDigest`, `varyingValues`, `pins`, `entityBindings`, `solverConfig`. 다이어그램 전체를 한 레이어로 그립니다. |
| 멤버 | `penrose.member`, `core.stacking` | `scopeId`(cascade-hide), `ownerKey`, `pinned`, `label`. 선택 기하와 `layoutBounds`만 제공합니다. |

멤버는 자기 SVG를 내지 않습니다. 페인트는 스코프 하나가 Penrose 레이어 순서대로 담당하고, 다른 캔버스 객체는 다이어그램 전체의 앞이나 뒤에만 놓입니다.

## 2. 파생 파이프라인

```
penrose.scope (trio · variation)
        │
        ▼
computed.penrose.compiled ── owners, canvas, 자유 입력, 이동/크기 가능 도형, 진단
        │
        ▼
computed.penrose.layout ─── Shape[] · owner bounds · MathJax SVG · 에너지
        │
   ┌────┴─────────────┐
   ▼                  ▼
스코프 renderSvg   computed.penrose.member → computed.layoutBounds
```

- `compiled`는 워커의 컴파일 결과를 캐시에서 동기로 읽습니다.
- `layout`은 워커가 계산한 `Shape[]`(평면 데이터)와 라벨 SVG를 캐시에서 읽습니다.
- 멤버 기하는 `layout.bounds[ownerKey]`를 스코프 프레임으로 월드에 사상한 값입니다.
- 프레임 이동·크기·회전은 `core.transform`/`core.bounds`만 바꾸므로 컴파일·최적화를 다시 돌리지 않습니다.

### 모드

| 모드 | 조건 | 동작 |
|---|---|---|
| Cold | `topologyDigest` 일치 + `varyingValues` 존재 | 컴파일 후 `computeShapes`만 (최적화 0스텝) |
| Dirty | 새 trio·시드 없음 | 컴파일 + 최적화 |
| Interactive | 드래그 중 | 끈 입력을 목표값으로 고정 → `stepTimes(dragSteps)` → 재핀 |

정본 쓰기는 DSL 적용, 드래그 놓기, 재표본, 핀, 베이킹에서만 일어납니다.

## 3. 워커

별도 파일을 둘 수 없으므로 워커 코드를 문자열로 번들에 내장하고 Blob URL로 띄웁니다.

- 메시지: `compile`, `layout`, `drag`, `converge`, `resample`, `dispose`.
- 세션은 스코프 ID로 유지되며 `State`(함수 포함)는 워커를 떠나지 않습니다.
- 응답은 요청 ID로 짝지어지고, 낡은 컴파일 결과는 digest 비교로 버립니다.
- 엔진 결과가 도착하면 메인은 `invalidateComputed()`로 Computed를 다시 평가합니다. 이 호출은 현재 커널에서 모든 셀을 무효화하므로 비용은 전역입니다(P0에서 측정).
- Node 테스트에는 Web Worker가 없으므로 `globalThis.__PENROSE_ENGINE_FACTORY__`로 인라인 엔진을 주입합니다.

## 4. 라벨과 결정성

- Text: DOM 없이 고정 Helvetica AFM 표로 폭·높이·ascent·descent를 계산합니다.
- Equation: `mathjax-full`의 `liteAdaptor` + SVG 출력, `fontCache: 'none'`. 경로 글리프라 플랫폼 독립적입니다.
- 측정 결과는 `insertPending()`으로 최적화 입력에 반영됩니다.
- `topologyDigest` = FNV-1a 64(trio, variation, core 3.3.1, `labels:v1`). 이 값이 다르면 저장된 입력을 쓰지 않습니다.
- 피어 간 SVG 바이트 동일성은 렌더러가 MathJax 경로와 고정 메트릭만 쓰기 때문에 성립합니다. `<text>`의 실제 글리프는 플랫폼 폰트를 따르므로 시각적 폭은 미세하게 다를 수 있습니다.

## 5. 렌더링

`src/penrose/render.ts`는 순수 함수입니다.

- Penrose 캔버스(중심 원점, y축 위)를 SVG 화면 좌표(`w/2 + x`, `h/2 - y`)로 옮깁니다.
- 셰이프 11종: Circle, Ellipse, Equation, Image, Line, Path, Polygon, Polyline, Rectangle, Text, Group.
- 화살촉은 `<marker>` 대신 경로로 직접 그립니다(같은 arrowhead 정의, `markerUnits=strokeWidth` 스케일).
- Group 클립은 스코프별 유일 ID의 `<clipPath>`입니다.
- Equation은 사전 렌더된 MathJax SVG를 정화해 삽입합니다.
- Image는 `data:` URI만 허용하고, 인라인 SVG는 script·이벤트 속성을 제거합니다.
- 패스스루 속성은 허용 목록으로 거르고 모든 문자열을 이스케이프합니다.

## 6. 조작

- 핸들은 `state.interactivityInfo`에서 **자유 최적화 입력**을 가진 모든 도형에 항상 생깁니다(선택과 무관, core의 `isTranslatable`보다 넓은 판정). 핀이 걸린 입력, 읽기 전용 스코프, 식으로 계산된 속성에는 없습니다.
- 기즈모는 호스트 HUD의 화면 픽셀 오버레이에 그립니다. `worldToScreen`은 클라이언트 좌표를 돌려주므로 HUD의 `getBoundingClientRect()` 원점을 빼서 HUD-로컬로 그립니다. 프레임은 매번 정본 `core.transform`/`core.bounds`에서 계산하고, 스코프 캔버스(±w/2, ±h/2) 밖 좌표는 그리지 않습니다. 문서 SVG에 포함되지 않으므로 내보내기에 새지 않습니다.
- 이동 핸들은 `center`/`start`/`end`/`points` 입력을, 크기 핸들은 `r`/`rx`/`ry`/`width`/`height`를 움직입니다.
- 드래그 중에는 포인터 목표만 기록하고, 프레임마다 워커에 절대 입력값을 보냅니다.
- 워커는 `stepTimes(dragSteps)` 후 끈 입력을 목표값으로 되돌립니다(재핀). 주변 도형은 근사 최적화 상태입니다.
- 놓을 때 0스텝 재핀 → `varyingValues` 한 트랜잭션 커밋 → Undo 1회로 원복.
- 취소(Esc·blur·pointercancel)는 저장된 입력으로 레이아웃만 되돌립니다.

## 7. 패널

- `penrose.panel.tri-editor`와 `penrose.panel.diagnostics`는 `navigation.group = document`로 활동 레일에 노출됩니다.
- 호스트는 패널 열기를 `ui.shell`로 자기 UI에만 제공하고, 이 서비스는 확장 컨텍스트에서 `PhantomDependency`로 막힙니다. 따라서 확장 명령은 열기를 시도한 뒤 실패하면 레일 위치를 안내합니다.

## 8. 호스트 변경 없음

- 설치 API 2의 공개 계약만 씁니다.
- TeX는 호스트에 노출되지 않으므로 MathJax를 번들에 포함합니다(워커 크기 2.88 MiB).
- 텍스트 측정 서비스도 없으므로 고정 메트릭 표를 씁니다.
- 비동기 Computed 반영은 `invalidateComputed()`로 이미 가능합니다.

## 8. 한계

- 페널티 기반 최적화라 하드 구속이 근사적으로만 만족됩니다.
- `Path`·`Group`은 기즈모가 없고, `Image`는 외부 URL을 허용하지 않습니다.
- 레지스트리 191개 전체 회귀는 아직 없습니다.
- 실제 브라우저의 워커 왕복 지연, IME, 터치를 검증하지 않았습니다.
