#!/usr/bin/env node
import path from "node:path";

import { deleteLocalRelease, inspectLocalRelease, publishLocalRelease, verifyLocalReleaseStore } from "./local-release-store.mjs";
import { buildLocalRelease } from "./local-release-build.mjs";
import { isEntryModule } from "./entry.mjs";

function parse(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!key?.startsWith("--") || rest[index + 1] === undefined || values[key.slice(2)] !== undefined) throw new Error("named options are required");
    values[key.slice(2)] = rest[index + 1];
  }
  return { command, values };
}

export function runLocalRelease(argv) {
  const { command, values } = parse(argv);
  if (!path.isAbsolute(values.store ?? "")) throw new Error("--store must be absolute");
  if (command === "build") {
    if (!path.isAbsolute(values.source ?? "")) throw new Error("build requires absolute --source");
    const targets = values.targets ? values.targets.split(",").filter(Boolean) : [];
    if (Object.keys(values).some((key) => !["store", "source", "targets", "registry"].includes(key))) throw new Error("build accepts --store, --source, --targets, and --registry");
    if (values.registry !== undefined && !/^https?:\/\//.test(values.registry)) throw new Error("--registry must be an absolute http(s) URL");
    return buildLocalRelease({ store: values.store, source: values.source, targets, registry: values.registry });
  }
  if (command === "publish") {
    if (!path.isAbsolute(values.release ?? "") || Object.keys(values).some((key) => !["store", "release"].includes(key))) throw new Error("publish requires --store and --release");
    return publishLocalRelease({ store: values.store, release: values.release });
  }
  if (command === "verify" || command === "list") {
    if (Object.keys(values).length !== 1) throw new Error(`${command} requires only --store`);
    return verifyLocalReleaseStore({ store: values.store });
  }
  if (command === "inspect" || command === "delete") {
    if (Object.keys(values).sort().join(",") !== "id,kind,store,version") throw new Error(`${command} requires --store --kind --id --version`);
    const input = { store: values.store, kind: values.kind, id: values.id, version: values.version };
    return command === "inspect" ? inspectLocalRelease(input) : deleteLocalRelease(input);
  }
  throw new Error("command must be build, publish, list, inspect, verify, or delete");
}

if (isEntryModule(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(runLocalRelease(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
