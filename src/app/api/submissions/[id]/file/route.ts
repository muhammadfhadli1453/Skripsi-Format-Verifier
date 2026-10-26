import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { storageEnabled } from "@/lib/storage/db";
import { findSubmissionFile } from "@/lib/storage/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams an uploaded manuscript back to whoever holds its download token. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!storageEnabled()) return NextResponse.json({ error: "Penyimpanan berkas belum dikonfigurasi." }, { status: 503 });
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const found = await findSubmissionFile(id, token);
  if (!found) return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
  const blob = await get(found.blobPathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "Berkas sudah tidak tersedia." }, { status: 404 });
  const ascii = found.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": blob.blob.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
