import type { RuleContext } from "./context";
import type { Para } from "../model";
import { cmToPt, ptToCm } from "../model";
import { CONJUNCTIONS, dominantSize, fmtSpacing, isMostlyBold, isUpperCase, locOf, titleCaseViolations, words } from "./util";
import { FOREIGN_TERMS } from "./foreign";

const CAT = "Sampul (Cover)";
const JENIS_RE = /^(SKRIPSI|PROPOSAL|PROPOSAL SKRIPSI|HASIL|LAPORAN HASIL|KERJA PRAKTIK|LAPORAN KERJA PRAKTIK|TUGAS AKHIR)$/;

interface CoverLine {
  text: string;
  para: Para;
  size?: number;
  bold: boolean;
}

export function coverRules(ctx: RuleContext) {
  const { c, doc } = ctx;
  const cover = ctx.sections.find((s) => s.kind === "cover");
  if (!cover) {
    c.error("COVER-00", CAT, "Halaman sampul tidak ditemukan", "Dokumen harus dimulai dengan halaman sampul.", {});
    return;
  }
  const paras = ctx.coverParas().filter((p) => !p.isEmpty);
  const lines: CoverLine[] = [];
  for (const p of paras) {
    const size = dominantSize(p);
    const bold = isMostlyBold(p, 0.6);
    for (const l of p.textLines) if (l.trim()) lines.push({ text: l.trim(), para: p, size, bold });
  }
  if (!lines.length) {
    c.error("COVER-00", CAT, "Halaman sampul kosong", "Tidak ada teks yang terbaca pada halaman pertama.", {});
    return;
  }

  // ---- 1. jenis laporan ----
  const jenis = lines[0];
  if (!JENIS_RE.test(jenis.text.toUpperCase()))
    c.error("COVER-01", CAT, "Baris pertama sampul bukan jenis laporan", `Baris pertama sampul adalah "${jenis.text}". Baris pertama harus jenis laporan: KERJA PRAKTIK / PROPOSAL / HASIL / SKRIPSI.`, locOf(jenis.para, cover.label), {
      expected: "SKRIPSI / PROPOSAL / HASIL / KERJA PRAKTIK (huruf kapital, 16 pt, Arial Narrow)",
      actual: jenis.text,
    });
  else if (!isUpperCase(jenis.text)) c.error("COVER-01", CAT, "Jenis laporan harus huruf kapital", `"${jenis.text}" harus ditulis kapital, misalnya "${jenis.text.toUpperCase()}".`, locOf(jenis.para, cover.label));
  checkSize(ctx, jenis, 16, "Jenis judul laporan", "COVER-02");

  // ---- 2. title block ----
  const olehIdx = lines.findIndex((l, i) => i > 0 && /^OLEH$/i.test(l.text));
  if (olehIdx < 0) {
    c.error("COVER-05", CAT, 'Kata "OLEH" tidak ditemukan pada sampul', 'Sampul harus memuat kata "OLEH" (kapital, 14 pt) di atas nama mahasiswa.', locOf(jenis.para, cover.label));
  }
  const titleEnd = olehIdx > 0 ? olehIdx : Math.min(lines.length, 5);
  const titleLines = lines.slice(1, titleEnd);
  const mainTitleLines = titleLines.filter((l) => !/^\(?\s*STUDI KASUS/i.test(l.text));
  const studiLines = titleLines.filter((l) => /^\(?\s*STUDI KASUS/i.test(l.text));
  const titleText = mainTitleLines.map((l) => l.text).join(" ");
  ctx.coverTitle = titleText.toUpperCase();

  if (!titleLines.length) c.error("COVER-03", CAT, "Judul tidak ditemukan pada sampul", "Tidak ada baris judul di antara jenis laporan dan kata OLEH.", locOf(jenis.para, cover.label));
  for (const l of mainTitleLines) {
    if (!isUpperCase(l.text)) c.error("COVER-03", CAT, "Judul sampul harus huruf kapital", `Baris judul "${l.text}" tidak seluruhnya kapital.`, locOf(l.para, cover.label, l.text), { fold: true });
    checkSize(ctx, l, 16, "Subjek judul laporan", "COVER-04");
  }
  for (const l of studiLines) {
    const m = l.text.match(/^\((Studi Kasus)\s*:\s*(.+)\)$/);
    if (!m) {
      c.error("COVER-06", CAT, "Format baris Studi Kasus tidak sesuai", `Baris "${l.text}" harus ditulis dalam kurung dengan format "(Studi Kasus: Nama Objek Penelitian)" dan huruf Capitalize Each Word.`, locOf(l.para, cover.label, l.text), {
        expected: "(Studi Kasus: Rumah Sakit XXX)",
        actual: l.text,
      });
    } else {
      const bad = titleCaseViolations(m[2], { allowLowerConjunctions: false });
      if (bad.length) c.error("COVER-06", CAT, "Objek studi kasus harus Capitalize Each Word", `Kata "${bad.join('", "')}" pada "${l.text}" harus diawali huruf kapital.`, locOf(l.para, cover.label, l.text));
    }
  }
  const wc = words(titleText).length;
  if (wc > 15) c.warn("COVER-07", CAT, `Judul terlalu panjang (${wc} kata)`, `Judul sebaiknya maksimal 15 kata (judul abstrak dibatasi 15 kata). Konsultasikan dengan pembimbing bila melebihi.`, locOf(mainTitleLines[0]?.para ?? jenis.para, cover.label), { expected: "≤ 15 kata", actual: `${wc} kata` });
  // conjunction at end of line (not the last line)
  for (let i = 0; i < mainTitleLines.length - 1; i++) {
    const ws = words(mainTitleLines[i].text);
    const last = ws[ws.length - 1]?.toLowerCase().replace(/[^a-z]/g, "");
    if (last && CONJUNCTIONS.has(last))
      c.error("COVER-08", CAT, "Kata penghubung di akhir baris judul", `Baris judul "${mainTitleLines[i].text}" diakhiri kata penghubung "${ws[ws.length - 1]}". Kata penghubung (dan/pada/di/untuk/terhadap, dll.) harus dipindahkan ke awal baris berikutnya (gunakan Enter/Shift+Enter).`, locOf(mainTitleLines[i].para, cover.label, mainTitleLines[i].text), {
        expected: "Kata penghubung mengawali baris berikutnya",
      });
  }
  // foreign terms in title must be italic
  for (const l of titleLines) {
    const lower = l.text.toLowerCase();
    for (const term of FOREIGN_TERMS) {
      const idx = lower.indexOf(term);
      if (idx < 0) continue;
      if (!new RegExp(`(^|[^a-z])${escapeRe(term)}([^a-z]|$)`).test(lower)) continue;
      // check runs covering the term are italic
      const italic = l.para.runs.filter((r) => r.text.toLowerCase().includes(term)).every((r) => r.italic) && l.para.runs.some((r) => r.text.toLowerCase().includes(term));
      if (!italic) c.warn("COVER-09", CAT, "Istilah asing pada judul belum dimiringkan (italic)", `Istilah "${term}" pada judul sampul harus italic (Ctrl+I).`, locOf(l.para, cover.label, l.text), { fold: true });
    }
  }

  // ---- 3. OLEH block ----
  if (olehIdx > 0) {
    const oleh = lines[olehIdx];
    if (oleh.text !== "OLEH") c.error("COVER-05", CAT, 'Kata "OLEH" harus kapital', `Ditemukan "${oleh.text}", seharusnya "OLEH" (Uppercase).`, locOf(oleh.para, cover.label));
    checkSize(ctx, oleh, 14, 'Kata "OLEH"', "COVER-10");
    const nama = lines[olehIdx + 1];
    const npm = lines[olehIdx + 2];
    if (!nama) c.error("COVER-11", CAT, "Nama mahasiswa tidak ditemukan", "Setelah OLEH harus ada baris nama mahasiswa (14 pt, Capitalize Each Word).", locOf(oleh.para, cover.label));
    else {
      if (isUpperCase(nama.text) && nama.text.replace(/[^A-Za-z]/g, "").length > 3) c.error("COVER-11", CAT, "Nama mahasiswa tidak boleh kapital seluruhnya", `"${nama.text}" harus ditulis Capitalize Each Word, misalnya "${toTitle(nama.text)}".`, locOf(nama.para, cover.label, nama.text), { expected: toTitle(nama.text), actual: nama.text });
      else {
        const bad = titleCaseViolations(nama.text);
        if (bad.length) c.error("COVER-11", CAT, "Nama mahasiswa harus Capitalize Each Word", `Kata "${bad.join('", "')}" pada nama "${nama.text}" harus diawali huruf kapital.`, locOf(nama.para, cover.label, nama.text));
      }
      checkSize(ctx, nama, 14, "Nama mahasiswa", "COVER-10");
    }
    if (!npm) c.error("COVER-12", CAT, "NPM tidak ditemukan", "Setelah nama mahasiswa harus ada baris NPM (14 pt).", locOf(oleh.para, cover.label));
    else {
      const digits = npm.text.replace(/\s/g, "");
      if (!/^\d{8,14}$/.test(digits)) c.error("COVER-12", CAT, "Baris NPM tidak berupa angka", `Baris setelah nama berisi "${npm.text}". Baris ini harus NPM (contoh 0735XXXXXXX) tanpa label "NPM:".`, locOf(npm.para, cover.label, npm.text), { expected: "0735XXXXXXX", actual: npm.text });
      else if (!digits.startsWith("0735")) c.info("COVER-12", CAT, "NPM tidak berawalan 0735", `NPM "${npm.text}" tidak berawalan 0735 (kode Prodi Informatika). Pastikan NPM benar.`, locOf(npm.para, cover.label, npm.text));
      checkSize(ctx, npm, 14, "NPM", "COVER-10");
    }
  }

  // ---- 4. institution block ----
  const expectInst: { re: RegExp; label: string }[] = [
    { re: /^PROGRAM STUDI (TEKNIK )?INFORMATIKA$/, label: "PROGRAM STUDI INFORMATIKA" },
    { re: /^FAKULTAS TEKNIK$/, label: "FAKULTAS TEKNIK" },
    { re: /^UNIVERSITAS KHAIRUN$/, label: "UNIVERSITAS KHAIRUN" },
    { re: /^TERNATE$/, label: "TERNATE" },
    { re: /^(19|20)\d{2}$/, label: "TAHUN (contoh 2026)" },
  ];
  const instStart = lines.findIndex((l) => /^PROGR?AM STUDI/i.test(l.text));
  if (instStart < 0) c.error("COVER-13", CAT, "Blok PROGRAM STUDI … tidak ditemukan", "Bagian bawah sampul harus memuat PROGRAM STUDI INFORMATIKA, FAKULTAS TEKNIK, UNIVERSITAS KHAIRUN, TERNATE, dan tahun (16 pt, kapital, rata tengah).", locOf(lines[lines.length - 1].para, cover.label));
  else {
    const inst = lines.slice(instStart);
    expectInst.forEach((e, i) => {
      const l = inst[i];
      if (!l) {
        c.error("COVER-13", CAT, `Baris "${e.label}" tidak ditemukan pada blok institusi`, `Urutan blok institusi harus: ${expectInst.map((x) => x.label).join(" / ")}.`, locOf(inst[0].para, cover.label), { fold: true });
        return;
      }
      if (!e.re.test(l.text.toUpperCase())) {
        c.error("COVER-13", CAT, `Baris institusi ke-${i + 1} tidak sesuai`, `Ditemukan "${l.text}", seharusnya "${e.label}".`, locOf(l.para, cover.label, l.text), { expected: e.label, actual: l.text, fold: true });
      } else if (!isUpperCase(l.text) && i < 4) c.error("COVER-13", CAT, "Blok institusi harus huruf kapital", `"${l.text}" harus kapital.`, locOf(l.para, cover.label, l.text), { fold: true });
      if (/^PROGAM/i.test(l.text)) c.error("COVER-13", CAT, 'Salah ketik "PROGAM"', 'Tulis "PROGRAM STUDI INFORMATIKA".', locOf(l.para, cover.label, l.text));
      checkSize(ctx, l, 16, "Blok institusi", "COVER-14");
    });
    if (inst.length > expectInst.length) c.warn("COVER-13", CAT, "Ada baris tambahan setelah tahun pada sampul", `Baris "${inst[expectInst.length].text}" tidak diharapkan setelah tahun.`, locOf(inst[expectInst.length].para, cover.label));
  }

  // ---- 5. alignment & bold ----
  const byTab = paras.filter((p) => p.align !== "center" && p.centeredByTab);
  for (const p of byTab)
    c.warn("COVER-15", CAT, "Teks sampul ditengahkan dengan Tab, bukan rata tengah", `"${p.text}" diposisikan dengan tab stop tengah (Tab), bukan perataan Center. Posisinya bisa bergeser bila teks/margin berubah.`, locOf(p, cover.label), { fix: "Hapus karakter Tab dan tab stop pada paragraf ini, lalu Ctrl+E.", fold: true });
  const notCentered = paras.filter((p) => p.align !== "center" && !p.images.length && !p.centeredByTab);
  if (notCentered.length)
    c.error("COVER-15", CAT, "Teks sampul tidak rata tengah", `${notCentered.length} paragraf pada sampul tidak rata tengah (Ctrl+E), contoh: "${notCentered[0].text.slice(0, 60)}".`, locOf(notCentered[0], cover.label), { fix: "Blok seluruh teks sampul lalu Ctrl+E." });
  const notBold = lines.filter((l) => !l.bold);
  if (notBold.length) c.warn("COVER-16", CAT, "Teks sampul tidak tebal (bold)", `Pada template sampul seluruh teks ditebalkan. Baris tidak tebal: "${notBold.slice(0, 3).map((l) => l.text).join('", "')}"${notBold.length > 3 ? ", …" : ""}.`, locOf(notBold[0].para, cover.label));

  // ---- 6. line spacing ----
  if (!ctx.isPdf) {
    if (jenis.para.lineSpacing !== undefined && Math.abs(jenis.para.lineSpacing - 2) > 0.05)
      c.error("COVER-17", CAT, "Line spacing jenis judul laporan bukan 2.0", `Paragraf "${jenis.text}" menggunakan line spacing ${fmtSpacing(jenis.para.lineSpacing)}; panduan: 2.0 dengan Space Before/After dihapus.`, locOf(jenis.para, cover.label), { expected: "2.0", actual: fmtSpacing(jenis.para.lineSpacing) });
    for (const l of [...titleLines, ...(olehIdx > 0 ? lines.slice(olehIdx, olehIdx + 3) : [])]) {
      if (l.para.lineSpacing !== undefined && Math.abs(l.para.lineSpacing - 1) > 0.05)
        c.error("COVER-18", CAT, "Line spacing judul / blok OLEH bukan 1.0", `Paragraf "${l.text}" menggunakan line spacing ${fmtSpacing(l.para.lineSpacing)}; panduan: 1.0.`, locOf(l.para, cover.label, l.text), { expected: "1.0", actual: fmtSpacing(l.para.lineSpacing), fold: true });
    }
  } else {
    // measure from geometry: gap jenis -> first title line should be 2.0 × line height (≈ 36.8 pt at 16 pt)
    const titleFirst = mainTitleLines[0];
    if (titleFirst && jenis.para.lineBaselines && titleFirst.para.lineBaselines) {
      const d = titleFirst.para.lineBaselines[0] - jenis.para.lineBaselines[jenis.para.lineBaselines.length - 1];
      const size = jenis.size ?? 16;
      const ratio = d / (size * 1.15);
      if (Math.abs(ratio - 2) > 0.25) c.error("COVER-17", CAT, "Line spacing jenis judul laporan bukan 2.0", `Jarak antara "${jenis.text}" dan judul setara ${ratio.toFixed(2)} baris; panduan: 2.0 (jenis judul laporan) dengan Space Before/After dihapus.`, locOf(jenis.para, cover.label), { expected: "2.0", actual: ratio.toFixed(2) });
    }
    for (const p of new Set([...titleLines, ...(olehIdx > 0 ? lines.slice(olehIdx, olehIdx + 3) : []), ...lines.slice(Math.max(0, instStart))].map((l) => l.para))) {
      if (p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1) > 0.1)
        c.error("COVER-18", CAT, "Line spacing blok sampul bukan 1.0", `Paragraf "${p.text.slice(0, 60)}" menggunakan line spacing ≈ ${fmtSpacing(p.lineSpacing)}; panduan: 1.0 untuk judul, OLEH/nama/NPM, dan blok institusi.`, locOf(p, cover.label), { expected: "1.0", actual: fmtSpacing(p.lineSpacing), fold: true });
    }
    // 1.0 spacing between separate single-line paragraphs in the same block (e.g. OLEH / nama / NPM)
    if (olehIdx > 0) {
      const blk = lines.slice(olehIdx, olehIdx + 3);
      for (let i = 1; i < blk.length; i++) {
        const a = blk[i - 1].para, b = blk[i].para;
        if (a === b || !a.lineBaselines || !b.lineBaselines) continue;
        const d = b.lineBaselines[0] - a.lineBaselines[a.lineBaselines.length - 1];
        const ratio = d / ((blk[i].size ?? 14) * 1.15);
        if (Math.abs(ratio - 1) > 0.2) c.error("COVER-18", CAT, "Jarak baris blok OLEH/nama/NPM bukan 1.0", `Jarak "${blk[i - 1].text}" → "${blk[i].text}" setara ${ratio.toFixed(2)} baris; panduan 1.0.`, locOf(b, cover.label, blk[i].text), { fold: true });
      }
    }
  }

  // ---- 7. logo ----
  const coverImages = ctx.isPdf ? (doc.pages?.[0]?.images ?? []) : paras.concat(ctx.coverParas().filter((p) => p.isEmpty)).flatMap((p) => p.images);
  if (!coverImages.length) c.error("COVER-20", CAT, "Logo Universitas Khairun tidak ditemukan", "Sampul harus memuat logo (Height 4 cm, Width 4,15 cm) di tengah antara judul dan kata OLEH.", locOf(jenis.para, cover.label), { fix: "Insert → Pictures → logo Unkhair; Picture Format → Size: Height 4 cm, Width 4,15 cm; Wrap Text: In Line With Text; Ctrl+E." });
  else {
    if (coverImages.length > 1) c.warn("COVER-20", CAT, `Terdapat ${coverImages.length} gambar pada sampul`, "Sampul seharusnya hanya memuat satu logo.", locOf(jenis.para, cover.label));
    const logo = coverImages.reduce((a, b) => (a.widthCm * a.heightCm >= b.widthCm * b.heightCm ? a : b));
    const okH = Math.abs(logo.heightCm - 4) <= 0.2;
    const okW = Math.abs(logo.widthCm - 4.15) <= 0.2;
    if (!okH || !okW)
      c.error("COVER-21", CAT, "Ukuran logo tidak sesuai", `Ukuran logo terbaca ${logo.widthCm.toFixed(2)} × ${logo.heightCm.toFixed(2)} cm (lebar × tinggi). Panduan: Width 4,15 cm, Height 4 cm.`, locOf(jenis.para, cover.label), { expected: "4,15 × 4,00 cm", actual: `${logo.widthCm.toFixed(2)} × ${logo.heightCm.toFixed(2)} cm`, fix: "Klik logo → Picture Format → Size (nonaktifkan Lock aspect ratio bila perlu)." });
    if (logo.anchored) c.warn("COVER-22", CAT, "Logo tidak In Line With Text", "Logo menggunakan wrap text mengambang (anchor). Panduan: Wrap Text → In Line With Text, lalu Ctrl+E.", locOf(jenis.para, cover.label));
    if (ctx.isPdf && logo.bbox && doc.pages?.[0]) {
      const cx = logo.bbox.x + logo.bbox.w / 2;
      if (Math.abs(cx - doc.pages[0].width / 2) > 6) c.error("COVER-22", CAT, "Logo tidak berada di tengah halaman", `Pusat logo berada ${ptToCm(cx - doc.pages[0].width / 2).toFixed(2)} cm dari tengah halaman.`, locOf(jenis.para, cover.label), { fix: "Klik logo → Wrap Text: In Line With Text → Ctrl+E." });
    }
    if (!ctx.isPdf) {
      const holder = ctx.coverParas().find((p) => p.images.length);
      if (holder && holder.align !== "center") c.error("COVER-22", CAT, "Paragraf logo tidak rata tengah", "Paragraf yang memuat logo harus rata tengah (Ctrl+E).", locOf(holder, cover.label));
    }
  }

  // ---- 8. vertical geometry (pdf) ----
  if (ctx.isPdf && doc.pages?.[0]) {
    const pg = doc.pages[0];
    const top = jenis.para.bbox?.yTop;
    if (top !== undefined && Math.abs(top - cmToPt(2.54)) > 10) c.warn("COVER-23", CAT, "Jenis judul tidak tepat di margin atas", `Baris pertama sampul berada ${ptToCm(top).toFixed(2)} cm dari tepi atas; margin Normal = 2,54 cm. Pastikan tidak ada baris kosong di atas jenis laporan dan margin sampul Normal.`, locOf(jenis.para, cover.label));
    const lastLine = lines[lines.length - 1];
    const bottom = lastLine.para.bbox?.yBottom;
    if (bottom !== undefined) {
      const gap = pg.height - bottom;
      if (gap > cmToPt(2.54) + 16) c.warn("COVER-24", CAT, "Blok institusi (segitiga terbalik) tidak rata dengan margin bawah", `Baris terakhir sampul ("${lastLine.text}") berakhir ${ptToCm(gap).toFixed(2)} cm dari tepi bawah; seharusnya menempel margin bawah 2,54 cm. Tambahkan baris kosong secukupnya di atas blok institusi.`, locOf(lastLine.para, cover.label));
      else if (gap < cmToPt(2.54) - 8) c.warn("COVER-24", CAT, "Blok institusi melewati margin bawah", `Baris terakhir sampul berakhir ${ptToCm(gap).toFixed(2)} cm dari tepi bawah (< 2,54 cm).`, locOf(lastLine.para, cover.label));
    }
    // symmetry: title→logo, logo→OLEH, NPM→institution
    const logo = pg.images[0];
    const lastTitle = titleLines[titleLines.length - 1];
    const oleh = olehIdx > 0 ? lines[olehIdx] : undefined;
    const npm = olehIdx > 0 ? lines[olehIdx + 2] : undefined;
    const inst = instStart >= 0 ? lines[instStart] : undefined;
    if (logo?.bbox && lastTitle?.para.bbox && oleh?.para.bbox && npm?.para.bbox && inst?.para.bbox) {
      const g1 = logo.bbox.y - lastTitle.para.bbox.yBottom;
      const g2 = oleh.para.bbox.yTop - (logo.bbox.y + logo.bbox.h);
      const g3 = inst.para.bbox.yTop - npm.para.bbox.yBottom;
      const gaps = [g1, g2, g3];
      const mx = Math.max(...gaps), mn = Math.min(...gaps);
      if (mn > 0 && mx / mn > 1.6)
        c.warn("COVER-25", CAT, "Jarak antar blok sampul tidak simetris", `Jarak judul→logo ${ptToCm(g1).toFixed(1)} cm, logo→OLEH ${ptToCm(g2).toFixed(1)} cm, NPM→institusi ${ptToCm(g3).toFixed(1)} cm. Ketiga jarak sebaiknya kurang lebih sama (atur jumlah baris kosong).`, locOf(jenis.para, cover.label));
      if (mn <= 0) c.warn("COVER-25", CAT, "Blok sampul saling bertumpuk", "Logo atau blok teks saling menimpa; periksa posisi logo (In Line With Text).", locOf(jenis.para, cover.label));
    }
  }
}

function checkSize(ctx: RuleContext, l: CoverLine, expected: number, label: string, id: string) {
  if (l.size === undefined) return;
  if (Math.abs(l.size - expected) > 0.6)
    ctx.c.error(id, CAT, `Ukuran font ${label} bukan ${expected} pt`, `"${l.text}" berukuran ${l.size} pt; panduan: ${expected} pt.`, locOf(l.para, "Sampul", l.text), { expected: `${expected} pt`, actual: `${l.size} pt`, fold: true });
}

function toTitle(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
