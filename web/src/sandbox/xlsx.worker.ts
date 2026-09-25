// Converts a spreadsheet to one CSV per sheet off the main thread (SheetJS CE).

import { xlsxToCsv } from "@browser-analyst/agent";

self.onmessage = async (e: MessageEvent<Uint8Array>) => {
  try {
    const sheets = await xlsxToCsv(e.data);
    self.postMessage(
      { sheets },
      { transfer: sheets.map((s) => s.csv.buffer as ArrayBuffer) },
    );
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
