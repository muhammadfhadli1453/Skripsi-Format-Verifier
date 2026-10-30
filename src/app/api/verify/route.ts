import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import type { DocType, VerifyReport } from "@/lib/model";
import { analyze } from "@/lib/verify";
import { detectSections } from "@/lib/sections";
import { aiAvailable, aiConfig, missingKeyMessage } from "@/lib/ai/provider";
import { runAiChecks } from "@/lib/ai/checks";
import { storageEnabled } from "@/lib/storage/db";
import { UPLOAD_PREFIX, pathnameUsed, pruneToTop, saveSubmission } from "@/lib/storage/submissions";

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
  // a pathname belongs to the first request that claims it, so one upload can't be entered twice
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

/** Overall percentage (the browser upload is 0–30) and a label for the progress bar. */
type Progress = (pct: number, label: string) => void;

async function run(req: Request, progress: Progress): Promise<VerifyReport> {
  let blobPathname: string | undefined;
  let saved = false;
  try {
    progress(32, "Membaca berkas…");
    const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
    const input = isJson ? await readFromBlob(req, (p) => (blobPathname = p)) : await readMultipart(req);
    progress(38, "Memeriksa format…");
    const { report, doc } = await analyze(input.buffer, input.name, { docType: input.docType });

    let finalReport: VerifyReport = report;
    if (input.wantAi) {
      if (!aiAvailable()) {
        finalReport = { ...report, ai: { used: false, error: missingKeyMessage() } };
      } else {
        progress(50, "Pemeriksaan AI…");
        const sections = detectSections(doc);
        const ai = await runAiChecks(doc, sections, report.issues, report, (f, label) => progress(Math.round(50 + f * 45), label));
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
      progress(97, "Menyimpan ke papan peringkat…");
      const rankedScore = report.summary.score;
      try {
        const sub = await saveSubmission(input.blobPathname, report);
        saved = true;
        // only the top 5s are kept; everything else, this upload included if it didn't place, is deleted
        const dropped = await pruneToTop().catch((e) => {
          console.error("pruneToTop failed", e);
          return [] as string[];
        });
        if (dropped.length) await del(dropped).catch((e) => console.error("deleting pruned blobs failed", e));
        const kept = !dropped.includes(input.blobPathname);
        finalReport = { ...finalReport, submission: { id: kept ? sub.id : undefined, kept, rankedScore } };
      } catch (e) {
        finalReport = { ...finalReport, submission: { rankedScore, error: `Berkas tidak tersimpan: ${(e as Error).message}` } };
      }
    }
    return finalReport;
  } finally {
    // don't keep files with no submission row; re-check in case a concurrent request claimed it first
    if (blobPathname && !saved) {
      const owned = await pathnameUsed(blobPathname).catch(() => true);
      if (!owned) await del(blobPathname).catch(() => {});
    }
  }
}

const errorOf = (err: unknown) => ({
  status: err instanceof BadRequest ? err.status : 500,
  message: err instanceof Error ? err.message : "Terjadi kesalahan saat memproses berkas.",
});

/**
 * Plain JSON by default. With ?stream=1 the response is NDJSON: {type:"progress",pct,label} lines,
 * then one {type:"result",report} or {type:"error",message,status}.
 */
export async function POST(req: Request) {
  if (new URL(req.url).searchParams.get("stream") !== "1") {
    try {
      return NextResponse.json(await run(req, () => {}));
    } catch (err) {
      const { status, message } = errorOf(err);
      return NextResponse.json({ error: message }, { status });
    }
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        send({ type: "result", report: await run(req, (pct, label) => send({ type: "progress", pct, label })) });
      } catch (err) {
        send({ type: "error", ...errorOf(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
