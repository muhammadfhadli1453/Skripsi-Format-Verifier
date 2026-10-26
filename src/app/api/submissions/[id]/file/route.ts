import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { storageEnabled } from "@/lib/storage/db";
import { findTopFile } from "@/lib/storage/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams a manuscript that is currently in a top 5, as a reference for other students. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!storageEnabled()) return NextResponse.json({ error: "Penyimpanan berkas belum dikonfigurasi." }, { status: 503 });
  const { id } = await ctx.params;
  const found = await findTopFile(id);
  if (!found) return NextResponse.json({ error: "Berkas tidak ditemukan atau tidak lagi termasuk 5 besar." }, { status: 404 });
  const blob = await get(found.blobPathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "Berkas sudah tidak tersedia." }, { status: 404 });
  const ascii = found.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": blob.blob.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
      // the top 5 changes with every upload
      "Cache-Control": "no-store",
    },
  });
}
