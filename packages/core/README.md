# @tiza/core

Tiza core is a minimal TypeScript shared context store for multi-agent MCP systems.

It is intentionally small: append-only entries, in-memory store semantics, status tracking, and Markdown prompt rendering.

## Install

```bash
npm install @tiza/core
```

## Use

```ts
import { createStore } from "@tiza/core";

const store = createStore({
  task: "Review PR #142",
  agents: ["security", "quality", "tests"],
});

store.write({
  agent: "security",
  type: "finding",
  payload: {
    severity: "high",
    issue: "JWT secret hardcoded",
    suggestion: "Move it to an environment variable",
  },
});

console.log(store.toPrompt());
```

## Included API

- `createStore(options)`
- `store.write(entry)`
- `store.read(filter?)`
- `store.done(agent)`
- `store.status()`
- `store.toPrompt()`

## TizaRuntime

`TizaRuntime` manages multiple named runs, each backed by its own store. Pass `stateDir` to persist runs to disk across process restarts; without it, runs stay in memory.

```ts
import { TizaRuntime } from "@tiza/core";

const runtime = new TizaRuntime({ stateDir: "/tmp/tiza" });

const store = runtime.openRun("pr-142", {
  task: "Review PR #142",
  agents: ["security", "quality", "tests"],
});
```

Persistence is pluggable through the `PersistenceBackend` interface. Three implementations are exported: `FilePersistenceBackend` (disk, atomic writes), `MemoryPersistenceBackend`, and `NullPersistenceBackend` (the default). `PromptVariants` provides alternative prompt renderings for runtime-managed runs (`default`, `withMetadata`, `stage(stage)`).

Note: file persistence is not safe for concurrent writers across separate processes; runs are cached in memory after first load.

## Notes

- Stores are in-memory by default; persistence is opt-in via `TizaRuntime`.
- `@tiza/mcp` builds on top of this package for MCP transport and run-aware integration.
- The package targets Node.js 22 or newer.

