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

## Notes

- The store is in-memory by design.
- `@tiza/mcp` builds on top of this package for MCP transport and run-aware integration.
- The package targets Node.js 22 or newer.

