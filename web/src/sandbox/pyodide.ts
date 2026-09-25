// Python for the browser sandbox: a dedicated Web Worker started on the first
// run_python, terminated on timeout, and started again on the next call.

import {
  type PythonWorkerResponse,
  WorkerPythonRunner,
} from "@browser-analyst/agent";

export function browserPythonRunner(): WorkerPythonRunner {
  return new WorkerPythonRunner((onMessage, onError) => {
    const worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), {
      type: "module",
      name: "python",
    });
    worker.onmessage = (e: MessageEvent<PythonWorkerResponse>) =>
      onMessage(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      onError(new Error(e.message || "The Python worker stopped."));
    };
    return {
      post: (msg) => worker.postMessage(msg),
      terminate: () => worker.terminate(),
    };
  });
}
