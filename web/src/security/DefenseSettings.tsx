// Settings for the prompt-injection defenses, and a banner while any is off.
// Turning them off shows what they stop (the "Try to hack it" sample); CSP is
// a response header, so it stays on.

import {
  DEFENSE_LABELS,
  DEFENSES,
  type Defense,
  type Defenses,
  disabledDefenses,
} from "@browser-analyst/agent";

const HELP: Record<Defense, string> = {
  spotlight: "wrap data in marked blocks the model is told never to obey",
  detector: "flag instruction-like text in data and warn the model",
  sanitizer: "never render images, links, or HTML from answers",
  sqlGuard: "accept only single read-only SQL statements",
  csp: "the browser blocks requests to other sites (always on here)",
};

export function DefensesOffBanner({ defenses }: { defenses: Defenses }) {
  const off = disabledDefenses(defenses);
  if (off.length === 0) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <span aria-hidden="true">⚠ </span>
      Defenses off: {off.map((d) => DEFENSE_LABELS[d]).join(", ")}. This session
      is deliberately easier to attack.
    </p>
  );
}

export function DefenseSettings({
  defenses,
  onChange,
  disabled,
}: {
  defenses: Defenses;
  onChange: (next: Defenses) => void;
  disabled?: boolean;
}) {
  const on = DEFENSES.filter((d) => defenses[d]).length;
  return (
    <details className="text-sm text-slate-600 dark:text-slate-400">
      <summary className="cursor-pointer">
        Prompt-injection defenses ({on} of {DEFENSES.length} on)
      </summary>
      <fieldset className="mt-2 space-y-1" disabled={disabled}>
        <legend className="sr-only">Prompt-injection defenses</legend>
        {DEFENSES.map((d) => (
          <label key={d} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={defenses[d]}
              disabled={d === "csp"}
              onChange={(e) => onChange({ ...defenses, [d]: e.target.checked })}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {DEFENSE_LABELS[d]}
              </span>
              : {HELP[d]}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
