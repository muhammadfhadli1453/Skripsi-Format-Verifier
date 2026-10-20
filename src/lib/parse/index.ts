import type { NormalizedDoc } from "../model";
import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";

export async function parseDocument(buffer: Buffer, fileName: string): Promise<NormalizedDoc> {
  const lower = fileName.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isPdf) return parsePdf(buffer, fileName);
  if (lower.endsWith(".docx") || isZip) return parseDocx(buffer, fileName);
  throw new Error("Format file tidak didukung. Unggah berkas .docx atau .pdf.");
}
