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
- trio를 적용했을 때 Penrose canvas 크기가 바뀌면(예: 1000×1000) 스코프의 `core.bounds`를 캔버스 크기로 맞추고 중심을 유지합니다. 그렇지 않으면 도해가 작은 프레임에 눌려 찌그러지고 잘립니다.

### 모드

| 모드 | 조건 | 동작 |
|---|---|---|
| Cold | `topologyDigest` 일치 + `varyingValues` 존재 | 컴파일 후 `computeShapes`만 (최적화 0스텝) |
| Dirty | 새 trio·시드 없음 | 컴파일 + 최적화 |
| Interactive | 드래그 중 | 현재+직전 스테이지를 합친 드래그 스테이지에서 끈 입력을 목표값으로 고정 → 프레임 예산(기본 10ms)까지 재수렴 → 재핀 |

정본 쓰기는 DSL 적용, 드래그 놓기, 재표본, 핀, 베이킹에서만 일어납니다.

## 3. 워커

별도 파일을 둘 수 없으므로 워커 코드를 문자열로 번들에 내장하고 Blob URL로 띄웁니다.

- 메시지: `compile`, `layout`, `drag`, `converge`, `resample`, `dispose`.
- 세션은 스코프 ID로 유지되며 `State`(함수 포함)는 워커를 떠나지 않습니다.
- 응답은 요청 ID로 짝지어지고, 낡은 컴파일 결과는 digest 비교로 버립니다.
- 엔진 결과가 도착하면 메인은 `invalidateComputed()`와 `surface.requestRender()`로 Computed와 화면을 함께 갱신합니다. 전자는 현재 커널에서 모든 셀을 무효화하므로 비용은 전역입니다(P0에서 측정).
- 새로고침 직후처럼 워커가 첫 요청을 처리하지 못하는 경우를 위해 compile은 동기 예외·전송 실패를 재시도(최대 2회)하고, 8초 동안 응답이 없으면 타임아웃으로 표시합니다. 성공·실패 모두 `requestRender`를 호출하므로 다른 정본 쓰기(복제 등) 없이 스스로 복구됩니다.
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
- Group의 멤버는 배열이 아니라 `ShapeListV` 값(`shape.shapes.contents`)에 들어 있고, `clipPath`는 `ClipDataV`(`NoClip | Clip`)이며 `clip(x)`는 도형 **하나**를 담습니다. `Array.isArray(shape.shapes)`로 검사하면 그룹 내용이 통째로 사라지므로(구현 초기 버그) 항상 `contents`를 풀어 읽습니다. 그룹 안의 도형도 소유자·라벨·투영 핸들 수집 대상입니다.
- Image의 `href`는 세 가지를 지원합니다: `data:image/svg+xml`(URL 인코딩 또는 `;base64`), 그리고 Penrose 공식 예제가 스타일에서 상대 이름으로 참조하는 소형 SVG 에셋(`ball-shading.svg`, `node-shading.svg`, `background.svg`, `radial-gradient.svg`, …)을 `assets.ts`의 basename 표로 해석합니다. 그 외 외부 URL은 로드하지 않습니다.
- 인라인 SVG는 `<defs>`·`<radialGradient>`·`<linearGradient>`를 그대로 살려 **그라디언트가 동작**합니다. 원본의 `viewBox`를 유지해야 아트워크 좌표가 요청한 width/height로 스케일됩니다(지우면 100×100 에셋이 100px 사각형으로만 그려집니다).
- 같은 아트워크를 여러 번 인라인하므로 인스턴스마다 id와 class에 색 이름 기반 접두사를 붙입니다. 그러지 않으면 모든 복사본이 문서의 첫 `url(#gradient)` 정의와 `<style>` 규칙을 공유합니다. script·이벤트 속성·`http(s)` 참조는 제거해 내보낸 문서가 네트워크를 타지 않습니다.
- `style` 패스스루(예: `style: "filter:blur(5px);"`)를 허용하되 `javascript:`·`expression()`·`@import`·원격 `url()`은 제거합니다.
- Equation은 MathJax가 만든 그림을 인라인 `<svg>`로 넣습니다. MathJax는 `<mjx-container>`(비 SVG 커스텀 엘리먼트)로 감싸는데, 이것을 그대로 장면에 넣으면 아무것도 칠해지지 않으므로 내부 `<svg>`만 남깁니다. 글리프는 `fill="currentColor"`로 칠해지므로 도형의 `fillColor`를 CSS `color`로도 전달합니다.
- 패스스루 속성은 허용 목록으로 거르고 모든 문자열을 이스케이프합니다.
- 스코프 본문은 `overflow="hidden"`인 중첩 `<svg>` 뷰포트(캔버스 크기)로 감싸 도해가 스코프 밖으로 새지 않게 합니다. `url(#…)` 클립을 쓰지 않아 순수 벡터·결정성이 유지됩니다.

