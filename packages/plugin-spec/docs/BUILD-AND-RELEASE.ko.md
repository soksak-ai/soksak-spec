---
kind: translation
status: active
canonical: docs/BUILD-AND-RELEASE.md
---

# 빌드 및 릴리스 진입점

이 문서는 공통 빌드·릴리스 경계를 정의합니다. 사설 toolchain installer를 만들거나 개발자
workstation 상태를 source에 직렬화하지 않습니다.

## 규칙

- **BR1 — 하나의 로컬 진입점.** 모든 source repository는 해당 동작이 있을 때
  `make preflight`, `make prepare`, `make build`, `make verify`를 공개합니다. 언어별 task file은
  이 경계 뒤에서 사용할 수 있지만 두 번째 공개 진입점이 아닙니다.
- **BR2 — 선언적 소유자.** Tool version은 `.node-version`, `packageManager`, `go.mod`,
  `rust-toolchain.toml`이 소유합니다. 외부 build source, exact commit, 필요한 tool, target output은
  `build-dependencies.json`이 소유합니다. Makefile은 command만 소유하며 이 metadata를 복사하지
  않습니다. Node package는 `.node-version`을 consumer용 `engines.node`와 direct pnpm 진입점용
  `devEngines.runtime`에 projection하며 test는 모든 projection이 owner와 같은지 확인합니다.
- **BR3 — 주입된 환경.** 설치된 executable path, workspace-relative repository 탐색,
  주입된 `PATH`, symlink, cache 위치, fallback tool을 source에 기록하지 않습니다. 개발자는 표준
  수단으로 환경을 선택하며 다른 tool이 함께 설치되어 있어도 됩니다. Clean CI job은 선언된
  version을 주입합니다. `make preflight`는 주소 지정된 executable만 확인하고 제품 command 전에
  불일치를 거부하며 다른 설치본을 탐색하거나 설치하지 않습니다. Bootstrap executable에서 위임하는
  package manager는 bootstrap package 자체 version이 아니라 대상 repository에서 반환한 effective
  version으로 판정합니다. 잘못된 runtime의 direct pnpm command는 dependency 해석 전에 실패합니다.
  pnpm은 script 전에 implicit install을 하지 않습니다. Dependency tree가 어긋나면 거부하며
  `make prepare`가 유일한 materialization 진입점입니다.
- **BR4 — 읽기 전용 preflight.** Preflight는 요구·실제 version, OS, architecture를 보고합니다.
  Tool을 설치·삭제·복구·선택하지 않습니다. 환경 불일치는 제품 RED가 아니라 precondition
  실패입니다.
- **BR5 — 멱등한 preparation.** `make prepare`는 canonical lockfile에서 repository 소유
  dependency만 materialize합니다. 입력이 같으면 반복 실행 결과도 같습니다. Cache를 삭제하거나
  owner metadata를 다시 쓰거나 repository 경계 밖에 install을 강제하지 않습니다.
- **BR6 — 하나의 command graph.** 로컬 개발과 GitHub Actions가 같은 Make target을 호출합니다.
  Workflow YAML은 runner 선택, credential, artifact transport, publication만 소유하며 repository
  build를 다시 구현하지 않습니다.
- **BR7 — Native build 축.** Native artifact는 target과 일치하는 native runner에서 build하고
  실행합니다. Darwin arm64와 x86_64 thin artifact를 따로 만들고, universal artifact는 검증된 두
  thin artifact만 합성합니다. Linux arm64/x86_64와 Windows x86_64도 주소 지정된 native job을
  사용합니다.
- **BR8 — 검증한 byte를 릴리스.** Publication은 필수 build·system job이 만든 정확한 artifact를
  내려받아 digest와 target header를 검증하고 rebuild 없이 그 byte를 공개합니다. Dependency가
  실패하면 tag나 release asset을 만들 수 없습니다.
- **BR9 — Repository 소유권.** Repository Makefile은 자기 구현과 경계만 검증합니다. Contract
  fixture는 contract owner가 정의하고 각 구현이 실행합니다. 여러 실제 component의 조합은 제품
  composition repository가 검증합니다.
- **BR10 — 미공개 dependency는 주소 지정된 local store에서 옵니다.** Local build는 `--store`를
  받아 모든 runtime dependency를 `<store>/<kind 복수형>/<id>/<version>/`에서 해석합니다. Build
  input은 package manager의 commit된 manifest와 lockfile에서 옵니다. 제품 workflow는 공개된
  byte를 검증하며 형제 source를 build하지 않습니다.
