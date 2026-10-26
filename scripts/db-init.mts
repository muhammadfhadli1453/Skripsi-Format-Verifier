// Creates the submissions table. Optional: the app also creates it on first use.
//   npm run db:init          (reads DATABASE_URL from the environment, .env.local or .env)
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "../src/lib/storage/db";

for (const f of [".env.local", ".env"]) {
  if (process.env.DATABASE_URL || !fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(DATABASE_URL|POSTGRES_URL)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL belum diatur (vercel env pull .env.local, atau isi manual).");
  process.exit(1);
}
await ensureSchema(neon(url));
console.log("Tabel submissions siap.");
