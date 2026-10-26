import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import type { DocType, VerifyReport } from "@/lib/model";
import { analyze } from "@/lib/verify";
import { detectSections } from "@/lib/sections";
import { aiAvailable, aiConfig, missingKeyMessage } from "@/lib/ai/provider";
import { runAiChecks } from "@/lib/ai/checks";
import { storageEnabled } from "@/lib/storage/db";
import { UPLOAD_PREFIX, pathnameUsed, saveSubmission } from "@/lib/storage/submissions";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;
const DOC_TYPES: (DocType | "auto")[] = ["auto", "proposal", "skripsi", "kp", "hasil"];

class BadRequest extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface Input {
  buffer: Buffer;
  name: string;
  docType: DocType | "auto";
  wantAi: boolean;
  /** set when the file came through Blob and should be kept */
  blobPathname?: string;
}

const pickDocType = (raw: unknown) => (DOC_TYPES.includes(String(raw ?? "auto") as DocType | "auto") ? String(raw ?? "auto") : "auto") as DocType | "auto";
const checkName = (name: string) => {
  if (!/\.(docx|pdf)$/i.test(name)) throw new BadRequest("Format tidak didukung. Gunakan .docx atau .pdf.");
};

/** Without storage: the file comes in the request body (local dev; capped at 4.5 MB on Vercel). */
async function readMultipart(req: Request): Promise<Input> {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequest("Berkas tidak ditemukan. Unggah .docx atau .pdf.");
  if (file.size > MAX_BYTES) throw new BadRequest("Berkas terlalu besar (maks. 40 MB).", 413);
  const name = file.name || "dokumen";
  checkName(name);
  return { buffer: Buffer.from(await file.arrayBuffer()), name, docType: pickDocType(form.get("docType")), wantAi: String(form.get("ai") ?? "0") === "1" };
}

/** With storage: the browser already uploaded to private Blob and sends the pathname. */
async function readFromBlob(req: Request, claim: (pathname: string) => void): Promise<Input> {
  if (!storageEnabled()) throw new BadRequest("Penyimpanan berkas belum dikonfigurasi.", 503);
  const body = (await req.json()) as { blobPathname?: string; fileName?: string; docType?: string; ai?: boolean };
  const blobPathname = String(body.blobPathname ?? "");
  if (!blobPathname.startsWith(UPLOAD_PREFIX)) throw new BadRequest("Berkas tidak valid.");
  // a pathname belongs to the first request that claims it, so nobody can obtain a download token for someone else's upload
  if (await pathnameUsed(blobPathname)) throw new BadRequest("Berkas ini sudah diperiksa. Unggah ulang untuk memeriksa lagi.", 409);
  claim(blobPathname);
  const name = String(body.fileName || blobPathname.slice(UPLOAD_PREFIX.length)) || "dokumen";
  checkName(name);
  const blob = await get(blobPathname, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) throw new BadRequest("Berkas tidak ditemukan di penyimpanan.", 404);
  if (blob.blob.size > MAX_BYTES) throw new BadRequest("Berkas terlalu besar (maks. 40 MB).", 413);
  const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
  return { buffer, name, docType: pickDocType(body.docType), wantAi: body.ai === true, blobPathname };
}

export async function POST(req: Request) {
  let blobPathname: string | undefined;
  let saved = false;
  try {
    const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
    const input = isJson ? await readFromBlob(req, (p) => (blobPathname = p)) : await readMultipart(req);
    const { report, doc } = await analyze(input.buffer, input.name, { docType: input.docType });

    let finalReport: VerifyReport = report;
    if (input.wantAi) {
      if (!aiAvailable()) {
        finalReport = { ...report, ai: { used: false, error: missingKeyMessage() } };
      } else {
        const sections = detectSections(doc);
        const ai = await runAiChecks(doc, sections, report.issues, report);
        const issues = [...report.issues, ...ai.issues];
        const errors = issues.filter((i) => i.severity === "error").length;
        const warnings = issues.filter((i) => i.severity === "warning").length;
        const infos = issues.filter((i) => i.severity === "info").length;
        finalReport = {
          ...report,
          issues,
          // AI findings are listed and counted but never change the score: they vary by model and run,
          // and the leaderboard must show the same number as the report
          summary: { errors, warnings, infos, score: report.summary.score },
          aiSummary: ai.summary,
          ai: { used: true, model: ai.model ?? aiConfig()?.label, error: ai.error, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens },
        };
      }
    }

    if (input.blobPathname) {
      const rankedScore = report.summary.score;
      try {
        const sub = await saveSubmission(input.blobPathname, report);
        saved = true;
        finalReport = { ...finalReport, submission: { id: sub.id, downloadUrl: sub.downloadUrl, rankedScore } };
      } catch (e) {
        finalReport = { ...finalReport, submission: { rankedScore, error: `Berkas tidak tersimpan: ${(e as Error).message}` } };
      }
    }
    return NextResponse.json(finalReport);
  } catch (err) {
    const status = err instanceof BadRequest ? err.status : 500;
    const message = err instanceof Error ? err.message : "Terjadi kesalahan saat memproses berkas.";
    return NextResponse.json({ error: message }, { status });
  } finally {
    // don't keep files nobody can download; re-check in case a concurrent request claimed it first
    if (blobPathname && !saved) {
      const owned = await pathnameUsed(blobPathname).catch(() => true);
      if (!owned) await del(blobPathname).catch(() => {});
    }
  }
}
