import { NextResponse } from "next/server";
import type { DocType, VerifyReport } from "@/lib/model";
import { analyze } from "@/lib/verify";
import { detectSections } from "@/lib/sections";
import { AI_MODEL, aiAvailable, runAiChecks } from "@/lib/ai/haiku";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;
const DOC_TYPES: (DocType | "auto")[] = ["auto", "proposal", "skripsi", "kp", "hasil"];

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Berkas tidak ditemukan. Unggah .docx atau .pdf." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Berkas terlalu besar (maks. 40 MB)." }, { status: 413 });
    const name = file.name || "dokumen";
    if (!/\.(docx|pdf)$/i.test(name)) return NextResponse.json({ error: "Format tidak didukung. Gunakan .docx atau .pdf." }, { status: 400 });
    const docTypeRaw = String(form.get("docType") ?? "auto");
    const docType = (DOC_TYPES.includes(docTypeRaw as DocType | "auto") ? docTypeRaw : "auto") as DocType | "auto";
    const wantAi = String(form.get("ai") ?? "0") === "1";

    const buffer = Buffer.from(await file.arrayBuffer());
    const { report, doc } = await analyze(buffer, name, { docType });

    let finalReport: VerifyReport = report;
    if (wantAi) {
      if (!aiAvailable()) {
        finalReport = { ...report, ai: { used: false, error: "CLAUDE_API_KEY belum diatur di .env" } };
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
          summary: { errors, warnings, infos, score: Math.max(0, Math.round(100 - errors * 4 - warnings * 1.5 - infos * 0.5)) },
          aiSummary: ai.summary,
          ai: { used: true, model: AI_MODEL, error: ai.error, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens },
        };
      }
    }
    return NextResponse.json(finalReport);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan saat memproses berkas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
