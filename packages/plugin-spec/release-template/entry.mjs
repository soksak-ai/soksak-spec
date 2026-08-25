import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Whether the module at metaUrl is the script Node was started with. process.argv[1] is the path as
// typed or linked (a package manager's bin shim is a symbolic link into node_modules), while
// import.meta.url is the resolved path; the comparison is made on the resolved path.
export function isEntryModule(metaUrl) {
  const script = process.argv[1];
  if (!script) return false;
  let resolved;
  try { resolved = fs.realpathSync(script); } catch { return false; }
  return pathToFileURL(resolved).href === metaUrl;
}