## 6. 투영 핸들

- 도형 속성이 직접 입력이 아니어도, 자유 입력에 의해 움직이는 점이면 핸들을 만듭니다. 대상은 Polygon/Polyline의 각 점, Line의 시작·끝, Circle/Ellipse/Rectangle/Image의 중심입니다.
- 컴파일 시 자유 입력을 하나씩 미세하게 흔들어 `computeShapes`를 다시 돌리고, 각 점의 2D 야코비안 `J = ∂(x,y)/∂inputs` 를 수치적으로 만듭니다(자유 입력 200개, 핸들 160개, 계산 250ms 상한). 레이 트레이싱 예제(자유 입력 126개·후보 26개)에서 야코비안은 약 7ms입니다.
- 드래그는 `Δinputs = Jᵀ(JJᵀ + λI)⁻¹ Δtarget` 의 최소노름 해를 적용하고 `stepTimes`로 다시 수렴시킵니다. 2회 반복해 잔차를 줄입니다.
- 3D→2D 투영처럼 2D로 결정되지 않는 자유도는 최소노름이라 현재 값 부근을 유지합니다. 야코비안은 현재 값 근처의 선형 근사입니다.
- **각도(회전) 기즈모**: 파생된 Line의 끝점이 어떤 자유 입력에 대해 **접선 방향**으로 움직이면(회전), 그 점에는 이동 핸들 외에 회전 그립이 생깁니다. 그립은 점과 pivot의 중간에 점선 링으로 그려지고, 끌면 pivot(반대쪽 끝점)을 중심으로 반지름(길이)을 유지한 채 각도만 바뀝니다. 판정은 야코비안에서 `|J·t| > 2.5·|J·r̂|`인 입력이 있는지로 계산하므로 스타일별 코드가 없습니다. 레이 트레이싱의 광선·노멀 화살표가 대표 예이고, 자유 점을 그대로 복사하는 파생점(카메라 뷰파인더 등)은 회전 그립이 생기지 않습니다. 회전 드래그도 기존 `pointDrag`(야코비안 최소노름) 경로를 쓰므로 수렴·릴리스·Undo가 같습니다.
- 같은 위치의 점(폴리곤 꼭짓점 + 점 도형 + 라벨)은 우선순위로 합쳐 핸들 하나만 남깁니다.

## 7. 조작

