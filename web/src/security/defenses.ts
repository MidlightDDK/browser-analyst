// The page's defense flags. All on unless the URL says `?disable=…` (the
// red-team harness) or the visitor turns some off in Settings; CSP is a
// response header, so the page can only report it as off.

import { ALL_ON, type Defenses, defensesFrom } from "@browser-analyst/agent";
import { createContext } from "react";

export function initialDefenses(): Defenses {
  return defensesFrom(new URLSearchParams(location.search).get("disable"));
}

export const DefensesContext = createContext<Defenses>(ALL_ON);
