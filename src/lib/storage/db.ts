import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** Neon via the Vercel Marketplace sets DATABASE_URL (and POSTGRES_URL as an alias). */
const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL;

export function dbConfigured(): boolean {
  return !!databaseUrl();
}

/** Private store: BLOB_STORE_ID (+ OIDC on Vercel) or a read-write token. */
export function blobConfigured(): boolean {
  return !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/** Uploads are kept (and the leaderboard shown) only when both stores exist. */
export function storageEnabled(): boolean {
  return dbConfigured() && blobConfigured();
}

// created lazily so `next build` works before the database is provisioned
let _sql: NeonQueryFunction<false, false> | null = null;
let _schema: Promise<void> | null = null;

export async function getSql(): Promise<NeonQueryFunction<false, false>> {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL belum diatur");
  if (!_sql) _sql = neon(url);
  if (!_schema) _schema = ensureSchema(_sql).catch((e) => {
    _schema = null;
    throw e;
  });
  await _schema;
  return _sql;
}

/** Idempotent; also run by `npm run db:init`. The HTTP driver takes one statement per call. */
export async function ensureSchema(sql: NeonQueryFunction<false, false>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blob_pathname text NOT NULL UNIQUE,
      file_name text NOT NULL,
      source text NOT NULL,
      doc_type text NOT NULL,
      -- rule-based score only: AI findings vary by model, so they do not rank
      score integer NOT NULL,
      errors integer NOT NULL,
      warnings integer NOT NULL,
      infos integer NOT NULL,
      page_count integer,
      display_name text,
      student_id text,
      on_leaderboard boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  // private download tokens were replaced by public downloads of the top 5
  await sql`ALTER TABLE submissions DROP COLUMN IF EXISTS token_hash`;
  await sql`CREATE INDEX IF NOT EXISTS submissions_leaderboard_idx ON submissions (student_id, score DESC) WHERE on_leaderboard`;
}
