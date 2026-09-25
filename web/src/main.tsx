import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { startCspListener } from "./security/csp";

startCspListener();

const SecurityPage = lazy(() =>
  import("./security/SecurityPage").then((m) => ({ default: m.SecurityPage })),
);

const BenchmarkPage = lazy(() =>
  import("./benchmark/BenchmarkPage").then((m) => ({
    default: m.BenchmarkPage,
  })),
);
const PAGES: Record<string, typeof SecurityPage> = {
  "/security": SecurityPage,
  "/benchmark": BenchmarkPage,
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const Page = PAGES[location.pathname.replace(/\/+$/, "")];

createRoot(root).render(
  <StrictMode>
    {Page ? (
      <Suspense>
        <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <Page />
        </div>
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
