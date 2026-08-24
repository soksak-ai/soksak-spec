import zlib from "node:zlib";

function tarOctal(block, offset, width, label) {
  const value = block.subarray(offset, offset + width).toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]*$/.test(value)) throw new Error(`invalid tar ${label}`);
  return Number.parseInt(value || "0", 8);
}

function paxPath(bytes) {
  let offset = 0;
  let result;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) throw new Error("invalid PAX record length");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new Error("invalid PAX record length");
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 0x0a) throw new Error("invalid PAX record");
    const record = bytes.subarray(space + 1, end - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals < 1) throw new Error("invalid PAX record");
    if (record.slice(0, equals) === "path") result = record.slice(equals + 1);
    offset = end;
  }
  return result;
}

export function readSidecarReleaseArchive(bytes) {
  const blockSize = 512;
  const tar = zlib.gunzipSync(bytes);
  const entries = [];
  const seen = new Set();
  let extendedPath;
  for (let offset = 0; offset + blockSize <= tar.length; ) {
    const block = tar.subarray(offset, offset + blockSize);
    if (block.every((byte) => byte === 0)) break;
    const checksum = Buffer.from(block);
    checksum.fill(0x20, 148, 156);
    if (tarOctal(block, 148, 8, "checksum") !== checksum.reduce((sum, byte) => sum + byte, 0)) {
      throw new Error("invalid tar checksum");
    }
    const headerName = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const rawName = extendedPath ?? (prefix ? `${prefix}/${headerName}` : headerName);
    const size = tarOctal(block, 124, 12, "size");
    const type = String.fromCharCode(block[156] || 0x30);
    const dataStart = offset + blockSize;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("truncated archive entry");
    if (type === "L") {
      extendedPath = tar.subarray(dataStart, dataEnd).toString("utf8").replace(/\0.*$/, "");
    } else if (type === "x") {
      extendedPath = paxPath(tar.subarray(dataStart, dataEnd)) ?? extendedPath;
    } else if (type === "g") {
      paxPath(tar.subarray(dataStart, dataEnd));
    } else if (type === "5") {
      if (size !== 0) throw new Error(`directory archive entry contains data: ${rawName}`);
      extendedPath = undefined;
    } else if (type === "0" || type === "\0") {
      const name = rawName.replace(/^\.\//, "").replace(/\/$/, "");
      if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error(`unsafe archive path: ${rawName}`);
      }
      if (seen.has(name)) throw new Error(`duplicate archive path: ${name}`);
      seen.add(name);
      entries.push({ name, data: tar.subarray(dataStart, dataEnd) });
      extendedPath = undefined;
    } else {
      throw new Error(`non-regular archive entry: ${rawName}`);
    }
    offset = dataStart + Math.ceil(size / blockSize) * blockSize;
  }
  return entries;
}