- 핸들은 **선택 범위 안에서만** 생깁니다: 선택한 스코프의 모든 자유 입력, 또는 선택한 멤버의 자유 입력. 판정은 `state.interactivityInfo`의 자유 입력 기준이며 core의 `isTranslatable`보다 넓습니다. 핀이 걸린 입력, 읽기 전용 스코프, 식으로 계산된 속성에는 없습니다.
- 기즈모는 호스트 선택 핸들과 같은 지름 8px 원(흰 채움), `var(--alid-accent,#008FF0)` 테두리 1.25px로 HUD에 그립니다. 드래그 중인 핸들은 워커 응답을 기다리지 않고 포인터 목표값으로 즉시 이동하고, 나머지 핸들은 매 프레임 수렴 결과를 따라갑니다. `worldToScreen`은 클라이언트 좌표를 돌려주므로 HUD의 `getBoundingClientRect()` 원점을 빼서 HUD-로컬로 그립니다. 프레임은 매번 **preview view**의 `core.transform`/`core.bounds`에서 계산해(호스트가 스코프를 끄는 동안의 ScratchOverlay 포함) 핸들이 즉시 따라오게 하고, 스코프 캔버스(±w/2, ±h/2) 밖 좌표는 그리지 않습니다. 문서 SVG에 포함되지 않으므로 내보내기에 새지 않습니다.
- 이동 핸들은 `center`/`start`/`end`/`points` 입력을, 크기 핸들은 `r`/`rx`/`ry`/`width`/`height`를 움직입니다.
- 드래그 중에는 포인터 목표만 기록하고, 16ms 티커로 이벤트를 프레임에 합쳐 워커에 절대 입력값을 보냅니다. 목표값은 포인터 그대로이며(이징 없음), 도형이 커서를 1:1로 따라갑니다. 포인터가 멈춰 있어도 티커는 같은 목표를 계속 보냅니다. 이징이 사라지면 포인터가 움직일 때만 프레임이 돌아 최적화가 한 프레임(예산 10ms)만 쓰고 끝나고, 큰 도형이 이웃을 밀어내지 못한 채 겹친 상태로 굳습니다. 같은 목표를 반복해서 보내면 예산 단위로 계속 수렴해 이웃이 비켜납니다.
- 워커는 매 프레임 optimizer 상태를 **재시작**합니다. 수렴 후 `optStatus === 'EPConverged'`이면 `step`이 no-op이므로, 값을 직접 바꾼 드래그에서는 이전 상태를 그대로 쓰면 첫 프레임만 수렴합니다. `start(n)`으로 파라미터를 새로 만들고 warm-start 값은 유지합니다.
- 스테이지 최적화의 `text` 단계는 마지막 전체 패스 시점의 점 위치를 상수로 들고 있어, 드래그로 점을 직접 옮기면 AutoLabel/`Label` 텍스트가 제자리에 남습니다. 그래서 매 프레임 소유자 앵커의 이동량만큼 레이블 중심을 함께 평행이동합니다(드래그 프리뷰 전용). 놓을 때의 전체 수렴이 실제 제약으로 다시 배치합니다.
- 드래그는 현재 단계만 최적화하지 않습니다. Penrose의 스테이지 마스크는 누적이 아니어서, 컴파일이 끝난 뒤(마지막 arrow 단계) 드래그하면 `rects` 단계의 `disjoint`가 아예 평가되지 않고 끈 도형이 이웃을 뚫고 지나갑니다. 그래서 드래그 전용 합성 스테이지(`__drag__`)를 만들어 **현재 단계 + 바로 앞 단계**의 마스크를 합집합합니다(예: `arrow` ∪ `rects`). 모든 단계를 합치면 스테이지 최적화가 이미 버린 제약(예: 연결된 중심을 서로 붙이는 `dots`)까지 되살아나 도해가 붕괴하므로, 직전 단계까지만 합칩니다. 이 합성 스테이지는 세션마다 한 번 만들고 이후 드래그에서 재사용합니다.
- 드래그 중 penalty weight는 도해 크기에 따라 **적응적으로** 정합니다: varying 값 250개 초과는 1e7, 그 외는 1e8. 합성 스테이지가 `disjoint`를 포함하므로 가중치가 낮으면(1e5) 이웃이 겹칩니다. 1e7은 큰 도해에서도 시간 예산 스텝이 안정적입니다.
- 한 프레임의 에너지가 직전의 **8배+1e6**을 넘으면 그 프레임의 최적화를 버리고 끈 입력만 적용합니다. 큰 도해에서 한 번의 나쁜 스텝이 전체 레이아웃을 깨지 않게 합니다. EP가 1e9까지 올린 weight를 그대로 쓰면 L-BFGS의 preconditioned 수렴 검사가 스텝 전에 멈춰 AutoLabel이 얼어붙습니다. 1e8은 AutoLabel이 계속 움직이는 가장 높은 값이며(1e9에서 정지), 1e5 대비 거리 제약 잔차가 약 2.3px에서 0.65px로 줄었습니다. 예산 안에서 수렴·재핀을 3회 교대합니다.
- 예산(`solverConfig.dragBudgetMs`, 기본 10ms) 안에서 **수렴 → 끈 입력 재핀**을 두 번 교대합니다. 한 번만 하면 재핀 직후 제약 잔차가 남기 때문입니다. 예산이 0이면 `dragSteps` 고정 스텝을 씁니다.
- 투영 핸들은 IK 2회 후 **최종 정확 보정**으로 끈 점을 포인터에 정확히 맞춥니다(제약은 다음 프레임에 다시 수렴).
- 놓을 때는 `polishSession`이 **같은 `__drag__` 합성 스테이지**에서 **드롭 위치를 먼저 고정한 상태로 시작해** 120ms 예산으로 다시 수렴하고, 수렴 뒤 끈 입력을 드롭 위치로 재고정합니다. (핀을 수렴 뒤에만 적용하면 최적화는 옛 위치에서 돌고 도형만 순간이동해 이웃과 겹친 채로 남습니다.) stage 0부터 전체를 다시 풀면 다른 객체가 크게 움직여 점프가 생기기 때문입니다. 이징 없이 즉시 그 해로 바뀝니다. 투영 핸들은 마지막에 포인터 위치로 다시 보정합니다.
- 놓을 때 0스텝 재핀 → `varyingValues` 한 트랜잭션 커밋 → Undo 1회로 원복.
- 취소(Esc·blur·pointercancel)는 저장된 입력으로 레이아웃만 되돌립니다.

