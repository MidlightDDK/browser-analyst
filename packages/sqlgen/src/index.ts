// Vendored from https://github.com/MidlightDDK/pocketsql/tree/9b45c0c/packages/sqlgen
// (tokenizer test left out). The golden fixtures pin the prompt format PocketSQL was
// trained on; to update, copy that folder again.
export { introspect, type Query } from "./introspect.ts";
export { cleanSql, firstStatement } from "./postprocess.ts";
export { SYSTEM_PROMPT } from "./prompt.ts";
export {
  buildMessages,
  buildUserPrompt,
  type ChatMessage,
  type Column,
  ident,
  type Schema,
  serializeSchema,
  type Table,
} from "./schema.ts";
