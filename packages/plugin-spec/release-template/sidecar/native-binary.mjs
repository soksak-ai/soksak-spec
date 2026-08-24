export function assertNativeBinaryTarget(bytes, target) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`binary target ${target}: bytes are required`);
  const expectedArchitecture = target.startsWith("aarch64-") ? "arm64" : "x86_64";
  let format;
  let architecture;
  if (target.endsWith("apple-darwin")) {
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf) {
      throw new Error(`binary target ${target}: thin 64-bit Mach-O required`);
    }
    format = "mach-o";
    const cpu = bytes.readUInt32LE(4);
    architecture = cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x86_64" : "unknown";
  } else if (target.includes("unknown-linux")) {
    if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
        bytes[4] !== 2 || bytes[5] !== 1) {
      throw new Error(`binary target ${target}: little-endian ELF64 required`);
    }
    format = "elf";
    const machine = bytes.readUInt16LE(18);
    architecture = machine === 183 ? "arm64" : machine === 62 ? "x86_64" : "unknown";
  } else if (target === "x86_64-pc-windows-msvc") {
    if (bytes.length < 0x40 || bytes.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error(`binary target ${target}: PE32+ required`);
    }
    const pe = bytes.readUInt32LE(0x3c);
    if (pe > bytes.length - 26 || bytes.subarray(pe, pe + 4).toString("binary") !== "PE\0\0" ||
        bytes.readUInt16LE(pe + 24) !== 0x20b) {
      throw new Error(`binary target ${target}: PE32+ signature required`);
    }
    format = "pe";
    architecture = bytes.readUInt16LE(pe + 4) === 0x8664 ? "x86_64" : "unknown";
  } else {
    throw new Error(`binary target ${target}: unsupported target`);
  }
  if (architecture !== expectedArchitecture) {
    throw new Error(`binary target ${target}: ${format} architecture ${architecture}, want ${expectedArchitecture}`);
  }
  return Object.freeze({ format, architecture });
}
