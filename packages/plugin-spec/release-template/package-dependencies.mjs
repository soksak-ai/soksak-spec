import fs from "node:fs";
import path from "node:path";

const LOCAL_SCHEME = /(?:^|@)(?:file|link|workspace|portal|catalog):/i;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const PARENT_RELATIVE = /^(?:\.\.[\\/]|\.\.$)/;

function localDependency(value) {
  if (typeof value !== "string") return false;
  const specifier = value.trim().replace(/^['"]|['"]$/g, "");
  return LOCAL_SCHEME.test(specifier) || path.posix.isAbsolute(specifier) ||
    WINDOWS_ABSOLUTE.test(specifier) || PARENT_RELATIVE.test(specifier);
}

function checkValues(value, field, packagePath) {
  if (typeof value === "string") {
    if (localDependency(value)) {
      throw new Error(`local dependency is not a release input: ${packagePath} ${field}=${value}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [name, nested] of Object.entries(value)) {
    checkValues(nested, `${field}.${name}`, packagePath);
  }
}

export function assertNoLocalPackageDependencies(packagePath) {
  const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const field of [
    "dependencies", "devDependencies", "peerDependencies", "optionalDependencies",
    "overrides", "resolutions", "pnpm",
  ]) {
    checkValues(metadata[field], field, packagePath);
  }

  const lockPath = path.join(path.dirname(packagePath), "pnpm-lock.yaml");
  if (fs.existsSync(lockPath)) {
    const lines = fs.readFileSync(lockPath, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const values = [...line.matchAll(/(?:specifier|version|tarball):\s*([^,}\s]+|['"][^'"]+['"])/g)]
        .map((match) => match[1]);
      const packageKey = line.match(/@(?:file|link|workspace|portal|catalog):[^'"\s]+/i)?.[0];
      if (packageKey) values.push(packageKey.slice(1));
      for (const value of values) {
        if (localDependency(value)) {
          throw new Error(`local dependency is not a release input: ${lockPath}:${index + 1} ${value}`);
        }
      }
    }
  }

  const workspacePath = path.join(path.dirname(packagePath), "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) return;
  const workspaceLines = fs.readFileSync(workspacePath, "utf8").split(/\r?\n/);
  for (let index = 0; index < workspaceLines.length; index += 1) {
    const line = workspaceLines[index];
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const value = line.slice(separator + 1).replace(/\s+#.*$/, "").trim();
    if (localDependency(value)) {
      throw new Error(`local dependency is not a release input: ${workspacePath}:${index + 1} ${value}`);
    }
  }
}
