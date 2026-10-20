/**
 * Generates testing-data/fixture-proposal.docx: a small proposal that follows the
 * template in most places but contains deliberate formatting mistakes, so the DOCX
 * pipeline can be exercised end to end.
 */
import fs from "node:fs";
import {
  AlignmentType, Document, Footer, Header, ImageRun, Packer, PageBreak, PageNumber, Paragraph, SectionType, Table, TableCell, TableRow, TextRun, WidthType, NumberFormat, BorderStyle, convertMillimetersToTwip,
} from "docx";

const AN = "Arial Narrow";
const cm = (v: number) => convertMillimetersToTwip(v * 10);
const normal = { top: cm(2.54), bottom: cm(2.54), left: cm(2.54), right: cm(2.54) };
const body = { top: cm(4), bottom: cm(3), left: cm(4), right: cm(3) };
const P = (text: string | TextRun[], o: Partial<{ align: (typeof AlignmentType)[keyof typeof AlignmentType]; size: number; bold: boolean; line: number; after: number; before: number; indent: number; hanging: number; italic: boolean; font: string }> = {}) =>
  new Paragraph({
    alignment: o.align ?? AlignmentType.JUSTIFIED,
    spacing: { line: o.line ?? 480, after: o.after ?? 0, before: o.before ?? 0 },
    indent: o.indent !== undefined ? { firstLine: o.indent } : o.hanging !== undefined ? { left: o.hanging, hanging: o.hanging } : undefined,
    children: typeof text === "string" ? [new TextRun({ text, font: o.font ?? AN, size: (o.size ?? 12) * 2, bold: o.bold, italics: o.italic })] : text,
  });
const R = (text: string, o: Partial<{ size: number; bold: boolean; italic: boolean; font: string }> = {}) => new TextRun({ text, font: o.font ?? AN, size: (o.size ?? 12) * 2, bold: o.bold, italics: o.italic });
const empty = (n: number, line = 240) => Array.from({ length: n }, () => P("", { line, align: AlignmentType.CENTER }));

// 1x1 px PNG as logo placeholder (size set to the wrong 4.5 x 4.5 cm on purpose)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const pageFooterCenter = (fmt?: boolean) => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: fmt ? "Calibri" : AN, size: 24 })] })] });
const pageHeaderRight = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT], font: AN, size: 24 })] })] });

const lorem = "Pertumbuhan penduduk yang cepat dalam suatu wilayah permukiman mempengaruhi perkembangan fisik dan penggunaan lahan di wilayah tersebut. Kepadatan penduduk yang meningkat dapat mendorong perubahan dalam tata ruang kota, seperti pembangunan perumahan baru, infrastruktur umum, dan fasilitas publik untuk memenuhi kebutuhan penduduk yang bertambah";

