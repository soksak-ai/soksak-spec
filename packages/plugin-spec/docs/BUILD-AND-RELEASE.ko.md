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
  않습니다.
- **BR3 — 주입된 환경.** 설치된 executable path, workspace-relative repository 탐색,
  주입된 `PATH`, symlink, cache 위치, fallback tool을 source에 기록하지 않습니다. 개발자는 표준
  수단으로 환경을 선택하며 다른 tool이 함께 설치되어 있어도 됩니다. Clean CI job은 선언된
  version을 주입합니다. `make preflight`는 주소 지정된 executable만 확인하고 제품 command 전에
  불일치를 거부하며 다른 설치본을 탐색하거나 설치하지 않습니다. Bootstrap executable에서 위임하는
  package manager는 bootstrap package 자체 version이 아니라 대상 repository에서 반환한 effective
  version으로 판정합니다.
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
- **BR10 — Candidate artifact는 seal하며 공개하지 않습니다.** Release 전에 각 component owner가
  자기 candidate output을 `candidate-artifact.json`으로 seal합니다. Envelope는 canonical
  `release.json` 하나, 모든 local release asset, build evidence, source commit, component identity,
  byte size와 SHA-256을 결합합니다. Actions는 tag나 release를 만들지 않고 해당 directory를 upload할
  수 있습니다. 제품 workflow는 그 byte를 download하고 검증하며 형제 source를 build하지 않습니다.
  파일 추가, 누락, 변경은 artifact 전체를 무효로 만듭니다.
- **BR11 — Local release는 공개 release 형식을 사용합니다.** Local release에는 GitHub Release와
  동일한 `release.json`, source commit, manifest, evidence, target artifact, size, SHA-256이 있습니다.
  이 문서에는 local path를 기록하지 않습니다. Local store는 release document를 바꾸지 않고 공개
  asset URL을 regular file에 대응시킵니다.
- **BR12 — Local version directory 하나가 release transaction 하나입니다.**
  `local/releases/<kind 복수형>/<id>/<version>`이 존재하는 동안 그 byte는 immutable입니다. 같은 byte의
  재발행은 멱등이고 다른 byte는 `LOCAL_RELEASE_VERSION_CONFLICT`로 실패합니다. 공개하지 않은
  version을 다시 사용하려면 version directory 전체를 삭제하고 이전 size 또는 digest를 선언했던 모든
  local dependent를 다시 build해야 합니다. 일부 file만 교체한 상태는 언제나 잘못입니다.
- **BR13 — Installer는 하나이며 transport는 identity가 아닙니다.** Local install과 registry install은
  같은 closure resolver, target selector, validator, extractor, consent summary, progress stream, atomic
  environment commit을 사용합니다. HTTPS와 local-store read는 exact release reference의 transport입니다.
  Local file은 명시한 store 아래에 있고 name, size, SHA-256이 `release.json`과 같을 때만 사용할 수
  있습니다. Raw source path와 `file:` URL은 금지합니다.
- **BR14 — Build evidence는 execution evidence가 아닙니다.** Owner toolchain 또는 관리되는 Docker
  cross-builder가 지원하는 모든 target을 build할 수 있습니다. Cross-build 성공은 target archive와
  native header를 증명하지만 해당 OS의 실행을 증명하지 않습니다. Native, emulated, VM, cross-build
  evidence는 환경을 이름으로 기록하며 서로를 대신하지 않습니다.
- **BR15 — GitHub Actions가 공개를 승인합니다.** Actions는 exact main commit에서 같은 owner command로
  full matrix를 build하고 complete release 하나를 조립하며, publish job에서 rebuild하지 않고 검증된
  byte를 공개합니다. Local GREEN은 개발 증거이며 필수 Actions matrix가 공개 증거입니다.
- **BR16 — Local 검증을 먼저 사용합니다.** 개발 반복은 owner gate, 관리되는 Docker cross-build, local
  release-store 검증, installed-product test를 로컬에서 실행합니다. Local에서 만들 수 없는 native evidence
  또는 최종 공개 candidate에만 Actions run을 시작합니다. Source나 선언된 환경이 바뀌지 않았다면 실패한
  run을 다시 실행하지 않습니다.

## Component와 상태 소유권

Plugin과 Sidecar release는 runtime installation이 됩니다. Kit release는 재사용 build 구현을, Contract
release는 공유 type 또는 protocol input을, Spec release는 platform schema와 validator를 제공합니다.
Kit, Contract, Spec identity는 release reference와 candidate build receipt에 남습니다. Core는 이들을
runtime process로 기록하지 않습니다.

