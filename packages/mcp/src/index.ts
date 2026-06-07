// Programmatic entry point — use this to embed the Tiza MCP server
// in your own process without spawning a child process.

export {
  type RunInitOptions,
  type RunSnapshot,
  TizaRuntime,
  type TizaRuntimeOptions,
} from "@tiza/core";
export { type CreateTizaServerOptions, createTizaServer } from "./create-server";
