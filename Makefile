SHELL := /bin/sh

.PHONY: preflight prepare build verify release attest publish require-registry require-tooling

# REGISTRY is a make command-line argument; a value from the environment or a file is refused.
publish_flags = --registry "$(REGISTRY)" --@soksak:registry="$(REGISTRY)" --no-git-checks

preflight:
	@scripts/check-build-environment.sh

prepare: preflight
	@CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm install --frozen-lockfile
	@cargo fetch --locked
	@go -C go/platformspec mod download

build: prepare
	@CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm build

verify: prepare
	@scripts/build-entrypoint.test.sh
	@scripts/check-build-environment.test.sh
	@CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm test

# release:verify packs the package twice, proves the bytes equal, and leaves the archive and its
# release document in artifacts/.
release: verify
	@CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm release:verify

require-tooling:
	@case "$(origin SDK_ROOT)" in "command line") ;; *) echo 'SDK_ROOT must be an absolute command-line path to an extracted soksak-sdk release' >&2; exit 64 ;; esac
	@case "$(origin SDK_RELEASE)" in "command line") ;; *) echo 'SDK_RELEASE must be an absolute command-line path to the exact SDK release.json' >&2; exit 64 ;; esac
	@case "$(SDK_ROOT):$(SDK_RELEASE)" in /*:/*) ;; *) echo 'SDK_ROOT and SDK_RELEASE must be absolute paths' >&2; exit 64 ;; esac
	@test -d "$(SDK_ROOT)" && test ! -L "$(SDK_ROOT)" && test -f "$(SDK_ROOT)/bin/soksak-sdk.mjs" || { echo 'SDK_ROOT is not an extracted regular SDK release' >&2; exit 66; }
	@test -f "$(SDK_RELEASE)" && test ! -L "$(SDK_RELEASE)" || { echo 'SDK_RELEASE is not a regular file' >&2; exit 66; }
	@test -z "$$(find "$(SDK_ROOT)" -type l -print -quit)" || { echo 'SDK_ROOT contains a symbolic link' >&2; exit 66; }

attest: require-tooling release
	@platform="$$(node -p 'process.platform')"; architecture="$$(node -p 'process.arch')"; \
		node_version="$$(node -p 'process.versions.node')"; pnpm_version="$$(pnpm --version)"; \
		rust_version="$$(rustc --version | awk '{print $$2}')"; go_version="$$(go version | awk '{sub(/^go/, "", $$3); print $$3}')"; \
		node "$(SDK_ROOT)/bin/soksak-sdk.mjs" attest --release-dir "$(CURDIR)/artifacts" \
		--spec-root "$(SDK_ROOT)/.dependencies/soksak-spec" --tooling-release "$(SDK_RELEASE)" \
		--mode native --platform "$$platform" --architecture "$$architecture" \
		--tool "node=$$node_version" --tool "pnpm=$$pnpm_version" --tool "rust=$$rust_version" --tool "go=$$go_version"

require-registry:
	@case "$(origin REGISTRY)" in "command line") ;; undefined) echo 'REGISTRY must be given on the make command line: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; *) echo 'REGISTRY from the $(origin REGISTRY) is refused: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; esac
	@case "$(REGISTRY)" in http://*|https://*) ;; *) echo 'REGISTRY must be an absolute URL: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; esac

publish: require-registry release
	set -- artifacts/*.tgz; test $$# -eq 1 && test -f "$$1" || { echo 'artifacts/ must hold exactly one package archive' >&2; exit 65; }; CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm publish "$$1" $(publish_flags)
