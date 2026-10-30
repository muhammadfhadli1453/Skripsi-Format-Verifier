import { NextResponse } from "next/server";
import { BlobStoreSuspendedError, issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { storageEnabled } from "@/lib/storage/db";
import { UPLOAD_PREFIX } from "@/lib/storage/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 40 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

/** Issues a short-lived presigned PUT so the browser uploads straight to private Blob (no 4.5 MB function body limit). */
export async function POST(req: Request) {
  if (!storageEnabled()) return NextResponse.json({ error: "Penyimpanan berkas belum dikonfigurasi." }, { status: 503 });
  try {
    const body = (await req.json()) as HandleUploadPresignedBody;
    const result = await handleUploadPresigned({
      body,
      request: req,
      // no onUploadCompleted callback is used (/api/verify records the upload),
      // but the helper insists on a key; a placeholder makes stray callbacks fail verification
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || "unused",
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PREFIX) || !/\.(docx|pdf)$/i.test(pathname) || pathname.includes("..")) throw new Error("Nama berkas tidak valid.");
        const validUntil = Date.now() + 10 * 60 * 1000;
        const token = await issueSignedToken({ pathname, operations: ["put"], validUntil, allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES });
        return { token, urlOptions: { validUntil, allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true } };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("presigned upload failed", err);
    const message =
      err instanceof BlobStoreSuspendedError
        ? "Penyimpanan berkas (Vercel Blob) sedang ditangguhkan, biasanya karena kuota habis. Hubungi pengelola aplikasi."
        : err instanceof Error
          ? err.message
          : "Gagal menyiapkan unggahan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
