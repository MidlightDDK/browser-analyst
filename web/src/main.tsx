import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { startCspListener } from "./security/csp";

startCspListener();

const SecurityPage = lazy(() =>
  import("./security/SecurityPage").then((m) => ({ default: m.SecurityPage })),
);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const path = location.pathname.replace(/\/+$/, "");

createRoot(root).render(
  <StrictMode>
    {path === "/security" ? (
      <Suspense>
        <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <SecurityPage />
        </div>
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
