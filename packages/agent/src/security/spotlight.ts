// Spotlighting by delimiting: the catalog and every tool result reach the
// model inside a <data id="…"> block with a random per-run id, and the system
// prompt says a data block's content is never an instruction. Delimiter-like
// text inside the data is defanged so it can't close the block early.

import { byteLength, MAX_TOOL_MESSAGE_BYTES } from "../wire.ts";
import { type InjectionSignal, injectionNote } from "./detector.ts";

/** 8 random hex characters (crypto.getRandomValues exists in browsers, Node, and Workers). */
export function spotlightId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `<data` / `</data` inside the content become `<_data` / `</_data`. */
const defang = (s: string) => s.replace(/<(\/?\s*)(data\b)/gi, "<$1_$2");

export function spotlight(content: string, id: string): string {
  return `<data id="${id}">\n${defang(content)}\n</data>`;
}

/**
 * A tool message as the model sees it: optionally spotlighted, with the
 * detector's note after it, kept within the gateway's per-message cap.
 */
export function protectToolContent(
  content: string,
  opts: { spotlightId?: string; signals?: readonly InjectionSignal[] },
): string {
  const note = opts.signals?.length ? `\n${injectionNote(opts.signals)}` : "";
  const build = (inner: string) =>
    (opts.spotlightId ? spotlight(inner, opts.spotlightId) : inner) + note;
  let inner = content;
  let out = build(inner);
  while (byteLength(out) > MAX_TOOL_MESSAGE_BYTES && inner.length > 0) {
    inner = `${inner.slice(0, Math.max(0, inner.length - 200 - 30))} …[truncated]`;
    out = build(inner);
  }
  return out;
}
