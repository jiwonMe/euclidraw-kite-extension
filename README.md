# EucliDraw Kite Studio 확장 (`jiwonme/euclidraw-kite-extension`)

[Kite](https://github.com/jiwonMe/kite)의 **Domain · Substance · Style** 3분할 선언과 다양체 정사영 솔버를 EucliDraw/alid 캔버스의 표준 확장으로 옮긴 프로젝트입니다. 하나의 다이어그램을 블랙박스 노드로 가두지 않고, 상위 `kite.scope`와 개별 `kite.member` 엔티티로 나누어 기존 선택·연결선·벡터 출판 생태계와 함께 쓸 수 있게 합니다.

- **정본**: `kite.scope`(세 DSL, `entityBindings`, `convergedSeeds`, 솔버 설정) + `kite.member`(점·선분·원·호·다각형·각도·라벨)
- **솔버**: 결정론적 XPBD/다양체 정사영. 포인터를 원 밖으로 끌어도 구속된 점은 원주 위로 투영됩니다.
- **조작**: 드래그 중에는 `ScratchOverlay`만 갱신하고, `pointerup`에서 정확히 한 번의 정본 패치를 기록합니다.
- **출판**: DOM·`<foreignObject>` 없이 순수 SVG 문자열을 반환합니다.
- **워크벤치**: Tri-DSL 인스펙터 패널과 DOF/잔차 진단 패널.
- **명령**: `M-x`에서 `Kite`로 검색해 생성·구속·수렴·고정·바인딩 복구를 실행합니다.

> 이 저장소의 소스는 **TypeScript**입니다. 배포 산출물만 `dist/plugin.js`(단일 ESM)로 빌드되며, `dist/plugin.js`와 `alid.extension.json`은 Git에 함께 커밋합니다.

---

## 설치

EucliDraw/alid의 **확장 관리 → GitHub에서 설치**에 다음을 입력합니다.

```text
jiwonme/euclidraw-kite-extension
```

설치 후 왼쪽 도구 선반의 **Kite 다이어그램** 버튼, 또는 명령 팔레트의 `Kite 다이어그램 추가`로 스코프와 기본 멤버를 만듭니다.

설치 API 2와 `engine: ^0.1.0` 호환 호스트가 필요합니다. `core.select-suite`와 `sys.minibuffer`는 선택 의존성입니다. 선택 확장이 없을 때도 생성·렌더·DSL 적용은 동작하지만, 선택 기반 구속 명령과 미니버퍼 입력은 제한됩니다. 이 확장은 사용자가 승인한 뒤 앱 안에서 실행되는 **신뢰 확장**입니다. `capabilities`는 접근 의도를 설명하며 DOM·네트워크를 격리하는 샌드박스가 아닙니다.

---

## 사용법

1. **Kite 다이어그램**을 만듭니다. 기본 예제는 직각삼각형, 외접원, 중점, 원 위의 점 `P`를 포함합니다.
2. 스코프를 선택하면 인스펙터에 **Kite Tri-DSL** 패널이 열립니다. Domain / Substance / Style 탭을 편집하고 `Ctrl/⌘+Enter` 또는 **적용**을 누릅니다.
3. 캔버스에서 점을 끌면 구속 조건을 유지한 채 움직입니다. 점 `P`를 원 밖으로 끌어 보세요.
4. 드래그 중 `Shift`를 누르면 위상 스냅 후보가 배지로 나타납니다.
   - 다른 선분의 중점 근처 → `Midpoint(P, A, B)`
   - 공유 꼭짓점에서 두 선분이 90° 근처 → `Perpendicular(s1, s2)`
   - 다른 원의 원주 근처 → `OnCircle(P, c)`
   놓으면 해당 구속 문장이 Substance DSL에 승격되고, 드래그 전체가 **Undo 한 번**으로 복원됩니다.
5. 점·선분·원을 1~3개 선택하고 **Kite 구속**을 실행하면 가능한 구속 목록이 나옵니다. `sys.minibuffer`가 없으면 첫 번째 가능한 구속을 적용합니다.
6. **Kite 진단** 패널에서 총 DOF, 구속 DOF(수치 랭크 추정), 잔여 DOF, 잔차, 반복 수, 과구속 후보를 확인하고 **다시 수렴** 또는 **기하 고정**을 실행합니다.

### 주요 명령

| 명령 | 설명 |
| --- | --- |
| `Kite 다이어그램 추가` | 스코프와 기본 멤버를 한 트랜잭션으로 만듭니다. |
| `Kite DSL 적용` | 세 DSL을 한 번의 Undo로 적용하고 다시 수렴합니다. |
| `Kite 기본 예제로 복원` | 기본 3분할 예제로 되돌립니다. |
| `Kite 점 추가` | 자유 점을 추가합니다. |
| `Kite 구속 추가` | 선택 조합에 가능한 구속을 제시합니다. |
| `Kite: 원 위에 배치` / `중점` / `직교` / `등길이` / `수평` / `수직` / `접선` | 선택 멤버에 해당 구속을 추가합니다. |
| `Kite: 거리 지정` | 두 점 사이 거리를 미니버퍼에서 고릅니다. |
| `Kite: 기하 고정` | 모든 구속을 제거하고 현재 좌표를 핀으로 고정합니다. |
| `Kite: 바인딩 복구` | `substanceId ↔ EntityId` 맵을 실제 멤버에서 다시 만듭니다. |
| `Kite: 다시 수렴` | 현재 정본에서 솔버를 다시 돌려 시드를 갱신합니다. |

---

## DSL 맛보기

```text
# Domain
type Point shape point
type Segment shape segment
predicate OnCircle(Point, Circle)

# Substance
Point A = (80, 240) pin
Point B = (260, 240) pin
Segment AB = A .. B
Circle c1 = center M r 127
OnCircle(P, c1)

# Style
point { r: 4.5; fill: #2563eb; label: false }
segment { stroke: #475569; width: 2 }
P { fill: #dc2626; label: "P" }
```

전체 문법은 [docs/dsl.md](docs/dsl.md)를 참고하세요.

---

## 아키텍처

```text
kite.scope (Canonical)
  ├─ domainDsl / substanceDsl / styleDsl
  ├─ entityBindings : substanceId → EntityId
  ├─ convergedSeeds : EntityId → number[]
  └─ solverConfig
        │
        └─ 순수 컴파일 (DSL 변경 시에만) ─→ 제약 위상 · DOF 표
                │
kite.member (Canonical)  ── derive ──→ 세계 좌표 기하 ──→ renderSvg / hitTest
        ▲
        └─ ScratchOverlay.convergedSeeds (드래그 중에만)
```

- `kite.member`는 `core.transform`을 저장하지 않습니다. 위치는 상위 스코프의 솔버 결과에서 파생되고, `layout: true`가 `computed.layoutBounds`를 공급합니다. 따라서 R-Tree 컬링·연결선 라우팅·선택 판정이 실시간 좌표를 그대로 봅니다.
- 읽기 경로는 캐시된 시드를 투영만 합니다. 시드가 현재 DOF 레이아웃과 맞으면 반복 0회, `LoroDoc` 쓰기 0회입니다.
- 드래그 경로만 매 프레임 솔버를 돌리고, `pointerup`에서 `convergedSeeds`와 (스냅 승격 시) `substanceDsl`을 **한 배치**로 씁니다.
- 스코프 이동·회전·리사이즈는 `core.transform`만 바꾸므로 솔버를 다시 돌리지 않습니다.

자세한 매핑과 PRD 대비 구현 범위는 [docs/architecture.md](docs/architecture.md)에 정리했습니다.

---

## 개발

Node.js **22.12 이상**, `pnpm@11.22.0`을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm typecheck       # TypeScript 소스 검사
pnpm test            # 배포 번들 빌드 + Vitest 계약/솔버/기하 테스트
pnpm check:dist      # 재빌드 후 커밋된 산출물과 차이 확인
pnpm dev             # http://127.0.0.1:5174 watch 서버
```

EucliDraw의 **확장 관리 → 개발 중인 확장 연결**에 `pnpm dev` 주소를 입력하면 소스 저장 시 다시 빌드되어 캔버스에 반영됩니다. 개발 출력은 `.alid-dev/`에만 생성됩니다.

### 파일 구조

| 파일 | 역할 |
| --- | --- |
| `extension.json` | 확장 ID·버전·요약·의존성·명령 이름의 원본 |
| `src/manifest.ts` | 번들과 설치 명세가 공유하는 패키지 계약 |
| `src/types.ts` | 호스트 공개 계약과 Kite 문서 스키마의 구조적 타입 |
| `src/dsl/` | Domain · Substance · Style 파서와 제약 위상 컴파일러 |
| `src/solver/` | Float64Array XPBD/다양체 정사영, 캐시, 진단 랭크 |
| `src/geometry.ts` | 스코프 로컬 ↔ 세계 좌표, 기하 투영, 히트 테스트 |
| `src/render/member.ts` | 순수 SVG 렌더러, 각도·틱·직교·핀 표식 |
| `src/aspects.ts` | `kite.scope`, `kite.member` 어스펙트와 선택 기하 |
| `src/tools/kite-manipulate.ts` | 기즈모 드래그, ScratchOverlay, HUD 궤적/배지 |
| `src/tools/drag-session.ts` | 한 번의 드래그에 대한 순수 솔버 세션 |
| `src/tools/documents.ts` | 생성·DSL 적용·바인딩 동기화·단일 커밋 |
| `src/panel/` | Tri-DSL 인스펙터, DOF/잔차 진단 패널 |
| `src/commands.ts` | 명령 등록과 선택 기반 구속 추론 |
| `test/` | DSL·솔버·기하·플러그인·번들 계약 테스트 |

`dist/plugin.js`, `alid.extension.json`은 생성 산출물이므로 직접 편집하지 말고 `pnpm build`로 갱신합니다.

---

## 검증 범위와 정직한 한계

`pnpm test`는 다음을 실제 소스로 검증합니다.

- 기본 DSL 컴파일, 결정론, 오류 줄 번호, 스타일 병합·숫자 재작성
- 기본 작도 수렴, 원 위 드래그 투영, 직교·등길이·중점 불변식
- 시드 토폴로지 불일치 감지, 시드 왕복, DOF 랭크 진단
- 멤버 투영·순수 SVG 결정론·XSS 이스케이프·선택 히트 테스트
- 설치 계약, 명령·패널 등록, 단일 Undo 그룹 생성, 읽기 시 쓰기 0회
- 드래그당 정확히 한 번의 정본 패치와 원래 시드로의 복원
- Shift 위상 스냅 승격(중점·원 위)과 승격된 구속 문장 기록
- 커밋된 `dist/plugin.js`의 SHA-256·크기·단일 ESM 계약
- 로컬 alid 커널 체크아웃에서 실제 `ExtensionRuntimeRegistry` 설치, 스코프 생성, `computed.kite.member`/`computed.effectiveBounds`, 순수 SVG 내보내기, 읽기 시 쓰기 0회, 기즈모 드래그→ScratchOverlay 미리보기→단일 커밋, dispose 스모크 1회 수행

아직 구현하지 않았거나 검증하지 않은 것:

- **Wasm SIMD 솔버가 아닙니다.** 현재 솔버는 TypeScript `Float64Array` 구현입니다. PRD의 Rust/Wasm 커널은 이 저장소에 포함되지 않았습니다.
- **120fps·핫패스 0-GC 벤치마크를 주장하지 않습니다.** 자동 성능 계측과 1,000개 엔티티 스트레스 테스트는 없습니다.
- **Markdown/MathJax 라벨 통합이 없습니다.** 라벨은 순수 SVG `<text>`로 렌더링합니다. `markdown-card`의 수식 SVG를 합성하는 경로는 아직 없습니다.
- **`vector-path` 진짜 베이킹이 아닙니다.** `기하 고정`은 구속을 제거하고 좌표를 핀으로 고정하지만, 별도 `vector.path` 엔티티로 변환하지는 않습니다.
- **스코프 복사 리매핑이 자동이 아닙니다.** 스코프와 멤버를 함께 복사한 뒤에는 `Kite: 바인딩 복구`를 실행해야 새 `EntityId`에 매핑됩니다. 부분 서브그래프 복사·유도 부분그래프 추출은 미구현입니다.
- **수식 라벨/IME/실제 브라우저 드래그는 수동 검증이 필요합니다.** Node 테스트는 모의 호스트 계약 검증이며 실제 EucliDraw 설치·Loro Undo·한글 IME 통합 검증이 아닙니다.
- `connector-wire`는 멤버의 `computed.layoutBounds`를 자동으로 추종하지만, 실제 화살표 라우팅 통합은 호스트에서 수동 확인해야 합니다.

이 목록은 PRD의 나머지 단계(Wasm 커널, MathJax 라벨, 완전한 클립보드 서브그래프, 성능 게이트)를 완료로 포장하지 않기 위한 것입니다.

MIT License.
