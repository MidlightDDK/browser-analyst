// `pnpm bench:data`: downloads each dataset in datasets.json (cached in
// benchmark/data/raw/), checks its sha256, derives the benchmark copy, and
// checks that copy's sha256 and row count. `--hashes` prints the copies'
// hashes instead of failing on a mismatch (after an intended change).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { xlsxToCsv } from "@browser-analyst/agent";
import { DuckDBInstance } from "@duckdb/node-api";
import { DATA_DIR, type Dataset, loadDatasets } from "./datasets.ts";
import { messyOrdersCsv } from "./messy.ts";
import { unzipEntry } from "./unzip.ts";

const MAX_BYTES = 20 * 1024 * 1024;
const RAW_DIR = `${DATA_DIR}raw/`;
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;

function check(what: string, actual: string, expected: string | undefined) {
  if (expected && actual !== expected)
    throw new Error(`${what}: sha256 ${actual}, expected ${expected}`);
}

async function download(ds: Dataset): Promise<Uint8Array> {
  const url = ds.url as string;
  const path = `${RAW_DIR}${ds.name}${/\.[a-z]+$/.exec(url)?.[0] ?? ""}`;
  if (existsSync(path)) {
    const cached = new Uint8Array(await readFile(path));
    if (sha256(cached) === ds.sha256) return cached;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${ds.name}: HTTP ${res.status} from ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  check(`${ds.name} download`, sha256(bytes), ds.sha256);
  await writeFile(path, bytes);
  return bytes;
}

async function prepare(ds: Dataset, out: string): Promise<void> {
  if (ds.generator === "messy-orders") {
    await writeFile(out, messyOrdersCsv());
    return;
  }
  let bytes = await download(ds);
  const p = ds.prepare ?? {};
  if (p.extract) {
    bytes = unzipEntry(bytes, p.extract);
    check(`${ds.name} ${p.extract}`, sha256(bytes), p.extract_sha256);
  }
  if (p.xlsx) {
    const [first] = await xlsxToCsv(bytes);
    if (!first) throw new Error(`${ds.name}: no sheets`);
    bytes = first.csv;
  }
  if (!p.sql) {
    await writeFile(out, bytes);
    return;
  }
  const src = `${RAW_DIR}${ds.name}.src`;
  await writeFile(src, bytes);
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    await conn.run(
      p.sql.replace("{src}", sqlString(src)).replace("{out}", sqlString(out)),
    );
  } finally {
    conn.closeSync();
    db.closeSync();
    await rm(src);
  }
}

async function countRows(path: string): Promise<number> {
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    const reader = await conn.runAndReadAll(
      `SELECT count(*) FROM ${sqlString(path)}`,
    );
    return Number(reader.getRows()[0]?.[0]);
  } finally {
    conn.closeSync();
    db.closeSync();
  }
}

const printHashes = process.argv.includes("--hashes");
await mkdir(RAW_DIR, { recursive: true });
let failed = false;
for (const ds of await loadDatasets()) {
  const out = `${DATA_DIR}${ds.file}`;
  try {
    const fresh =
      !existsSync(out) || sha256(await readFile(out)) !== ds.file_sha256;
    if (fresh) await prepare(ds, out);
    const hash = sha256(await readFile(out));
    const { size } = await stat(out);
    const rows = await countRows(out);
    if (printHashes)
      console.log(`${ds.name}: file_sha256 ${hash}, rows ${rows}`);
    else check(`${ds.name} ${ds.file}`, hash, ds.file_sha256 || undefined);
    if (!printHashes && rows !== ds.rows)
      throw new Error(`${ds.name}: ${rows} rows, expected ${ds.rows}`);
    if (size > MAX_BYTES) throw new Error(`${ds.name}: ${size} bytes > 20 MB`);
    console.log(`ok ${ds.file} (${rows} rows, ${(size / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    failed = true;
    console.error(
      `FAIL ${ds.name}: ${err instanceof Error ? err.message : err}`,
    );
  }
}
if (failed) process.exit(1);
