import { NextResponse } from "next/server";
import type { DocType } from "@/lib/model";
import { storageEnabled } from "@/lib/storage/db";
import { topScores } from "@/lib/storage/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_TYPES: DocType[] = ["proposal", "skripsi", "kp", "hasil"];

export async function GET(req: Request) {
  if (!storageEnabled()) return NextResponse.json({ enabled: false, entries: [] });
  const raw = new URL(req.url).searchParams.get("docType");
  const docType = DOC_TYPES.includes(raw as DocType) ? (raw as DocType) : undefined;
  try {
    return NextResponse.json({ enabled: true, entries: await topScores(docType) });
  } catch (err) {
    return NextResponse.json({ enabled: true, entries: [], error: err instanceof Error ? err.message : "Gagal memuat papan peringkat." }, { status: 500 });
  }
}
