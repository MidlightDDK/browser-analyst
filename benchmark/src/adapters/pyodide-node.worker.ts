// Worker thread for nodePythonRunner: Pyodide's Node build (npm `pyodide`,
// packages fetched from its CDN on first use and cached).

import { parentPort } from "node:worker_threads";
import {
  handlePythonMessage,
  type PyodideLike,
  type PythonWorkerRequest,
  preparePyodide,
} from "@browser-analyst/agent/python";
import { loadPyodide } from "pyodide";

let ready: Promise<PyodideLike> | null = null;

const load = (): Promise<PyodideLike> => {
  ready ??= loadPyodide({ stdout: () => {}, stderr: () => {} }).then(
    async (api) => {
      // Its typings declare globals as a bare PyProxy; at runtime it has get().
      const py = api as unknown as PyodideLike;
      await preparePyodide(py);
      return py;
    },
  );
  return ready;
};

parentPort?.on("message", async (msg: PythonWorkerRequest) =>
  parentPort?.postMessage(await handlePythonMessage(msg, load)),
);
