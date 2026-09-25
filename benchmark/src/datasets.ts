// The dataset manifest (benchmark/datasets.json) and loading its files into a
// sandbox the way the web app does: register, profile, compact catalog.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compactCatalog, type Sandbox } from "@browser-analyst/agent";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BENCH_DIR = `${ROOT}benchmark/`;
export const DATA_DIR = `${BENCH_DIR}data/`;

export interface Dataset {
  /** Referenced by tasks. */
  name: string;
  /** The benchmark copy in benchmark/data/ (its name sets the table name). */
  file: string;
  title: string;
  /** Pinned download; absent for generated files. */
  url?: string;
  /** Of the download. */
  sha256?: string;
  license: string;
  license_url: string;
  /** Human-readable source page. */
  source: string;
  /** Of the benchmark copy, after `prepare`. */
  file_sha256: string;
  rows: number;
  note: string;
  prepare?: {
    /** Zip entry to extract, and its sha256. */
    extract?: string;
    extract_sha256?: string;
    /** Convert a spreadsheet to CSV with the app's own SheetJS path first. */
    xlsx?: boolean;
    /** DuckDB statement writing {out} from {src}. Without it the file is copied. */
    sql?: string;
  };
  generator?: "messy-orders";
}

export async function loadDatasets(): Promise<Dataset[]> {
  return JSON.parse(
    await readFile(`${BENCH_DIR}datasets.json`, "utf8"),
  ) as Dataset[];
}

/** Registers the named datasets and returns the catalog the agent would get. */
export async function registerDatasets(
  sandbox: Sandbox,
  all: readonly Dataset[],
  names: readonly string[],
): Promise<string> {
  const tables = [];
  for (const name of names) {
    const ds = all.find((d) => d.name === name);
    if (!ds) throw new Error(`unknown dataset ${name}`);
    const bytes = new Uint8Array(await readFile(`${DATA_DIR}${ds.file}`));
    for (const t of await sandbox.registerFile(ds.file, bytes))
      tables.push({
        profile: await sandbox.describe(t.table),
        source: t.source,
      });
  }
  return compactCatalog(tables);
}
