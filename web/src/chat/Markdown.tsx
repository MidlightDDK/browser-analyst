// Model-written Markdown rendered as React text: raw HTML shows as text,
// images are dropped, and links become plain text with the full URL visible,
// so an answer can't load or link anything (output sanitization). With the
// sanitizer turned off (red-team measurements), images and links render the
// way a naive Markdown renderer would, and only CSP stands in the way.

import { type ReactNode, useContext } from "react";
import { DefensesContext } from "../security/defenses";

// ![alt](url) | [text](url) | `code` | **bold** | __bold__ | *italic* | _italic_
const INLINE =
  /!\[([^\]]*)\]\(([^)]*)\)|\[([^\]]+)\]\(([^)\s]*)[^)]*\)|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|\b_(?!\s)(.+?)_\b/g;

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export function renderInline(
  text: string,
  key = "i",
  sanitize = true,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}.${at}`;
    const [, alt, , linkText, url, code, b1, b2, i1, i2] = m;
    if (!sanitize && alt !== undefined && isWebUrl(m[2] ?? ""))
      out.push(
        <img key={k} src={m[2]} alt={alt} className="inline max-h-40" />,
      );
    else if (!sanitize && linkText !== undefined && isWebUrl(url ?? ""))
      out.push(
        <a key={k} href={url} className="underline">
          {linkText}
        </a>,
      );
    else if (alt !== undefined)
      out.push(
        <span key={k} className="text-slate-500">
          [image removed{alt ? `: ${alt}` : ""}]
        </span>,
      );
    else if (linkText !== undefined) out.push(`${linkText} (${url})`);
    else if (code !== undefined)
      out.push(
        <code
          key={k}
          className="rounded bg-slate-100 px-1 font-mono text-[0.9em] dark:bg-slate-800"
        >
          {code}
        </code>,
      );
    else if (b1 !== undefined || b2 !== undefined)
      out.push(
        <strong key={k}>{renderInline(b1 ?? b2 ?? "", k, sanitize)}</strong>,
      );
    else out.push(<em key={k}>{renderInline(i1 ?? i2 ?? "", k, sanitize)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p" | "h" | "pre"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let prev: Block | undefined;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const kind = BULLET.test(line)
      ? "ul"
      : NUMBERED.test(line)
        ? "ol"
        : /^\s*\|/.test(line)
          ? "pre"
          : /^#{1,6}\s/.test(line)
            ? "h"
            : line.trim()
              ? "p"
              : null;
    if (kind === "ul" || kind === "ol") {
      const item = line.replace(kind === "ul" ? BULLET : NUMBERED, "");
      if (prev?.kind === kind && "items" in prev) prev.items.push(item);
      else {
        prev = { kind, items: [item] };
        out.push(prev);
      }
    } else if (kind === "p" || kind === "pre") {
      if (prev?.kind === kind && "lines" in prev) prev.lines.push(line);
      else {
        prev = { kind, lines: [line] };
        out.push(prev);
      }
    } else {
      if (kind === "h") out.push({ kind, lines: [line.replace(/^#+\s*/, "")] });
      prev = undefined;
    }
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const sanitize = useContext(DefensesContext).sanitizer;
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks(text).map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "ul":
          case "ol": {
            const List = b.kind;
            return (
              <List
                key={key}
                className={`space-y-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"}`}
              >
                {b.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
                  <li key={`${key}.${j}`}>
                    {renderInline(item, `${key}.${j}`, sanitize)}
                  </li>
                ))}
              </List>
            );
          }
          case "h":
            return (
              <p key={key} className="font-semibold">
                {renderInline(b.lines.join(" "), key, sanitize)}
              </p>
            );
          case "pre":
            return (
              <pre
                key={key}
                className="overflow-x-auto font-mono text-xs whitespace-pre"
              >
                {b.lines.join("\n")}
              </pre>
            );
          default:
            return (
              <p key={key}>{renderInline(b.lines.join(" "), key, sanitize)}</p>
            );
        }
      })}
    </div>
  );
}
