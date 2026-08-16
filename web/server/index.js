import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { createStore } from "./store.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const store = await createStore();
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(serverDirectory, "../dist");
const app = createApp({ store, staticDir: existsSync(staticDir) ? staticDir : null });
const server = app.listen(port, host, () => {
  const storage = store.kind === "memory" ? "in-memory development fallback" : "PostgreSQL";
  console.info(`AutoTyper API listening on http://${host}:${port} (${storage})`);
});

async function shutdown(signal) {
  console.info(`${signal} received; shutting down AutoTyper API.`);
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
