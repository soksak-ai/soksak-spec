import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseVersion = "0.0.3";

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function regularTree(at = root, prefix = "") {
  const violations = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (prefix === "" && [".git", "artifacts", "node_modules", "target"].includes(entry.name)) continue;
    if (prefix === "packages/plugin-spec" && entry.name === "dist") continue;
    const path = join(at, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) violations.push(relative);
    else if (stat.isDirectory()) violations.push(...regularTree(path, relative));
    else if (!stat.isFile()) violations.push(relative);
  }
  return violations;
}

function symbolicLinks(at, prefix = "") {
  if (!existsSync(at)) return [];
  const violations = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) violations.push(relative);
    else if (stat.isDirectory()) violations.push(...symbolicLinks(path, relative));
  }
  return violations;
}

function assertCargoPackage(path) {
  const manifest = read(path);
  assert.equal(manifest.match(/^version\s*=\s*"([^"]+)"$/m)?.[1], releaseVersion, `${path}: release version`);
  assert.match(manifest, /^publish\s*=\s*false$/m, `${path}: registry publication disabled`);
  assert.doesNotMatch(manifest, /path\s*=\s*"\//, `${path}: absolute dependencies are forbidden`);
  assert.doesNotMatch(manifest, /(?:crates\.io|cargo publish)/i, `${path}: registry distribution is forbidden`);
}

test("repository owns a complete reproducible release boundary", () => {
  for (const path of [
    ".github/workflows/release.yml",
    ".github/workflows/verify.yml",
    ".gitignore",
    ".nvmrc",
    "Cargo.lock",
    "go/platformspec/go.mod",
    "go/platformspec/go.sum",
    "LICENSE",
    "README.md",
    "package.json",
    "pnpm-lock.yaml",
    "rust-toolchain.toml",
    "scripts/publish-release.mjs",
    "scripts/release-context.mjs",
    "scripts/release-verify.mjs",
    "vitest.config.mjs",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `required repository file: ${path}`);
  }

  const workspace = json("package.json");
  assert.equal(workspace.private, true);
  assert.equal(workspace.version, releaseVersion);
  assert.equal(workspace.packageManager, "pnpm@10.30.3");
  assert.equal(workspace.scripts?.build, "pnpm --filter @soksak-ai/plugin-spec build");
  assert.equal(
    workspace.scripts?.["test:unit"],
    "pnpm build && node --test scripts/*.test.mjs && vitest run --config vitest.config.mjs && cargo test --workspace --locked && cd go/platformspec && go test ./... && go vet ./...",
  );
  assert.equal(workspace.scripts?.["release:verify"], "node scripts/release-verify.mjs");
  assert.equal(workspace.scripts?.test, "pnpm test:unit && pnpm release:verify");
  assert.equal(
    Object.entries(workspace.scripts ?? {}).some(([name, command]) =>
      /publish/i.test(name) || /(?:npm|pnpm|cargo)\s+publish/.test(String(command))
    ),
    false,
  );
  assert.deepEqual(workspace.soksakRelease, {
    spec: { id: "soksak-spec", version: releaseVersion },
    repository: "https://github.com/soksak-ai/soksak-spec",
    manifest: "soksak-spec-release.json",
  });

  const pluginSpec = json("packages/plugin-spec/package.json");
  assert.equal(pluginSpec.version, releaseVersion);
  assert.equal(pluginSpec.private, true);
  assert.equal(pluginSpec.publishConfig, undefined);

  for (const crate of [
    "crates/soksak-spec-contract/Cargo.toml",
    "crates/soksak-spec-service/Cargo.toml",
    "crates/soksak-spec-socket/Cargo.toml",
  ]) {
    assertCargoPackage(crate);
  }

  const releaseWorkflow = read(".github/workflows/release.yml");
  assert.match(releaseWorkflow, /\bon:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(releaseWorkflow, /\btags:/);
  assert.doesNotMatch(releaseWorkflow, /(?:^|[^A-Z_])v?0\.0\.1(?:$|[^0-9])/m, "workflow never owns a product version");
  assert.match(releaseWorkflow, /permission-administration:\s*read/);
  assert.match(releaseWorkflow, /permission-contents:\s*write/);
  assert.match(releaseWorkflow, /SOKSAK_RELEASE_TOKEN:/);
  assert.doesNotMatch(releaseWorkflow, /\bGITHUB_TOKEN\b/);
  assert.doesNotMatch(releaseWorkflow, /github\.token/);
  assert.match(
    releaseWorkflow,
    /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/,
  );

  for (const script of ["scripts/release-verify.mjs", "scripts/publish-release.mjs"]) {
    const source = read(script);
    assert.doesNotMatch(source, /\bconst\s+(?:VERSION|version|TAG|tag)\s*=\s*["'](?:v?0\.0\.1)["']/);
    assert.doesNotMatch(source, /\.version\s*!==\s*["']0\.0\.1["']/);
  }

  assert.deepEqual(regularTree(), [], "source tree contains only regular files and directories");
  assert.deepEqual(
    symbolicLinks(join(root, "node_modules"), "node_modules"),
    [],
    "installed dependencies contain no symbolic links",
  );
  assert.equal(read(".nvmrc").trim(), "22.12.0");
  assert.match(read("rust-toolchain.toml"), /^channel\s*=\s*"1\.96\.0"$/m);

  for (const workflow of [".github/workflows/release.yml", ".github/workflows/verify.yml"]) {
    const source = read(workflow);
    const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${workflow}: actions required`);
    for (const action of uses) {
      assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${workflow}: action must use a full commit: ${action}`);
    }
  }
});
