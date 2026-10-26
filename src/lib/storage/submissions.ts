import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DocType, VerifyReport } from "../model";
import { getSql } from "./db";

export const UPLOAD_PREFIX = "uploads/";

export interface SavedSubmission {
  id: string;
  /** shown once to the uploader; only its hash is stored */
  token: string;
  downloadUrl: string;
}

export interface LeaderboardEntry {
  rank: number;
  /** undefined when the cover had no readable name */
  name?: string;
  /** masked, e.g. 0735••••077; undefined when the cover had no NPM */
  studentId?: string;
  docType: DocType;
  score: number;
  createdAt: string;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function downloadUrl(id: string, token: string): string {
  return `/api/submissions/${id}/file?token=${encodeURIComponent(token)}`;
}

/** Every checked upload goes on the leaderboard under the name/NPM read from its cover. */
export async function saveSubmission(blobPathname: string, ruleReport: VerifyReport): Promise<SavedSubmission> {
  const sql = await getSql();
  const token = randomBytes(24).toString("base64url");
  const s = ruleReport.summary;
  const rows = await sql`
    INSERT INTO submissions (token_hash, blob_pathname, file_name, source, doc_type, score, errors, warnings, infos, page_count, display_name, student_id, on_leaderboard)
    VALUES (${hashToken(token)}, ${blobPathname}, ${ruleReport.fileName}, ${ruleReport.source}, ${ruleReport.docType}, ${s.score}, ${s.errors}, ${s.warnings}, ${s.infos}, ${ruleReport.pageCount ?? null}, ${ruleReport.student?.name ?? null}, ${ruleReport.student?.studentId ?? null}, ${true})
    RETURNING id`;
  const id = rows[0].id as string;
  return { id, token, downloadUrl: downloadUrl(id, token) };
}

/** True when the pathname was already claimed by a submission (one upload, one owner). */
export async function pathnameUsed(blobPathname: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM submissions WHERE blob_pathname = ${blobPathname}`;
  return rows.length > 0;
}

export async function findSubmissionFile(id: string, token: string): Promise<{ blobPathname: string; fileName: string } | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return undefined;
  const sql = await getSql();
  const rows = await sql`SELECT token_hash, blob_pathname, file_name FROM submissions WHERE id = ${id}`;
  const row = rows[0];
  if (!row) return undefined;
  const a = Buffer.from(row.token_hash as string, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return { blobPathname: row.blob_pathname as string, fileName: row.file_name as string };
}

export function maskStudentId(id: string): string {
  if (id.length <= 7) return id.slice(0, 2) + "•".repeat(id.length - 2);
  return id.slice(0, 4) + "•".repeat(id.length - 7) + id.slice(-3);
}

/**
 * Each student's best score, top `limit`; ties go to the earlier upload.
 * Uploads without a readable NPM can't be grouped, so each counts on its own.
 */
export async function topScores(docType: DocType | undefined, limit = 5): Promise<LeaderboardEntry[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT display_name, student_id, doc_type, score, created_at FROM (
      SELECT DISTINCT ON (COALESCE(student_id, id::text)) display_name, student_id, doc_type, score, created_at
      FROM submissions
      WHERE on_leaderboard AND (${docType ?? null}::text IS NULL OR doc_type = ${docType ?? null})
      ORDER BY COALESCE(student_id, id::text), score DESC, created_at ASC
    ) best
    ORDER BY score DESC, created_at ASC
    LIMIT ${limit}`;
  return rows.map((r, i) => ({
    rank: i + 1,
    name: (r.display_name as string | null) ?? undefined,
    studentId: r.student_id ? maskStudentId(r.student_id as string) : undefined,
    docType: r.doc_type as DocType,
    score: r.score as number,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
