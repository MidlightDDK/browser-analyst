// Defense flags. Everything is on in production; the red-team suite turns
// defenses off one at a time (and all at once) to measure what each one adds.
// CSP is a response header, so only the red-team harness can remove it.

export const DEFENSES = [
  "spotlight",
  "detector",
  "sanitizer",
  "sqlGuard",
  "csp",
] as const;

export type Defense = (typeof DEFENSES)[number];
export type Defenses = Record<Defense, boolean>;

export const DEFENSE_LABELS: Record<Defense, string> = {
  spotlight: "Spotlighting",
  detector: "Injection detector",
  sanitizer: "Output sanitizer",
  sqlGuard: "SQL guard",
  csp: "Content Security Policy",
};

export const ALL_ON: Defenses = {
  spotlight: true,
  detector: true,
  sanitizer: true,
  sqlGuard: true,
  csp: true,
};

/** Parses a disable list such as `spotlight,detector` or `all`; unknown names are ignored. */
export function defensesFrom(disable: string | null | undefined): Defenses {
  const off = new Set(
    (disable ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const all = off.has("all");
  return Object.fromEntries(
    DEFENSES.map((d) => [d, !(all || off.has(d))]),
  ) as Defenses;
}

export const disabledDefenses = (d: Defenses): Defense[] =>
  DEFENSES.filter((k) => !d[k]);