- **BR11 — Local release는 공개 release 형식을 사용합니다.** Local release에는 GitHub Release와
  동일한 `release.json`, source commit, manifest, evidence, target artifact, size, SHA-256이 있습니다.
  이 형식에는 location이 없습니다. Store는 release directory를 file에 대응시킵니다. `release.json`의
  모든 bare `file` 이름은 `<store>/<kind 복수형>/<id>/<version>/` 안의 regular file입니다. 모든 bare
  `file` 이름은 [PLATFORM-WIRE.md](PLATFORM-WIRE.md) §3의 단일 release file grammar와 일치합니다.
- **BR12 — 공개 release는 immutable이며 local store는 commit 기준으로 교체합니다.** 공개된 GitHub
  Release는 바뀌지 않습니다. Local store에서는 `<store>/<kind 복수형>/<id>/<version>/`이 release
  transaction 하나입니다. 이미 있는 version directory에 발행하면 `source.commit`과 byte를
  비교합니다. 같은 commit에 같은 byte는 `unchanged`이고, 같은 commit에 다른 byte는
  `LOCAL_RELEASE_BUILD_NOT_DETERMINISTIC`으로 실패하며, 다른 commit은 version directory 전체를
  교체합니다. 저장된 release 중 하나라도 `runtimeDependencies`에 기존 `release.json`의 size와
  digest를 고정하고 있으면 교체는 `LOCAL_RELEASE_IN_USE`로 거부되며, 오류는 그런 release를 각각
  이름으로 나열합니다. 그 dependent는 교체 전에 store에서 삭제하고 교체 후 새 release 기준으로
  다시 build합니다. 일부 file만 교체한 상태는 언제나 잘못입니다.
- **BR13 — Installer는 하나이며 transport는 identity가 아닙니다.** Local install과 registry install은
  같은 closure resolver, target selector, validator, extractor, consent summary, progress stream, atomic
  environment commit을 사용합니다. Release reference는 `{ id, version, size, sha256 }`이며 location이
  없습니다. GitHub resolver는
  `https://github.com/soksak-ai/<id>/releases/download/v<version>/release.json`을 fetch하고,
  local-store resolver는 `<store>/<kind 복수형>/<id>/<version>/release.json`을 읽으며, verifier는 그
  byte의 size와 SHA-256을 reference와 비교합니다. Resolver는 reference 전체를 받습니다. GitHub
  resolver는 reference가 있는 읽기를 reference `size`로, reference가 없는 root 읽기를
  `MAX_RELEASE_DOCUMENT_BYTES`(1 MiB)로 제한하며, local-store resolver는 file 전체를 읽습니다.
  모든 읽기 뒤에 하나의 verifier가 실행됩니다. Local file은 명시한 store 아래에 있고 name, size,
  SHA-256이 `release.json`과 같을 때만 사용할 수 있습니다. `file:`, `link:`, `workspace:` locator는
  commit된 source manifest와 lockfile에서 금지합니다. 생성된 release document에는 location이 전혀
  없습니다.
- **BR14 — Build evidence는 execution evidence가 아닙니다.** Owner toolchain 또는 관리되는 Docker
  cross-builder가 지원하는 모든 target을 build할 수 있습니다. Cross-build 성공은 target archive와
  native header를 증명하지만 해당 OS의 실행을 증명하지 않습니다. Native, emulated, VM, cross-build
  evidence는 환경을 이름으로 기록하며 서로를 대신하지 않습니다.
- **BR15 — GitHub Actions가 공개를 승인합니다.** Actions는 exact main commit에서 같은 owner command로
  full matrix를 build하고 complete release 하나를 조립하며, publish job에서 rebuild하지 않고 검증된
  byte를 공개합니다. Local GREEN은 개발 증거이며 필수 Actions matrix가 공개 증거입니다.
- **BR16 — Local 검증을 먼저 사용합니다.** 개발 반복은 owner gate, 관리되는 Docker cross-build, local
  release-store 검증, installed-product test를 로컬에서 실행합니다. Local에서 만들 수 없는 native evidence
  또는 최종 공개에만 Actions run을 시작합니다. Source나 선언된 환경이 바뀌지 않았다면 실패한
  run을 다시 실행하지 않습니다.
<!-- rule:component-tooling-receipt -->
- **BR17 — 하나의 Component Tooling receipt.** Plugin, Sidecar, Kit, Contract, Spec build는 exact
  `soksak-sdk` Kit release를 통해 같은 공개 `make verify` 경계를 실행합니다. Build는
  `soksak-component-build-receipt-v1` schema의 `component-build-receipt.json`을 만들고 component
  identity, source commit, manifest byte, exact Spec·tooling release reference와 각 artifact digest를
  해당 target의 execution mode/platform/architecture·exact tool version에 묶습니다. 여러 target인
  Sidecar가 publish job 하나를 전체 matrix의 실행 근거로 투영하면 안 됩니다. 같은 source의 local과 Actions
  build는 같은 command와 receipt grammar를 사용합니다.
