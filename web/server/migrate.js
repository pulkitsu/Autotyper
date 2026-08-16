import "dotenv/config";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PostgresStore } from "./store.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run PostgreSQL migrations.");
}

const schemaUrl = new URL("../database/schema.sql", import.meta.url);
const seedUrl = new URL("../database/seed.sql", import.meta.url);
const schemaPath = fileURLToPath(schemaUrl);
const seedPath = fileURLToPath(seedUrl);
const store = await PostgresStore.connect(process.env.DATABASE_URL);

try {
  await store.pool.query(await readFile(schemaPath, "utf8"));
  await store.pool.query(await readFile(seedPath, "utf8"));
  console.info("AutoTyper PostgreSQL schema and seed data are ready.");
} finally {
  await store.close();
}