## 8. 워크스페이스 도구 (에이전트)

`workspace.tools`는 호스트 서비스입니다. 콜백은 **읽기와 변경 계획 준비**만 하고 문서를 직접 쓰지 않습니다(`docs/workspace-tools.md`). 생성도 `prepareChange(operations)`로 계획해야 하며, 호스트가 승인 카드에서 적용합니다.

- `penrose.studio:create-scope` — 새 `penrose.scope`(+ `penrose.member`, `core.transform`, `core.bounds`, `core.stacking`)를 만드는 계획을 반환합니다. `x`/`y`는 스코프 **중심**이고 생략하면 뷰포트 중앙입니다. `width`/`height`는 60~2400으로 클램프합니다. 생성 시 기본 예제를 한 번 컴파일해 `topologyDigest`와 수렴 입력을 채우므로, 만든 직후 "미적용" 상태로 보이지 않습니다. 컴파일은 엔진 캐시만 채우고 문서는 건드리지 않습니다.
- `penrose.studio:list-scopes` — 스코프의 `id`, 상자, trio 적용 여부, owner 수, 핀 수를 돌려줍니다.
- 디스크립터: `penrose.scope`, `penrose.member`. 호스트가 `aspectIds`를 노출하지 않으면 디스크립터만 건너뛰고 생성 도구는 유지합니다.

이 도구가 없으면 에이전트는 `changes_propose`로 **기존** 엔티티의 필드만 바꿀 수 있어 새 스코프를 추가할 수 없습니다.

## 9. 패널

- `penrose.panel.tri-editor`와 `penrose.panel.diagnostics`는 `navigation.group = document`로 활동 레일에 노출됩니다.
- 호스트는 패널 열기를 `ui.shell`로 자기 UI에만 제공하고, 이 서비스는 확장 컨텍스트에서 `PhantomDependency`로 막힙니다. 따라서 확장 명령은 열기를 시도한 뒤 실패하면 레일 위치를 안내합니다.

## 9. 호스트 변경 없음

- 설치 API 2의 공개 계약만 씁니다.
- TeX는 호스트에 노출되지 않으므로 MathJax를 번들에 포함합니다(워커 크기 2.88 MiB).
- 텍스트 측정 서비스도 없으므로 고정 메트릭 표를 씁니다.
- 비동기 Computed 반영은 `invalidateComputed()`로 이미 가능합니다.

## 10. 한계

- 페널티 기반 최적화라 하드 구속이 근사적으로만 만족됩니다.
- `Path`·`Group`은 기즈모가 없고, `Image`는 외부 URL을 허용하지 않습니다.
- 레지스트리 191개 전체 회귀는 아직 없습니다.
- 실제 브라우저의 워커 왕복 지연, IME, 터치를 검증하지 않았습니다.
