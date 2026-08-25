import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseVersion = "0.0.30";

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
  assert.match(manifest, /^edition\.workspace\s*=\s*true$/m, path + ": workspace Rust edition");
  assert.equal(manifest.match(/^version\s*=\s*"([^"]+)"$/m)?.[1], releaseVersion, `${path}: release version`);
  assert.match(manifest, /^publish\s*=\s*false$/m, `${path}: registry publication disabled`);
  assert.doesNotMatch(manifest, /path\s*=\s*"\//, `${path}: absolute dependencies are forbidden`);
  assert.doesNotMatch(manifest, /(?:crates\.io|cargo publish)/i, `${path}: registry distribution is forbidden`);
}

test("repository owns a complete reproducible release boundary", () => {
  assert.match(read("Cargo.toml"), /^edition\s*=\s*"2024"$/m, "workspace Rust edition");
  for (const file of [
    "go/platformspec/spec.go",
    "packages/plugin-spec/src/installation.ts",
    "packages/plugin-spec/docs/VERSIONING.md",
    "packages/plugin-spec/docs/VERSIONING.ko.md",
  ]) {
    const source = read(file);
    for (const obsolete of ["settings.json", "installed.json", "parseSettingsDocument", "parseInstalledDocument", "InstalledDocument", "SettingsDocument", "providers"]) {
      assert.equal(source.includes(obsolete), false, file + ": obsolete environment split " + obsolete);
    }
  }
  const versioning = read("packages/plugin-spec/docs/VERSIONING.md").replaceAll("`", "");
  for (const rule of ["environment.json is the only local runtime discovery surface", "injected repository root", "workspace checkout path", "sibling-source topology"]) {
    assert.ok(versioning.includes(rule), "versioning policy omits " + rule);
  }
  for (const path of [
    ".node-version",
    ".github/workflows/candidate.yml",
    ".github/workflows/node-candidate.yml",
    ".github/workflows/sidecar-candidate.yml",
    ".github/workflows/release.yml",
    ".github/workflows/verify.yml",
    ".gitignore",
    "Cargo.lock",
    "Makefile",
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
  assert.match(workspace.engines.node, /^\d+\.\d+\.\d+$/);
  assert.match(workspace.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
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
    manifest: "release.json",
  });

  const pluginSpec = json("packages/plugin-spec/package.json");
  assert.equal(pluginSpec.version, releaseVersion);
  assert.equal(pluginSpec.private, true);
  assert.equal(pluginSpec.publishConfig, undefined);
  assert.ok(pluginSpec.files.includes("release-template"));

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
  assert.match(read("rust-toolchain.toml"), /^channel\s*=\s*"\d+\.\d+\.\d+"$/m);
  const pnpmWorkspace = read("pnpm-workspace.yaml");
  assert.match(pnpmWorkspace, /nodeLinker: hoisted/);
  assert.match(pnpmWorkspace, /storeDir: [.]pnpm-store/);
  assert.match(pnpmWorkspace, /symlink: false/);
  assert.match(pnpmWorkspace, /preferSymlinkedExecutables: false/);
  assert.match(pnpmWorkspace, /allowBuilds:/);
  const verifier = read("scripts/build-verifier-image.sh");
  assert.match(verifier, /package\.json/);
  assert.match(verifier, /go\/platformspec\/go\.mod/);
  assert.match(verifier, /rust-toolchain\.toml/);
  assert.doesNotMatch(verifier, /(?:node|golang|rust):\d/);
  assert.match(verifier, /--no-update-notifier --no-fund/);

  for (const workflow of [".github/workflows/candidate.yml", ".github/workflows/release.yml", ".github/workflows/verify.yml"]) {
    const source = read(workflow);
    assert.match(source, /actions\/setup-go@[a-f0-9]{40}/);
    assert.match(source, /go-version-file:\s*(?:source\/)?go\/platformspec\/go\.mod/);
    assert.match(source, /node-version-file:\s*(?:source\/)?[.]node-version/);
    assert.match(source, /package_json_file:\s*(?:source\/)?package\.json/);
    assert.doesNotMatch(source, /node-version:\s*["']?\d/);
    assert.doesNotMatch(source, /pnpm\/action-setup@[a-f0-9]{40}\n\s+with:\n\s+version:/);
    assert.match(source, /rust-toolchain\.toml/);
    const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, `${workflow}: actions required`);
    for (const action of uses) {
      assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/, `${workflow}: action must use a full commit: ${action}`);
    }
  }

  const verifyWorkflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.doesNotMatch(verifyWorkflow, /^\s*push:/m, "release validation must not repeat on main push");
  for (const required of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  ]) assert.ok(verifyWorkflow.includes(required), `verify workflow does not pin ${required}`);
});
