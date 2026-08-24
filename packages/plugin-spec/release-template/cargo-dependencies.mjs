import fs from "node:fs";
import path from "node:path";

function field(section, name) {
  return section.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, "m"))?.[1];
}

function reject(file, detail) {
  throw new Error(`local Cargo dependency is not a release input: ${file} ${detail}`);
}

function packageSection(manifest) {
  const lines = manifest.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[package]");
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

export function assertNoLocalCargoDependencies(root) {
  const manifestPath = path.join(root, "Cargo.toml");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  if (/\bpath\s*=\s*["']/.test(manifest)) reject(manifestPath, "path dependency");
  const identity = packageSection(manifest);
  const packageName = field(identity, "name");
  const packageVersion = field(identity, "version");
  if (!packageName || !packageVersion) throw new Error("Cargo package identity is missing");

  const configPath = path.join(root, ".cargo", "config.toml");
  if (fs.existsSync(configPath)) {
    const config = fs.readFileSync(configPath, "utf8");
    if (/\bpath\s*=\s*["']/.test(config) || /=\s*["'](?:\.\.[\\/]|\/|[A-Za-z]:[\\/])/.test(config)) {
      reject(configPath, "local path setting");
    }
  }

  const lockPath = path.join(root, "Cargo.lock");
  if (!fs.existsSync(lockPath)) return;
  const lock = fs.readFileSync(lockPath, "utf8");
  for (const block of lock.split(/(?=^\[\[package\]\]\s*$)/m)) {
    if (!/^\[\[package\]\]/m.test(block)) continue;
    const name = field(block, "name");
    const version = field(block, "version");
    const source = field(block, "source");
    if (!source && (name !== packageName || version !== packageVersion)) {
      reject(lockPath, `${name ?? "unknown"}@${version ?? "unknown"} has no immutable source`);
    }
  }
}
