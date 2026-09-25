// `pnpm bench:expected`: computes each task's expected value from its
// reference SQL in the Node sandbox (the engine and table loading the agent
// gets) and writes it back into tasks.jsonl. Prints one line per task so the
// values can be reviewed next to the SQL.

import { NodeDuckDBSandbox } from "./adapters/duckdb-node.ts";
import { loadDatasets, registerDatasets } from "./datasets.ts";
import { loadTasks, saveTasks, type TableValue } from "./tasks.ts";

const datasets = await loadDatasets();
const sandbox = await NodeDuckDBSandbox.create();
await registerDatasets(
  sandbox,
  datasets,
  datasets.map((d) => d.name),
);
const tasks = await loadTasks();
let failed = false;
try {
  for (const task of tasks) {
    const { expected } = task;
    if (!expected.reference_sql) continue;
    const r = await sandbox.sql(expected.reference_sql, { maxRows: 10_000 });
    if ("error" in r) {
      failed = true;
      console.error(`FAIL ${task.id}: ${r.error}`);
      continue;
    }
    const rows = sandbox.getResult(r.result_id)?.rows ?? [];
    if (r.truncated || rows.length === 0) {
      failed = true;
      console.error(
        `FAIL ${task.id}: ${rows.length} rows (truncated: ${r.truncated})`,
      );
      continue;
    }
    if (expected.kind === "number") {
      const v = rows[0]?.[0];
      if (
        rows.length !== 1 ||
        r.columns.length !== 1 ||
        typeof v !== "number"
      ) {
        failed = true;
        console.error(`FAIL ${task.id}: a number task needs one numeric cell`);
        continue;
      }
      expected.value = v;
      console.log(`${task.id}\t${v}`);
    } else {
      const value: TableValue = { columns: r.columns.map((c) => c.name), rows };
      for (const c of expected.columns ?? [])
        if (!value.columns.includes(c)) {
          failed = true;
          console.error(`FAIL ${task.id}: no column ${c}`);
        }
      expected.value = value;
      const shown = rows.slice(0, 3).map((row) => JSON.stringify(row));
      console.log(`${task.id}\t${rows.length} rows\t${shown.join(" ")}`);
    }
  }
} finally {
  await sandbox.close();
}
if (failed) process.exit(1);
await saveTasks(tasks);
