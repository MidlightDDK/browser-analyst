import {
  messagesBytes,
  PROMPT_VERSION,
  type StepRequestBody,
  SYSTEM_PROMPT,
  TOOL_PAYLOAD,
  TOOLSET_VERSION,
} from "@browser-analyst/agent";
import { useEffect, useRef } from "react";
import { formatCount } from "../format";

/** "What the model saw": the exact body of the last step, plus what the gateway adds. */
export function PayloadDrawer({
  payload,
  open,
  onClose,
}: {
  payload: StepRequestBody | null;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="payload-heading"
      className="ml-auto mr-0 h-full max-h-none w-full max-w-2xl bg-white p-0 text-slate-900 backdrop:bg-slate-900/40 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 id="payload-heading" className="text-lg font-semibold">
            What the model saw
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-700"
          >
            Close
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
          {payload ? (
            <section className="space-y-2">
              <h3 className="font-semibold">
                Sent from your browser in the last step (
                {formatCount(messagesBytes(payload.messages))} bytes,{" "}
                {payload.messages.length} messages)
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Only these messages leave your browser: the catalog, previews of
                at most 20 rows, and the conversation. Full results stay here.
              </p>
              <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-slate-900">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </section>
          ) : (
            <p>Nothing has been sent yet. Ask a question first.</p>
          )}
          <section className="space-y-2">
            <h3 className="font-semibold">
              Added by the gateway: system prompt ({PROMPT_VERSION})
            </h3>
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-slate-900">
              {SYSTEM_PROMPT}
            </pre>
          </section>
          <section className="space-y-2">
            <h3 className="font-semibold">
              Added by the gateway: tool schemas ({TOOLSET_VERSION})
            </h3>
            <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-slate-900">
              {JSON.stringify(TOOL_PAYLOAD, null, 2)}
            </pre>
          </section>
        </div>
      </div>
    </dialog>
  );
}
