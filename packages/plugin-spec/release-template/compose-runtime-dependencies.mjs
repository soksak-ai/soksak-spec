// Manifest is intent: a manifest names each runtime dependency by { id, version }. The release
// document pins each dependency as { id, version, size, sha256 } where size and sha256 are of that
// dependency's release.json. The builder composes the pins through a resolver; it never copies the
// manifest's runtimeDependencies.
import { parseReleaseManifest } from "../dist/release.js";
import { sha256 } from "./archive.mjs";

export class RuntimeDependencyError extends Error {
  constructor(kind, id, version, cause) {
    super(`runtime dependency ${kind} ${id}@${version}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "RuntimeDependencyError";
  }
}

async function composeGroup(kind, intents, resolver) {
  const references = [];
  for (const { id, version } of intents) {
    let bytes;
    // An intent has no size: this is a root read without a reference, bounded by
    // MAX_RELEASE_DOCUMENT_BYTES in the GitHub resolver and unbounded in the local-store resolver.
    // The composed reference records the size and sha256 of the bytes read.
    try {
      ({ bytes } = await resolver.read({ kind, id, version }));
    } catch (error) {
      throw new RuntimeDependencyError(kind, id, version, error);
    }
    let raw;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new RuntimeDependencyError(kind, id, version, error);
    }
    const parsed = parseReleaseManifest(raw);
    if (!parsed.ok) throw new RuntimeDependencyError(kind, id, version, new Error(parsed.errors.join("; ")));
    const release = parsed.value;
    if (release.kind !== kind || release.id !== id || release.version !== version) {
      throw new RuntimeDependencyError(kind, id, version, new Error(`resolved release is ${release.kind} ${release.id}@${release.version}`));
    }
    references.push({ id, version, size: bytes.length, sha256: sha256(bytes) });
  }
  return references;
}

// intents: { plugins?: [{ id, version }], sidecars?: [{ id, version }] } or undefined.
// Returns { plugins?: [reference], sidecars?: [reference] } in manifest order, or undefined.
export async function composeRuntimeDependencies({ intents, resolver }) {
  if (intents === undefined) return undefined;
  const plugins = intents.plugins ? await composeGroup("plugin", intents.plugins, resolver) : undefined;
  const sidecars = intents.sidecars ? await composeGroup("sidecar", intents.sidecars, resolver) : undefined;
  return { ...(plugins ? { plugins } : {}), ...(sidecars ? { sidecars } : {}) };
}
