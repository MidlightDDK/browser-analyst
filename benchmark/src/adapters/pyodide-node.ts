// Node twin of the browser's Python worker: the same harness and runner
// (packages/agent/src/python.ts) with Pyodide's Node build in a worker thread,
// so a timeout can terminate a busy interpreter exactly as in the browser.

import { Worker } from "node:worker_threads";
import {
  type PythonWorkerResponse,
  WorkerPythonRunner,
} from "@browser-analyst/agent";

export function nodePythonRunner(): WorkerPythonRunner {
  return new WorkerPythonRunner((onMessage, onError) => {
    const worker = new Worker(
      new URL("./pyodide-node.worker.ts", import.meta.url),
    );
    // An idle interpreter shouldn't keep the process alive.
    worker.unref();
    worker.on("message", (msg: PythonWorkerResponse) => onMessage(msg));
    worker.on("error", onError);
    return {
      post: (msg) => worker.postMessage(msg),
      terminate: () => void worker.terminate(),
    };
  });
}
