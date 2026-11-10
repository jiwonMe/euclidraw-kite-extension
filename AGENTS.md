# AGENTS.md — EucliDraw Kite Studio 확장 개발 지침

이 저장소는 EucliDraw/alid 앱이나 커널이 아니라, GitHub에서 설치하는 **독립 외부 확장**입니다. Kite의 Domain · Substance · Style 선언과 다양체 정사영 솔버를 캔버스 스코프/멤버 엔티티로 구현합니다.

> 작은 코어, 기능은 확장으로. 문서에는 사용자 의도만, 호스트와의 연결은 공개 계약만.

## 1. 작업 전 읽기

1. [README.md](README.md): 설치·사용법·개발 흐름과 **정직한 한계**.
2. [docs/dsl.md](docs/dsl.md), [docs/architecture.md](docs/architecture.md): DSL 문법과 PRD 대비 구현 범위.
3. [extension.json](extension.json), [src/manifest.ts](src/manifest.ts): 패키지 계약과 명령 ID.
4. [src/types.ts](src/types.ts): 호스트 공개 계약의 구조적 선언과 Kite 문서 스키마.
5. [src/aspects.ts](src/aspects.ts), [src/tools/documents.ts](src/tools/documents.ts): 어스펙트·생성·DSL 적용.
6. [src/tools/kite-manipulate.ts](src/tools/kite-manipulate.ts), [src/tools/drag-session.ts](src/tools/drag-session.ts): 드래그/Undo 경계.

이 저장소에는 alid 모노레포, Rust/Wasm 빌드, SDK npm 의존성이 없다. 호스트 서비스·DOM 구조를 추측해 우회하지 말고, 공개 `ExtensionPackageSpec` 계약만 사용한다.

## 2. 언어와 빌드

- **소스는 TypeScript(`src/**/*.ts`)로만 작성한다.** 배포물은 단일 ESM `dist/plugin.js` 하나다.
- `pnpm build`는 Vite로 `src/index.ts`를 번들하고 `alid.extension.json`의 SHA-256을 갱신한다.
- 확장 소스에서 `@alid/*`, React, 상대 경로 청크, CSS, 이미지, 런타임 npm 설치를 import하지 않는다. 호스트 공유 모듈 목록은 [vite.config.ts](vite.config.ts)의 `sharedImports`뿐이다.
- 테스트는 Vitest + jsdom 모의 호스트다. `dist/plugin.js` 계약은 [test/bundling.test.ts](test/bundling.test.ts)가 검증한다.
- `dist/plugin.js`, `alid.extension.json`은 **Git에 포함하는 생성 산출물**이다. 직접 편집하지 않고 `pnpm build`로 갱신한다.

```sh
pnpm typecheck
pnpm test
pnpm check:dist
pnpm dev        # http://127.0.0.1:5174
```

## 3. 파일별 책임

| 파일 | 책임 / 수정 원칙 |
| --- | --- |
| `extension.json` | 확장 ID·제목·버전·요약·의존성·명령 이름의 원본. |
| `src/manifest.ts` | 번들과 설치 명세가 공유하는 계약. `provides.aspects`는 `kite.scope`·`kite.member`. |
| `src/types.ts` | 호스트 계약과 정본 스키마. 클로저·DOM·함수를 정본 타입에 넣지 않는다. |
| `src/dsl/` | 순수 파서/컴파일러. 호스트·DOM·문서 쓰기 금지. |
| `src/solver/` | 순수 Float64Array 솔버, 캐시, 진단. 수치 결과는 결정론적이어야 한다. |
| `src/geometry.ts` | 스코프 로컬↔세계 변환, 투영, 히트 테스트. 정본 쓰기 금지. |
| `src/render/member.ts` | 순수 SVG. `<foreignObject>`·DOM 측정·외부 폰트 금지. |
| `src/aspects.ts` | `kite.scope`/`kite.member` 어스펙트, `layout: true`, 선택 기하. |
| `src/tools/documents.ts` | 생성·DSL 적용·멤버 동기화·단일 커밋. 모든 쓰기는 여기 또는 드래그 커밋에 모은다. |
| `src/tools/drag-session.ts` | 한 드래그의 워밍 스타트/승격 후보/최종 시드. DOM 접근 금지. |
| `src/tools/kite-manipulate.ts` | 기즈모·포인터·ScratchOverlay·HUD. 이벤트 핸들러에서 정본을 직접 쓰지 않는다. |
| `src/panel/` | 인스펙터·진단 패널. 입력창 네이티브 Undo/IME를 보존한다. |
| `src/commands.ts` | 명령과 선택 기반 구속 추론. 잘못된 선택은 명확한 한국어 오류로 거부한다. |
| `test/` | 계약·수치·기하·번들 회귀. 실제 브라우저 통합을 대체하지 않는다. |