`environment.json`은 Plugin과 Sidecar runtime 선택만 기록합니다. 각 record에는 exact version,
materialized path, source(`local` 또는 `registry`), artifact SHA-256이 있습니다. Sidecar는 target을,
Plugin은 enabled 상태를 추가로 기록합니다. Release와 build receipt는 repository, source commit,
dependency URL, size, digest를 보존합니다.

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
segment이며 추가 store directory가 아닙니다. Publisher는 source output을 검증하고 private sibling
directory에 복사하며 복사본을 다시 검증한 뒤 atomic rename합니다. 실패하면 final directory가
노출되지 않습니다.

Store operation은 `publish`, `list`, `inspect`, `verify`, `delete`가 전부입니다. `delete`는 exact kind,
id, version 하나를 받습니다. 설치된 component를 제거하거나 process를 종료하지 않습니다.

## Build, install, 공개

1. Owner repository가 exact commit을 검증합니다. 공개하지 않은 build dependency는 canonical isolated
   candidate materializer에만 들어가며 owner manifest와 lockfile은 바뀌지 않습니다.
2. Canonical builder가 flat release output 하나를 만듭니다. Portable component는 `any`를 만들고,
   Sidecar는 선택한 native 또는 Docker toolchain이 지원하는 요청 target을 모두 만듭니다.
3. Local publisher가 output을 검증하고 atomically 저장합니다. 같은 byte는 `unchanged`를 반환하고 같은
   version의 다른 byte는 거부합니다.
4. Local resolver가 명시한 Plugin 또는 Sidecar root를 읽습니다. Local에 존재하는 dependency는 parent의
   URL, size, SHA-256과 정확히 같아야 하며 다르면 설치가 실패합니다. Local에 없으면 exact HTTPS
   reference를 사용할 수 있습니다.
5. Shared installer가 host target을 선택하고 closure를 검증·추출한 뒤 directory와 `environment.json`을
   atomically commit합니다. 같은 version과 digest는 멱등입니다. 같은 version과 target의 digest가
   다르면 `VERSION_ARTIFACT_CONFLICT`로 실패합니다.
6. Actions가 main에서 필수 matrix의 owner build를 반복합니다. Publish job은 output을 내려받아 검증하고
   조립하고 공개합니다. Publish job에는 build command가 없습니다.

## 인수 gate

다음 gate가 모두 계속 GREEN이어야 완료입니다. Local-store transaction safety, release 5종, local/registry
transport parity, digest-conflict 거부, Sidecar in-use 거부, event-driven install progress, cross-build/native
  evidence 구분, publish-job no-rebuild, 영어/한국어 command·error code 정확한 일치. 이후 실패는 완료
  주장을 무효로 만듭니다.

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

GitHub Actions는 선언적 owner에서 tool을 clean job에 주입한 뒤 같은 target을 호출합니다. Release 전용
target은 명시적 target triple과 staging directory를 받을 수 있지만 publication credential과
GitHub release 변경은 Actions에만 둡니다.

Repository 소유 build와 canonical release packager가 평면 output directory 하나를 만든 뒤 다음
공개 release-template command로 seal 및 검증합니다.

```sh
node <plugin-spec>/release-template/seal-candidate-artifact.mjs \
  --directory <absolute-output-directory> \
  --evidence <optional-build-evidence.json>
node <plugin-spec>/release-template/verify-candidate-artifact.mjs \
  --directory <absolute-output-directory>
```

Node candidate의 `candidate-build.json`은 자동으로 발견합니다. 그 밖의 build evidence는 명시적으로
이름을 전달합니다. 두 command 모두 upload나 publish를 수행하지 않습니다.

```sh
soksak-local-release build --store <absolute-store> --source <absolute-clean-owner-repository>
soksak-local-release build --store <absolute-store> --source <absolute-clean-sidecar-repository> --targets <target-one>,<target-two>
soksak-local-release publish --store <absolute-store> --release <absolute-release-directory>
soksak-local-release verify --store <absolute-store>
soksak-local-release inspect --store <absolute-store> --kind plugin --id <id> --version <version>
soksak-local-release delete --store <absolute-store> --kind plugin --id <id> --version <version>
```

`build`는 exact clean owner commit을 disposable directory에 clone하고 owner Make gate와 canonical
packager를 실행하며 검증된 release를 atomically 저장한 뒤 clone을 제거합니다. Sidecar target은 선택한
native 또는 관리되는 Docker 환경이 해당 owner preflight를 통과할 때만 build할 수 있습니다. Command는
owner preflight를 약화하거나 raw compiler command로 바꾸지 않습니다.
