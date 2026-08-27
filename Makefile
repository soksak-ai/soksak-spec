SHELL := /bin/sh

.PHONY: preflight prepare build verify release publish require-registry

# REGISTRY is a make command-line argument; a value from the environment or a file is refused.
publish_flags = --registry "$(REGISTRY)" --@soksak:registry="$(REGISTRY)" --@soksak-ai:registry="$(REGISTRY)" --no-git-checks

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

require-registry:
	@case "$(origin REGISTRY)" in "command line") ;; undefined) echo 'REGISTRY must be given on the make command line: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; *) echo 'REGISTRY from the $(origin REGISTRY) is refused: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; esac
	@case "$(REGISTRY)" in http://*|https://*) ;; *) echo 'REGISTRY must be an absolute URL: make publish REGISTRY=http://host:port/' >&2; exit 64 ;; esac

publish: require-registry release
	set -- artifacts/*.tgz; test $$# -eq 1 && test -f "$$1" || { echo 'artifacts/ must hold exactly one package archive' >&2; exit 65; }; CI=1 PNPM_DISABLE_SELF_UPDATE_CHECK=1 pnpm publish "$$1" $(publish_flags)
