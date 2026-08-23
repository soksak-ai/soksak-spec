# 플러그인 배포

이 문서는 배포 계약의 한국어 번역본이다. [영문 정본](PLUGIN-DISTRIBUTION.md)이 규범이다.
Soksak이 사용자에게 노출하는 설치 단위는 플러그인이다. Sidecar는 플러그인의 정확한 runtime
dependency이며 Kit·contract·spec·언어 라이브러리는 빌드 입력이다.

## 소유 저장소 입력

작성자는 `plugin.json`과 표준 빌드 manifest·lockfile을 작성한다. 빌드 dependency는
`package.json`, `Cargo.toml`, `go.mod`에 남는다. 별도 설치 component만
`plugin.json.runtimeDependencies`에 평평한 `{id, version, url, size, sha256}` 형식으로 선언한다.
배열 위치가 plugin인지 Sidecar인지 나타내며 role, provider alias, interface 복사, 범위, `latest`,
fallback은 없다. dependency가 없으면 필드와 빈 배열을 생략한다. 참조가 바뀌면 plugin 버전도
올린다.

## 자동 릴리스

공용 builder는 lockfile, self-contained artifact, 전체 runtime dependency chain을 검증하고
`release.json`을 생성한다. Plugin과 Sidecar는 같은 `kind/id/version` 평면 형식을 사용한다.
`manifest`, `artifacts`, 모든 크기·digest, `evidence`는 자동 산출물이다. `evidence`는 conformance
기록이며 설치 대상이 아니다. 작성자는 이를 직접 쓰지 않는다.

## Registry PR과 릴리스

하나의 PR은 `plugins/<id>.json` 하나만 추가하거나 교체한다. 내용은 plugin release를 가리키는
평평한 참조 하나다. Registry workflow는 모든 불변 release를 검증하고 인증된 `registry.json`을
릴리스한다. 최종 Registry는 plugin과 직접 `runtimeDependencies`만 포함한다. 전이 dependency는
각자의 해시 고정 release에 남는다. `installs`, `packages`, 독립 Sidecar 배열, 빌드 dependency
catalogue는 없다.

신뢰 공개키는 Core에 내장하며 Registry에서 받지 않는다. Core는 서명, ID, 만료, sequence,
rollback, equivocation, 모든 release 참조와 artifact를 사용 전에 검증한다.

## 사용자 동의와 설치

Core는 실행 artifact를 받기 전에 직접·전이 metadata를 모두 해석한다. 동의 화면은 권한과 추가
component의 ID·버전을 표시한다. 상세 화면은 종류, 저장소, 플랫폼 artifact, 크기, digest,
manifest, interface, evidence를 보여준다. 동의 후 전체 폐쇄를 staging하고 파일과
`environment.json`을 원자적으로 commit한다. 하나라도 실패하면 기존 환경을 변경하지 않는다.

Registry 버전이 설치 버전보다 클 때만 Update다. 같거나 낮으면 Installed이며 development source는
관리형 업데이트를 받지 않는다.
