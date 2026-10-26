import type { DocType, VerifyReport } from "../model";
import { getSql } from "./db";

export const UPLOAD_PREFIX = "uploads/";

export interface LeaderboardEntry {
  /** submission id; its file is downloadable while it stays in a top 5 */
  id: string;
  rank: number;
  /** undefined when the cover had no readable name */
  name?: string;
  /** undefined when the cover had no NPM */
  studentId?: string;
  docType: DocType;
  fileName: string;
  score: number;
  createdAt: string;
}

/** Every checked upload goes on the leaderboard under the name/NPM read from its cover. */
export async function saveSubmission(blobPathname: string, ruleReport: VerifyReport): Promise<{ id: string }> {
  const sql = await getSql();
  const s = ruleReport.summary;
  const rows = await sql`
    INSERT INTO submissions (blob_pathname, file_name, source, doc_type, score, errors, warnings, infos, page_count, display_name, student_id, on_leaderboard)
    VALUES (${blobPathname}, ${ruleReport.fileName}, ${ruleReport.source}, ${ruleReport.docType}, ${s.score}, ${s.errors}, ${s.warnings}, ${s.infos}, ${ruleReport.pageCount ?? null}, ${ruleReport.student?.name ?? null}, ${ruleReport.student?.studentId ?? null}, ${true})
    RETURNING id`;
  return { id: rows[0].id as string };
}

/** True when the pathname was already claimed by a submission (one upload, one entry). */
export async function pathnameUsed(blobPathname: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM submissions WHERE blob_pathname = ${blobPathname}`;
  return rows.length > 0;
}

/**
 * Anyone may download a file while it is in the overall top 5 or the top 5 of
 * its document type (the leaderboard tabs); everything else stays private.
 */
export async function findTopFile(id: string): Promise<{ blobPathname: string; fileName: string } | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const sql = await getSql();
  const rows = await sql`SELECT blob_pathname, file_name, doc_type FROM submissions WHERE id = ${id}::uuid AND on_leaderboard`;
  const row = rows[0];
  if (!row) return undefined;
  const [overall, ofType] = await Promise.all([topScores(undefined), topScores(row.doc_type as DocType)]);
  if (![...overall, ...ofType].some((e) => e.id === id)) return undefined;
  return { blobPathname: row.blob_pathname as string, fileName: row.file_name as string };
}

/**
 * Each student's best score, top `limit`; ties go to the earlier upload.
 * Uploads without a readable NPM can't be grouped, so each counts on its own.
 */
export async function topScores(docType: DocType | undefined, limit = 5): Promise<LeaderboardEntry[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, display_name, student_id, doc_type, file_name, score, created_at FROM (
      SELECT DISTINCT ON (COALESCE(student_id, id::text)) id, display_name, student_id, doc_type, file_name, score, created_at
      FROM submissions
      WHERE on_leaderboard AND (${docType ?? null}::text IS NULL OR doc_type = ${docType ?? null})
      ORDER BY COALESCE(student_id, id::text), score DESC, created_at ASC
    ) best
    ORDER BY score DESC, created_at ASC
    LIMIT ${limit}`;
  return rows.map((r, i) => ({
    id: r.id as string,
    rank: i + 1,
    name: (r.display_name as string | null) ?? undefined,
    studentId: (r.student_id as string | null) ?? undefined,
    docType: r.doc_type as DocType,
    fileName: r.file_name as string,
    score: r.score as number,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}
