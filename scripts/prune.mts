// Deletes everything outside the leaderboard top 5s: the other rows, their files, and stray
// uploads that never got a row (the check was abandoned or its cleanup failed).
//   npm run db:prune            (reads DATABASE_URL and Blob credentials from the environment, .env.local or .env)
//   npm run db:prune -- --dry   (only reports what would be deleted)
// The app prunes after every check; this is for data stored before that, and for stray files.
import fs from "node:fs";
import { del, list } from "@vercel/blob";
import { getSql } from "../src/lib/storage/db";
import { UPLOAD_PREFIX, pruneToTop, topScores } from "../src/lib/storage/submissions";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const dry = process.argv.includes("--dry");
// leaves uploads that may still be on their way to /api/verify
const STRAY_AGE_MS = 60 * 60 * 1000;

// fail before deleting rows: without Blob access their files would be left behind
try {
  await list({ prefix: UPLOAD_PREFIX, limit: 1 });
} catch (e) {
  console.error(`Tidak bisa mengakses Vercel Blob: ${(e as Error).message}`);
  console.error("Ambil kredensial baru (vercel env pull .env.local; VERCEL_OIDC_TOKEN berlaku ±12 jam) atau isi BLOB_READ_WRITE_TOKEN.");
  process.exit(1);
}

const sql = await getSql();
let pruned: string[];
if (dry) {
  const tops = await Promise.all([undefined, "proposal", "skripsi", "kp", "hasil"].map((t) => topScores(t as never)));
  const keep = [...new Set(tops.flat().map((e) => e.id))];
  const rows = await sql`SELECT blob_pathname FROM submissions WHERE NOT (id = ANY(${keep}::uuid[]))`;
  pruned = rows.map((r) => r.blob_pathname as string);
} else {
  pruned = await pruneToTop();
}
const kept = new Set((await sql`SELECT blob_pathname FROM submissions`).map((r) => r.blob_pathname as string));
console.log(`${dry ? "Akan dihapus" : "Dihapus"}: ${pruned.length} baris; tersisa ${kept.size - (dry ? pruned.length : 0)}.`);

// every file under uploads/ that no remaining row points to
const doomed: string[] = [];
let bytes = 0;
let cursor: string | undefined;
do {
  const page = await list({ prefix: UPLOAD_PREFIX, cursor, limit: 1000 });
  for (const b of page.blobs) {
    const stray = !kept.has(b.pathname) && Date.now() - b.uploadedAt.getTime() > STRAY_AGE_MS;
    if (pruned.includes(b.pathname) || stray) {
      doomed.push(b.pathname);
      bytes += b.size;
    }
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

console.log(`${dry ? "Akan dihapus" : "Dihapus"}: ${doomed.length} berkas (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
if (!dry) for (let i = 0; i < doomed.length; i += 100) await del(doomed.slice(i, i + 100));