<!-- rule:sdk-not-release-identity -->
- **BR18 — SDK dependency는 release identity가 아닙니다.** Author SDK는 Plugin 또는 Sidecar가 공개
  계약을 구현하도록 도울 수 있지만 dependency package 이름은 artifact 동작의 증거가 아닙니다.
  Kit, Contract, Spec에는 가상의 SDK를 만들지 않고 공통 tooling만 적용합니다. Publication은 receipt,
  manifest, artifact byte, conformance claim을 검증하며 source metadata에 SDK dependency가 있다는
  이유만으로 그것을 요구하거나 신뢰하지 않습니다.

## Component와 상태 소유권

Plugin과 Sidecar release는 runtime installation이 됩니다. Kit release는 재사용 build 구현을, Contract
release는 공유 type 또는 protocol input을, Spec release는 platform schema와 validator를 제공합니다.
Kit, Contract, Spec identity는 release reference에 남습니다. Core는 이들을
runtime process로 기록하지 않습니다.

`environment.json`은 Plugin과 Sidecar runtime 선택만 기록합니다. 각 record에는 exact version,
materialized path, source(`local`, `registry` 또는 `development`), artifact SHA-256이 있습니다.
`development` record의 path는 source directory이고, 그 manifest에서 version을 읽으며, 빈 artifact
SHA-256과 registry 없음을 기록합니다. Sidecar는 target을, Plugin은 enabled 상태를 추가로
기록합니다. `release.json`은 repository, source commit, dependency identity, size, digest를
보존합니다. `environment.json`은 Go module이 소유하고 검증합니다. TypeScript package는 이 문서에
대해 아무것도 내보내지 않습니다.

## Local release store

Workspace 개발 repository가 `local/releases`를 소유합니다. Component repository는 이 directory를
찾지 않으며 Core도 sibling checkout에서 유추하지 않습니다. Caller는 local release 조회·설치 때 store
절대 경로를 제공합니다.

```text
local/releases/
├── plugins/<id>/<version>/
├── sidecars/<id>/<version>/
├── kits/<id>/<version>/
├── contracts/<id>/<version>/
└── specs/<id>/<version>/
```

각 version directory는 flat GitHub Release asset set입니다. Sidecar target은 artifact field와 filename
segment이며 추가 store directory가 아닙니다. Store 순회는 directory만 대상으로 합니다. `<kind 복수형>/`
또는 `<kind 복수형>/<id>/` 아래의 `.DS_Store` 같은 regular file은 store entry가 아니며 무시합니다. 그 자리의
symbolic link·FIFO·socket·device는 `LOCAL_RELEASE_INVALID`로 거부합니다. Store당 publisher는 한 번에 하나입니다.
Publisher는 실행 동안 `<store>/.publish-lock` directory를 점유하며 두 번째 publisher는 `LOCAL_RELEASE_BUSY`로
거부됩니다.
Publisher는 source output을 검증하고 sibling directory `<version>~next.<pid>`에 복사하며 복사본을
다시 검증한 뒤 그 directory를 제자리로 rename합니다. 교체는 다음 순서의 rename 두 번입니다.
`<version>`을 `<version>~previous.<pid>`로, 그다음 `<version>~next.<pid>`를 `<version>`으로
rename하고 `<version>~previous.<pid>`는 마지막에 제거합니다. `~`는 SemVer 문법 밖이므로 staging
directory는 저장된 version과 충돌하지 않습니다. 실패하면 final directory가 노출되지 않습니다. 남아
있는 `<version>~previous.<pid>` 또는 `<version>~next.<pid>` directory는 중단된 교체입니다.
`publish`, `verify`, `list`, `inspect`, `delete`는 진입 시 store 전체를 순회하고 그 경로를 이름으로
지정해 `LOCAL_RELEASE_REPLACEMENT_INTERRUPTED`로 거부하며 어떤 store operation도 이를 복구하지
않습니다. 남은 directory는 operator가 제거합니다.

Location은 규약으로 유도하며 어떤 document에도 없습니다. 공개 release directory는
`https://github.com/soksak-ai/<id>/releases/download/v<version>/`이고 local release directory는
`<store>/<kind 복수형>/<id>/<version>/`입니다. 둘 다 `release.json`, manifest file, artifact,
evidence를 `release.json`이 기록한 bare file 이름으로 보관합니다.

Store operation은 `publish`, `list`, `inspect`, `verify`, `delete`가 전부입니다. `delete`는 exact kind,
id, version 하나를 받습니다. 설치된 component를 제거하거나 process를 종료하지 않습니다.

