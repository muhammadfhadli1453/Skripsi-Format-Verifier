import type { DocType, Issue, NormalizedDoc, VerifyReport } from "./model";
import { parseDocument } from "./parse";
import { detectDocType, detectSections } from "./sections";
import { runRules } from "./rules";
import { extractStudent } from "./student";

export interface VerifyOptions {
  docType?: DocType | "auto";
  ai?: boolean;
}

export async function analyze(buffer: Buffer, fileName: string, opts: VerifyOptions = {}): Promise<{ report: VerifyReport; doc: NormalizedDoc }> {
  const started = Date.now();
  const doc = await parseDocument(buffer, fileName);
  const sections = detectSections(doc);
  const detected = detectDocType(doc, sections);
  const docType: DocType = opts.docType && opts.docType !== "auto" ? opts.docType : detected;
  const issues = runRules(doc, docType, sections);
  const report = buildReport(doc, docType, detected, sections, issues, started);
  return { report, doc };
}

export function buildReport(doc: NormalizedDoc, docType: DocType, detected: DocType, sections: ReturnType<typeof detectSections>, issues: Issue[], started: number): VerifyReport {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  const score = Math.max(0, Math.round(100 - errors * 4 - warnings * 1.5 - infos * 0.5));
  const pptaCaps = ["PPTA: ejaan baku (Tabel 4.1), sitasi (et al. miring, \"dan\", urutan sumber), angka & satuan, judul gambar/tabel, umur & jumlah referensi"];
  const capabilities = [...pptaCaps, ...(doc.source === "pdf"
    ? ["Font, ukuran, bold/italic per teks", "Posisi & ukuran logo", "Margin (estimasi dari posisi teks)", "Line spacing (diukur, paragraf ≥ 2 baris)", "Nomor halaman: posisi, format, urutan, font", "Rata tengah/justify (estimasi)", "Nomor halaman Daftar Isi vs naskah"]
    : ["Ukuran kertas & margin per section", "Font, ukuran, bold/italic per run", "Line spacing & Space Before/After", "Perataan paragraf", "Ukuran & wrap logo/gambar", "Section break, format & posisi nomor halaman", "Struktur tabel (keterangan di atas tabel, style tabel)", "Indentasi via Tab / tab stop, perataan tengah via tab", "Nomor halaman Daftar Isi vs naskah (perkiraan)"])];
  const limitations = doc.source === "pdf"
    ? ["Space Before/After tidak dapat dibaca dari PDF (hanya terlihat sebagai jarak)", "Struktur tabel tidak terdeteksi; posisi keterangan tabel tidak diperiksa", "Gambar berbasis vektor/shape mungkin tidak terdeteksi", "Line spacing paragraf satu baris tidak dapat diukur"]
    : ["Nomor halaman diperkirakan dari tata letak terakhir yang disimpan Word (lastRenderedPageBreak); bila dokumen disimpan aplikasi lain, perkiraan memakai page/section break", "Posisi vertikal elemen sampul (simetri, rata margin bawah) tidak dapat diukur", "Teks dalam text box/shape mungkin tidak terbaca"];
  return {
    fileName: doc.fileName,
    source: doc.source,
    docType,
    detectedDocType: detected,
    pageCount: doc.pages?.length,
    paragraphCount: doc.paras.filter((p) => !p.isEmpty).length,
    sections: sections.map((s) => ({ kind: s.kind, label: s.label, firstPage: s.firstPage, lastPage: s.lastPage })),
    summary: { errors, warnings, infos, score },
    student: extractStudent(doc, sections),
    issues,
    capabilities,
    limitations: [...limitations, ...doc.warnings],
    durationMs: Date.now() - started,
  };
}
