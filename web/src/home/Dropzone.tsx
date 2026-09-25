import { ACCEPTED_EXTENSIONS } from "@browser-analyst/agent";
import { type DragEvent, useId, useRef, useState } from "react";
import type { PendingFile } from "../data/useDataSession";

export function toPending(files: FileList | File[]): PendingFile[] {
  return [...files].map((f) => ({
    name: f.name,
    read: async () => new Uint8Array(await f.arrayBuffer()),
  }));
}

export function Dropzone({
  onFiles,
  compact = false,
}: {
  onFiles: (files: PendingFile[]) => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onFiles(toPending(e.dataTransfer.files));
  };

  return (
    <section
      aria-label="Load your own files"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-xl border-2 border-dashed text-center transition-colors ${
        over
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
          : "border-slate-300 dark:border-slate-700"
      } ${compact ? "px-3 py-4" : "px-6 py-10"}`}
    >
      {!compact && (
        <p className="text-lg font-medium">
          {over ? "Drop to load" : "Drop your own files here"}
        </p>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-describedby={hintId}
        className={`rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${compact ? "" : "mt-3"}`}
      >
        {compact ? "Add files" : "Choose files"}
      </button>
      <p
        id={hintId}
        className="mt-2 text-sm text-slate-600 dark:text-slate-400"
      >
        CSV, TSV, Parquet, JSON, or Excel. Files are read by DuckDB inside this
        tab and never uploaded.
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose data files"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(toPending(e.target.files));
          e.target.value = "";
        }}
      />
    </section>
  );
}