`verify`는 저장된 모든 release와 store 안의 모든 `runtimeDependencies` reference를 검사합니다. 각
reference는 `release.json`이 참조된 size와 SHA-256을 가진 저장 release로 해석되어야 합니다. 다른
byte로 해석되거나 저장 release가 없는 reference는 dependent release와 참조된 identity를 이름으로
지정해 `LOCAL_RELEASE_DEPENDENCY_MISMATCH`로 실패합니다.

## Build, install, 공개

1. Owner repository가 exact commit을 검증합니다. Build input은 commit된 package manifest와
   lockfile에서 옵니다. Owner manifest와 lockfile은 바뀌지 않습니다.
2. Canonical builder가 flat release output 하나를 만듭니다. Portable component는 `any`를 만들고,
   Sidecar는 선택한 native 또는 Docker toolchain이 지원하는 요청 target을 모두 만듭니다.
   Exact Component Tooling release는 `make verify` 뒤 publication 전에
   `component-build-receipt.json`을 만들며 receipt의 artifact matrix가 release matrix가 됩니다.
3. Local publisher가 output을 검증하고 atomically 저장합니다. 같은 `source.commit`에 같은 byte는
   `unchanged`를 반환하고, 같은 commit에 다른 byte는 `LOCAL_RELEASE_BUILD_NOT_DETERMINISTIC`으로
   실패하며, 다른 commit은 BR12에 따라 version directory를 교체합니다.
4. Local build는 runtime dependency를 주소 지정된 store에서만 해석합니다. 각 `{ id, version }`
   intent를 `<store>/<kind 복수형>/<id>/<version>/release.json`에서 읽어
   `{ id, version, size, sha256 }`으로 기록합니다. 공개 build는 GitHub에서만 해석합니다. Intent에는
   `size`가 없으므로 builder의 읽기는 reference가 없는 root 읽기이며, GitHub에서는
   `MAX_RELEASE_DOCUMENT_BYTES`(1 MiB)로 제한하고 local store에서는 제한하지 않습니다. 선택한
   location에 없는 dependency는 build를 실패시킵니다. Installer는 각 dependency의 `release.json`
   byte를 그것을 참조하는 reference의 size, SHA-256과 비교합니다. 읽기는 reference `size`로
   제한하며(BR13) 다르면 설치가 실패합니다.
5. Shared installer가 host target을 선택하고 closure를 검증·추출한 뒤 directory와 `environment.json`을
   atomically commit합니다. 같은 version과 digest는 멱등입니다. 같은 version과 target의 digest가
   다르면 `VERSION_ARTIFACT_CONFLICT`로 실패합니다.
6. Actions가 main에서 필수 matrix의 owner build를 반복합니다. Publish job은 output을 내려받아 검증하고
   조립하고 공개합니다. Publish job에는 build command가 없습니다.

## 인수 gate

다음 gate가 모두 계속 GREEN이어야 완료입니다. Local-store transaction safety, release 5종, local/registry
transport parity, digest-conflict 거부, Sidecar in-use 거부, event-driven install progress, cross-build/native
evidence 구분, publish-job no-rebuild, 영어/한국어 command·error code 정확한 일치. Component Tooling
receipt와 그것이 묶은 모든 byte도 필수입니다. 이후 실패는 완료 주장을 무효로 만듭니다.

## Command 경계

```sh
make preflight
make prepare
make verify
make build
```

지속 가능한 command 이름은 `make`입니다. Clean checkout에서 sibling repository, 기억해 둔 shell
export, machine-specific path 없이 동작해야 합니다. 필요한 tool이 선택되지 않았다면 preflight가
불일치를 이름으로 알리고 중단하며 다른 설치본을 찾지 않습니다.

GitHub Actions는 선언적 owner에서 tool을 clean job에 주입한 뒤 같은 target을 호출합니다. 선택된 로컬
환경도 같은 target을 호출합니다. direct pnpm 진입점은 같은 선언을 강제하지만 tool을 선택하거나
설치하지 않습니다. Release 전용
target은 명시적 target triple과 staging directory를 받을 수 있지만 publication credential과
GitHub release 변경은 Actions에만 둡니다.

```sh
soksak-sdk package <kind-specific-options>
soksak-sdk attest <release-and-execution-options>
soksak-local-release publish --store <absolute-store> --release <absolute-release-directory>
soksak-local-release verify --store <absolute-store>
soksak-local-release inspect --store <absolute-store> --kind plugin --id <id> --version <version>
soksak-local-release delete --store <absolute-store> --kind plugin --id <id> --version <version>
```

Component Tooling이 build, kind별 packaging, attestation을 소유합니다. Spec의 local-release
command는 owner 저장소를 clone하거나 build하지 않습니다. exact build receipt가 이미 첨부된 release만
받아 전체 asset set을 검증하고 지정된 store를 atomically 변경합니다. Runtime dependency는 그
`--store`에서만 해석합니다.
