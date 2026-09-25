// The gateway rejects clients whose versions differ (409), so bump these on any
// change to a tool schema (src/tools/) or to the system prompt
// (src/prompts/system.ts).
export const TOOLSET_VERSION = "tools-v0";
export const PROMPT_VERSION = "prompt-v0";
