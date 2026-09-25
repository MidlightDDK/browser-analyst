// Runs model-written Python in Pyodide, loaded from jsDelivr on the first
// run_python. The page terminates this worker when a run times out
// (WorkerPythonRunner in packages/agent/src/python.ts).

import {
  handlePythonMessage,
  PYODIDE_CDN,
  type PyodideLike,
  type PythonWorkerRequest,
  preparePyodide,
} from "@browser-analyst/agent/python";
import { forwardCspViolations } from "./csp-forward";

forwardCspViolations("python");

type LoadPyodide = (options: {
  indexURL: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}) => Promise<PyodideLike>;

let ready: Promise<PyodideLike> | null = null;

const load = (): Promise<PyodideLike> => {
  ready ??= (async () => {
    const { loadPyodide } = (await import(
      /* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`
    )) as { loadPyodide: LoadPyodide };
    const py = await loadPyodide({
      indexURL: PYODIDE_CDN,
      stdout: () => {},
      stderr: () => {},
    });
    await preparePyodide(py);
    return py;
  })();
  return ready;
};

self.onmessage = async (e: MessageEvent<PythonWorkerRequest>) => {
  self.postMessage(await handlePythonMessage(e.data, load));
};
