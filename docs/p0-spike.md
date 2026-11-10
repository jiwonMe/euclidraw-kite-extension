# P0 스파이크 결과 (Penrose × alid)

2026-11-10 · `@penrose/core@3.3.1`(MIT, `gitHead edad5498…`)

## 측정값

| 항목 | 값 | 비고 |
| --- | --- | --- |
| 엔진 워커 번들 | **2.88 MiB** (gzip 0.82 MiB) | Vite + oxc minify, core + `mathjax-full`(lite adaptor, SVG, AllPackages) |
| 워커 문자열로 내장 | 3.18 MiB | `src/generated/penrose-worker.ts` (JSON 문자열) |
| 최종 확장 번들 | **3.1 MiB** | `dist/plugin.js`, 설치 한도 5 MiB 이하 |
| 메인 청크 엔진 코드 | 0바이트 | 메인은 `@penrose/core`를 타입으로만 import |
| 예제 컴파일 + 수렴 (Node, 인라인 엔진) | 37 ms | 기본 trio(점 3 · 원 1 · Equation · Text) |
| 드래그 프레임 (Node, 인라인 엔진) | 중앙값 1.7 ms · p95 2.2 ms | 4개 도형, 프레임 예산 재수렴 + 재핀 |
| 첫 로드 후 레이아웃 | 8 ms | 캐시된 수렴값으로 `computeShapes`만 |

실제 브라우저·실제 Web Worker·Tauri WebView에서 측정하지 않았습니다. 위 값은 Node + 인라인 엔진이며 워커 왕복 비용이 빠져 있습니다.

## P0 결정

**A. 번들 중복.** 워커 엔트리를 따로 번들해 `?raw` 대신 생성 파일의 문자열로 인라인합니다. 메인 스레드는 `@penrose/core`를 값으로 import하지 않으며, `scripts/build-worker.mjs`가 워커에 남은 `import`를 검사하고 4.4 MiB 예산을 강제합니다. 최종 번들 크기는 Vite 플러그인이 5 MiB에서 막습니다.

**B. 텍스트 측정.** DOM·캔버스 없이 동작하는 고정 Helvetica AFM 폭 표를 씁니다(`src/penrose/labels.ts`). Equation은 `mathjax-full`의 `liteAdaptor` + SVG 출력(`fontCache: 'none'`)으로 경로 글리프를 만들며, 측정과 렌더가 같은 엔진에서 나옵니다. 따라서 피어 간 레이아웃 입력과 Equation SVG가 결정적입니다. `<text>`의 실제 글리프 폭은 플랫폼 폰트에 따라 미세하게 달라질 수 있으므로, 좁은 상자에서 넘침이 보일 수 있습니다(문서화된 한계).

**C. `topologyDigest`.** trio 원문, `variation`, 엔진 버전(`3.3.1`), 측정 정책(`labels:v1`)을 FNV-1a 64비트로 해시합니다. Cold 열기는 이 digest가 맞을 때만 저장된 `varyingValues`를 재사용하며, 최적화는 0스텝이지만 컴파일(파싱·Style·자동미분)은 매번 수행합니다.

**D. 드래그 지연.** 기본은 드래그 중 끈 입력을 매 프레임 워커로 보내 `stepTimes(2)`만 돌리고, 응답이 오면 오버레이를 교체합니다. 놓을 때 0스텝 재핀 + 1회 커밋. 예산은 중간 예제 p95 50 ms이며 `src/__tests__/perf.test.ts`가 회귀를 잡습니다.

## 폐기한 것

- Rust 크레이트, Wasm SIMD 솔버, v1 DSL 컴파일러·스냅·구속 카탈로그·DialKit 어댑터.
- 구속을 매 프레임 정확히 만족시키는 다양체 정사영과 자유도·과구속 진단. Penrose의 페널티 기반 최적화로 대체합니다.
- v1 문서(`kite.scope`)와의 호환·마이그레이션. 익스텐션 ID가 `penrose.studio`로 바뀌므로 v1 스코프는 읽히지 않습니다.

## 남은 검증

- 레지스트리 191개 전체 회귀는 아직 없습니다. 현재 테스트는 기본 예제와 호스트 계약(선택·클립보드·베이킹)만 다룹니다.
- 실제 브라우저 Web Worker 경로, 한글 IME, 터치 기기는 수동 검증하지 않았습니다.