## 4. 불변식

1. **정본 순수성.** `kite.scope`에는 세 DSL, 바인딩, 수렴 시드, 솔버 설정만 둔다. 화면 좌표·DOM 측정·컴파일 결과·함수·Blob URL·타이머를 저장하지 않는다. `kite.member`에는 소속·substanceId·primitiveKind·핀/슬랙만 둔다.
2. **읽기 시 쓰기 금지.** `derive`, `renderSvg`, 패널의 조회, 활성화, 진단 새로고침은 `applyCanonicalTransaction`을 호출하지 않는다. 시드가 현재 위상과 맞으면 솔버 반복 0회여야 한다.
3. **드래그는 한 번만 쓴다.** 포인터 이동 중에는 `ScratchOverlay`만 갱신한다. `pointerup`에서 `convergedSeeds`와 (승격 시) `substanceDsl`을 하나의 `withHistory` 그룹·하나의 배치로 기록한다. `Escape`/취소는 정본을 쓰지 않는다.
4. **커널 무오염.** 기하 솔버·DSL 지식은 이 패키지 안에만 둔다. `@alid/kernel`이나 Rust 코어에 Kite 분기를 추가하지 않는다.
5. **단일 Z축.** `core.stacking`만 쓴다. `layer`/`zOrder`를 어스펙트에 넣지 않고, `computed.layoutBounds`에 순서를 섞지 않는다.
6. **순수 벡터.** 모든 멤버는 `renderSvg`로 완결된다. 화면과 출판이 같은 문자열을 쓴다. 사용자 텍스트·색상은 이스케이프/검증한다.
7. **IME·입력 주권.** `isComposing`, `keyCode === 229`, `compositionend` 직후 16ms 가드를 지킨다. 텍스트 입력창의 네이티브 Undo·클립보드를 덮지 않는다. `Escape`는 드래그 중일 때만 가로챈다.
8. **정직성.** Wasm SIMD, 120fps/0-GC, MathJax 라벨, `vector-path` 베이킹, 완전한 클립보드 서브그래프를 구현 완료로 보고하지 않는다. README의 한계 목록과 테스트 결과를 함께 갱신한다.

## 5. 스키마 진화

- `kite.scope.schemaVersion`은 1이다. 파괴적 변경은 새 어스펙트 ID(`kite.scope@2`)나 새 필드로 분리하고 기존 문서를 재작성하지 않는다.
- `entityBindings`와 `convergedSeeds`의 키는 `EntityId`다. substanceId가 바뀌면 `repair-bindings`가 복구할 수 있어야 한다.
- `kite.member.scopeId`는 `cascade-hide` 참조 정책을 유지한다. 스코프가 삭제돼도 멤버 정본은 파괴하지 않는다.
- 스타일·라벨·솔버 기본값은 자유롭게 바꿀 수 있지만, 이미 만들어진 객체의 어스펙트 ID와 필드 의미는 유지한다.

## 6. 완료 전 확인

- [ ] 요청 범위만 수정했고 기존 어스펙트 ID·필드 의미를 보존했는가?
- [ ] 기능 변경에 맞는 `test/*.test.ts`와 README/docs를 갱신했는가?
- [ ] `pnpm typecheck`와 `pnpm test`가 통과하는가?
- [ ] `pnpm check:dist`가 통과하도록 `dist/plugin.js`, `alid.extension.json`을 함께 커밋했는가?
- [ ] 활성화·조회·렌더가 정본을 쓰지 않는가? (`test/plugin.test.ts`의 zero-write 테스트)
- [ ] 드래그가 정확히 한 번의 Undo 그룹으로 기록되는가?
- [ ] 화면 밖 객체도 `renderSvg`로 내보낼 수 있는가?
- [ ] 구현하지 않은 PRD 단계를 완료로 표현하지 않았는가?

Node 테스트는 모의 호스트 계약 검증이지 실제 브라우저·IME·Loro Undo 통합 검증이 아니다. 완료 보고에는 실행한 명령과 결과, 수동 확인 여부, 미검증 범위를 구분한다.
