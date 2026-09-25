// The harness imports the Worker's provider adapters, whose Env type names two
// Workers bindings; the benchmark never uses them, so opaque stand-ins suffice.
type Fetcher = unknown;
type RateLimit = unknown;