const doc = new Document({
  styles: { default: { document: { run: { font: AN, size: 24 } } } },
  sections: [
    // ---- cover (margins Normal) ----
    {
      properties: { page: { margin: normal, size: { width: cm(21), height: cm(29.7) } } },
      children: [
        P("PROPOSAL", { align: AlignmentType.CENTER, size: 16, bold: true, line: 480 }),
        P("SISTEM INFORMASI MANAJEMEN ARSIP DIGITAL BERBASIS WEB PADA", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("DINAS PENDIDIKAN KOTA TERNATE", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("(STUDI KASUS: DINAS PENDIDIKAN)", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        ...empty(4),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 240 }, children: [new ImageRun({ type: "png", data: png, transformation: { width: 170, height: 170 } })] }),
        ...empty(4),
        P("Oleh", { align: AlignmentType.CENTER, size: 14, bold: true, line: 240 }),
        P("ANDI SAPUTRA", { align: AlignmentType.CENTER, size: 14, bold: true, line: 240 }),
        P("07352111001", { align: AlignmentType.CENTER, size: 12, bold: true, line: 240, after: 8 * 20 }),
        ...empty(4),
        P("PROGAM STUDI INFORMATIKA", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("FAKULTAS TEKNIK", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("UNIVERSITAS KHAIRUN", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("TERNATE", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
        P("2026", { align: AlignmentType.CENTER, size: 16, bold: true, line: 240 }),
      ],
    },
    // ---- pengesahan ----
    {
      properties: { type: SectionType.NEXT_PAGE, page: { margin: normal } },
      children: [
        P("LEMBAR PENGESAHAN", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("SISTEM INFORMASI MANAJEMEN ARSIP DIGITAL BERBASIS WEB PADA DINAS PENDIDIKAN KOTA TERNATE", { align: AlignmentType.CENTER, size: 12, bold: true, line: 240 }),
        P("Oleh", { align: AlignmentType.CENTER, size: 14, line: 240 }),
        P("Andi Saputra", { align: AlignmentType.CENTER, size: 12, line: 240 }),
        P("07352111001", { align: AlignmentType.CENTER, size: 12, line: 240 }),
        P("Skripsi ini telah disahkan", { align: AlignmentType.CENTER, line: 240 }),
        P("Tanggal xx Juni 2026", { align: AlignmentType.CENTER, line: 240 }),
        P("Menyetujui", { align: AlignmentType.CENTER, line: 240 }),
        P("Tim Penguji", { align: AlignmentType.CENTER, line: 240 }),
        P("Ketua Penguji            Pembimbing Utama", { align: AlignmentType.LEFT, line: 240 }),
        P("Anggota Penguji          Pembimbing Pendamping", { align: AlignmentType.LEFT, line: 240 }),
        P("Mengetahui/Menyetujui", { align: AlignmentType.CENTER, line: 240 }),
        P("Koordinator Program Studi Informatika", { align: AlignmentType.LEFT, line: 240 }),
      ],
    },
    // ---- front matter (roman) ----
    {
      properties: { type: SectionType.NEXT_PAGE, page: { margin: body, pageNumbers: { start: 3, formatType: NumberFormat.LOWER_ROMAN } } },
      footers: { default: pageFooterCenter(true) },
      children: [
        P("KATA PENGANTAR", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P([R("Puji syukur penulis panjatkan kepada Allah SWT atas rahmat-Nya sehingga proposal dengan judul “"), R("Sistem Informasi Manajemen Arsip Digital Berbasis Web Pada Dinas Pendidikan Kota Ternate", { italic: true }), R("” dapat diselesaikan. Penulis mengucapkan terima kasih kepada:")], { line: 360, indent: cm(1) }),
        P("1. Bapak Dekan Fakultas Teknik Universitas Khairun.", { line: 360, align: AlignmentType.LEFT }),
        P("2. Bapak Rektor Universitas Khairun.", { line: 360, align: AlignmentType.LEFT }),
        P("3. Bapak Koordinator Program Studi Informatika.", { line: 360, align: AlignmentType.LEFT }),
        P("4. Bapak Pembimbing Utama dan Pembimbing Pendamping", { line: 360, align: AlignmentType.LEFT }),
        P("Ternate, 10 Juni 2026", { align: AlignmentType.RIGHT, line: 360 }),
        P("Penulis", { align: AlignmentType.RIGHT, line: 360 }),
        new Paragraph({ children: [new PageBreak()] }),
        P("DAFTAR ISI", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("Halaman", { align: AlignmentType.RIGHT, line: 360 }),
        P("HALAMAN JUDUL ........................................................ i", { align: AlignmentType.LEFT, line: 360 }),
        P("HALAMAN PENGESAHAN .............................................. ii", { align: AlignmentType.LEFT, line: 360 }),
        P("KATA PENGANTAR ....................................................... iii", { align: AlignmentType.LEFT, line: 360 }),
        P("DAFTAR ISI ................................................................ iv", { align: AlignmentType.LEFT, line: 360 }),
        P("BAB I PENDAHULUAN", { align: AlignmentType.LEFT, line: 360 }),
        P("1.1. Latar Belakang ........................................................ 1", { align: AlignmentType.LEFT, line: 360 }),
        P("1.2 Rumusan Masalah ..................................................... 2", { align: AlignmentType.LEFT, line: 360 }),
        P("BAB II TINJAUAN PUSTAKA", { align: AlignmentType.LEFT, line: 360 }),
        P("2.1. Penelitian Terkait .................................................... 3", { align: AlignmentType.LEFT, line: 360 }),
        P("BAB III METODE PENELITIAN", { align: AlignmentType.LEFT, line: 360 }),
        P("3.1. Alat dan Bahan ....................................................... 5", { align: AlignmentType.LEFT, line: 360 }),
        P("DAFTAR PUSTAKA", { align: AlignmentType.LEFT, line: 360 }),
      ],
    },
    // ---- BAB I (no section break numbering start -> error expected) ----
    {
      properties: { type: SectionType.NEXT_PAGE, page: { margin: body, pageNumbers: { formatType: NumberFormat.DECIMAL } }, titlePage: true },
      footers: { first: pageFooterCenter() },
      headers: { default: pageHeaderRight },
      children: [
        P("BAB I", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("PENDAHULUAN", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("1.1. Latar Belakang", { align: AlignmentType.LEFT, bold: true }),
        P(lorem + " (Alfredo, 2024).", { indent: cm(1) }),
        P([R("Sistem ini dibangun menggunakan framework Laravel dengan pendekatan "), R("machine learning", { italic: true }), R(" dan deep learning untuk klasifikasi dokumen , sehingga proses menjadi efisien (Sabaruddin 2022).")], { indent: cm(1), line: 360, after: 8 * 20 }),
        P("1.2 Rumusan Masalah", { align: AlignmentType.LEFT, bold: true }),
        P("Bagaimana merancang sistem informasi arsip digital", { indent: cm(1), size: 11 }),
        P("1.3. Batasan Masalah", { align: AlignmentType.LEFT, bold: false }),
        P("1. Sistem hanya mengelola arsip surat masuk dan keluar", { align: AlignmentType.LEFT }),
        P("2. Pengguna terdiri dari admin dan staf.", { align: AlignmentType.LEFT }),
        P("Tabel 1.1 Perbandingan Penelitian", { align: AlignmentType.LEFT }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [new TableCell({ children: [P("No", { line: 360, align: AlignmentType.CENTER })] }), new TableCell({ children: [P("Peneliti", { line: 240, align: AlignmentType.CENTER })] })] }),
            new TableRow({ children: [new TableCell({ children: [P("1", { line: 240, align: AlignmentType.CENTER })] }), new TableCell({ children: [P("Alfredo (2024)", { line: 240 })] })] }),
          ],
        }),
        P("Penjelasan terkait dengan tabel 1.1 dapat dilihat pada tabel 1.1.", { indent: cm(1) }),
        new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0 }, children: [new ImageRun({ type: "png", data: png, transformation: { width: 300, height: 120 } })] }),
        P("Gambar 1.1 Arsitektur sistem", { align: AlignmentType.CENTER }),
      ],
    },
    // ---- BAB II: not starting a new section (same section as BAB III) ----
    {
      properties: { type: SectionType.NEXT_PAGE, page: { margin: body } },
      children: [
        P("BAB II", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("TINJAUAN PUSTAKA", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("2.1. Penelitian Terkait", { align: AlignmentType.LEFT, bold: true }),
        P(lorem + ".", { indent: cm(1) }),
        P("BAB III", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("METODE PENELITIAN", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("3.1. Alat dan Bahan", { align: AlignmentType.LEFT, bold: true }),
        P(lorem + " seperti pada gambar 3.1.", { indent: cm(1), font: "Times New Roman" }),
        new Paragraph({ children: [new PageBreak()] }),
        P("DAFTAR PUSTAKA", { align: AlignmentType.CENTER, size: 14, bold: true, line: 480 }),
        P("Alfredo, A. (2024). Analisis Kepadatan Penduduk dan Transportasi Kota. Jurnal Teknik, 3(1), 1-10.", { align: AlignmentType.LEFT, line: 360, hanging: cm(1) }),
        P("Sabaruddin. (2022). Transportasi dan Perkembangan Kota Ternate. Jurnal Wilayah, 5(2), 20-30.", { align: AlignmentType.LEFT, line: 240 }),
      ],
    },
  ],
});

const out = await Packer.toBuffer(doc);
fs.mkdirSync("testing-data", { recursive: true }); // folder is git-ignored, so it may not exist in a fresh clone
fs.writeFileSync("testing-data/fixture-proposal.docx", out);
console.log("written testing-data/fixture-proposal.docx", out.length, "bytes");
