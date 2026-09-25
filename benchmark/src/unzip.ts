// Reads one entry from a zip archive (stored or deflated; no zip64), enough
// for the UCI downloads without a dependency.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

import { inflateRawSync } from "node:zlib";

export function unzipEntry(zip: Uint8Array, name: string): Uint8Array {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last 0x06054b50 signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("not a zip file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const next =
      p + 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const local = buf.readUInt32LE(p + 42);
      const start =
        local +
        30 +
        buf.readUInt16LE(local + 26) +
        buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return new Uint8Array(data);
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p = next;
  }
  throw new Error(`${name} not found in zip`);
}
