#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_version=$(node -p "require('$root/package.json').engines.node")
pnpm_version=$(node -p "require('$root/package.json').packageManager.split('@')[1]")
go_version=$(awk '$1 == "go" { print $2 }' "$root/go/platformspec/go.mod")
rust_version=$(sed -n 's/^channel = "\(.*\)"/\1/p' "$root/rust-toolchain.toml")

dockerfile=$(mktemp)
trap 'rm -f "$dockerfile"' EXIT HUP INT TERM
cat >"$dockerfile" <<EOF
FROM node:$node_version-bookworm AS node
FROM golang:$go_version-bookworm AS go
FROM rust:$rust_version-bookworm AS rust
FROM node
COPY --from=rust /usr/local/cargo/ /usr/local/cargo/
COPY --from=rust /usr/local/rustup/ /usr/local/rustup/
COPY --from=go /usr/local/go/ /usr/local/go/
ENV CARGO_HOME="/usr/local/cargo" RUSTUP_HOME="/usr/local/rustup"
ENV PATH="/usr/local/cargo/bin:/usr/local/go/bin:${PATH}"
RUN npm install --global pnpm@$pnpm_version --ignore-scripts --no-update-notifier --no-fund
EOF
exec docker build -f "$dockerfile" -t soksak-spec-verify:local "$root"
