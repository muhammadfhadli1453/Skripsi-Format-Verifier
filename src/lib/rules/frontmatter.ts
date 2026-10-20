import type { RuleContext } from "./context";
import type { LogicalSection, Para, SectionKind } from "../model";
import { CONJUNCTIONS, dominantSize, fmtSpacing, isMostlyBold, isMostlyItalic, isUpperCase, locOf, titleCaseViolations, words } from "./util";
import { captionsInBody, subHeadingsInBody } from "./body";

const CAT_STRUCT = "Struktur Dokumen";
const CAT_PENGESAHAN = "Lembar Pengesahan";
const CAT_PERNYATAAN = "Pernyataan Keaslian";
const CAT_KP = "Kata Pengantar";
const CAT_DAFTAR = "Daftar Isi / Gambar / Tabel";
const CAT_ABSTRAK = "Abstrak";

const ORDER: SectionKind[] = ["cover", "pengesahan", "pernyataan", "persembahan", "kata-pengantar", "daftar-isi", "daftar-gambar", "daftar-tabel", "daftar-lampiran", "abstrak", "abstract", "bab", "daftar-pustaka", "lampiran"];

export function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const A = norm(a), B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

export function frontMatterRules(ctx: RuleContext) {
  const { c, docType } = ctx;
  const has = (k: SectionKind) => ctx.sections.some((s) => s.kind === k);
  const chapters = ctx.sections.filter((s) => s.kind === "bab").map((s) => s.chapter ?? 0);

  /* ---------- required sections ---------- */
  const required: { kind: SectionKind; label: string; sev: "error" | "warning" }[] = [
    { kind: "pengesahan", label: "Lembar Pengesahan", sev: "error" },
    { kind: "kata-pengantar", label: "Kata Pengantar", sev: "error" },
    { kind: "daftar-isi", label: "Daftar Isi", sev: "error" },
    { kind: "daftar-gambar", label: "Daftar Gambar", sev: "warning" },
    { kind: "daftar-tabel", label: "Daftar Tabel", sev: "warning" },
    { kind: "daftar-pustaka", label: "Daftar Pustaka", sev: "error" },
  ];
  if (docType === "skripsi") {
    required.push({ kind: "pernyataan", label: "Lembar Pernyataan Keaslian (khusus skripsi)", sev: "error" });
    required.push({ kind: "abstrak", label: "Abstrak (khusus skripsi)", sev: "error" });
  }
  for (const r of required) {
    if (!has(r.kind)) c.add({ id: "STRUCT-01", severity: r.sev, category: CAT_STRUCT, title: `Bagian "${r.label}" tidak ditemukan`, detail: `Judul halaman "${r.label.toUpperCase().split(" (")[0]}" tidak terdeteksi. Pastikan judul halaman ditulis kapital, rata tengah, dan berada pada baris sendiri.`, location: {} });
  }
  const expectedChapters = docType === "proposal" ? 3 : docType === "skripsi" ? 5 : docType === "hasil" ? 4 : 0;
  if (expectedChapters) {
    for (let n = 1; n <= expectedChapters; n++) if (!chapters.includes(n)) c.error("STRUCT-02", CAT_STRUCT, `BAB ${toRoman(n)} tidak ditemukan`, `Naskah ${docType} harus memuat BAB I sampai BAB ${toRoman(expectedChapters)}. Judul BAB harus ditulis "BAB ${toRoman(n)}" rata tengah pada baris sendiri.`, {});
    const extra = chapters.filter((n) => n > expectedChapters);
    if (extra.length) c.warn("STRUCT-02", CAT_STRUCT, `Terdapat BAB melebihi BAB ${toRoman(expectedChapters)}`, `Naskah ${docType} dibatasi hingga BAB ${toRoman(expectedChapters)}; ditemukan BAB ${extra.map(toRoman).join(", ")}.`, {});
  }

  /* ---------- order ---------- */
  let lastRank = -1;
  for (const s of ctx.sections) {
    if (s.kind === "unknown") continue;
    const rank = ORDER.indexOf(s.kind);
    if (rank < lastRank && s.kind !== "bab") {
      const prevLabel = ORDER[lastRank];
      c.warn("STRUCT-03", CAT_STRUCT, `Urutan bagian "${s.label}" tidak sesuai`, `"${s.label}" muncul setelah bagian "${prevLabel}". Urutan panduan: Sampul, Pengesahan, Pernyataan Keaslian, Persembahan, Kata Pengantar, Daftar Isi, Daftar Gambar, Daftar Tabel, Abstrak, BAB I…, Daftar Pustaka, Lampiran.`, s.headingParaIndex !== undefined ? locOf(ctx.doc.paras[s.headingParaIndex], s.label) : {});
    }
    lastRank = Math.max(lastRank, rank);
  }

  for (const s of ctx.sections) {
    switch (s.kind) {
      case "pengesahan":
        pengesahan(ctx, s);
        break;
      case "pernyataan":
        pernyataan(ctx, s);
        break;
      case "kata-pengantar":
        kataPengantar(ctx, s);
        break;
      case "daftar-isi":
        daftarIsi(ctx, s);
        break;
      case "daftar-gambar":
        daftarGambarTabel(ctx, s, "Gambar");
        break;
      case "daftar-tabel":
        daftarGambarTabel(ctx, s, "Tabel");
        break;
      case "abstrak":
        abstrak(ctx, s);
        break;
    }
  }
}

/* ------------------------------------------------------------------ */

function pengesahan(ctx: RuleContext, s: LogicalSection) {
  const { c, docType } = ctx;
  const paras = ctx.parasOf(s);
  const text = paras.map((p) => p.text).join(" \n ");
  const lower = text.toLowerCase();
  const need: { re: RegExp; label: string }[] = [
    { re: /\boleh\b/, label: "Oleh" },
    { re: /telah disahkan/, label: "… ini telah disahkan" },
    { re: /\btanggal\b/, label: "Tanggal xx Bulan 20xx" },
    { re: /\bmenyetujui\b/, label: "Menyetujui" },
    { re: /mengetahui\s*\/\s*menyetujui/, label: "Mengetahui/Menyetujui" },
    { re: /koordinator\s+program\s+studi/, label: "Koordinator Program Studi" },
  ];
  if (docType === "kp") {
    need.push({ re: /pembimbing kp lapangan|pembimbing lapangan/, label: "Pembimbing KP Lapangan" });
    need.push({ re: /pembimbing kp kampus|pembimbing kampus/, label: "Pembimbing KP Kampus" });
    need.push({ re: /koordinator\s+kerja\s+praktik/, label: "Koordinator Kerja Praktik" });
  } else {
    need.push({ re: /tim penguji/, label: "Tim Penguji" });
    need.push({ re: /ketua penguji/, label: "Ketua Penguji" });
    need.push({ re: /anggota penguji/, label: "Anggota Penguji" });
    need.push({ re: /pembimbing utama/, label: "Pembimbing Utama" });
    need.push({ re: /pembimbing pendamping/, label: "Pembimbing Pendamping" });
  }
  if (docType === "skripsi") need.push({ re: /dekan fakultas teknik/, label: "Dekan Fakultas Teknik" });
  const missing = need.filter((n) => !n.re.test(lower)).map((n) => n.label);
  const loc = paras[0] ? locOf(paras[0], s.label) : {};
  if (missing.length) c.warn("PENGESAHAN-01", CAT_PENGESAHAN, "Komponen lembar pengesahan tidak lengkap", `Tidak ditemukan: ${missing.join(", ")}. Sesuaikan dengan contoh lembar pengesahan ${docType === "kp" ? "Kerja Praktik" : docType === "proposal" ? "Proposal" : "Skripsi"} pada panduan.`, loc);
  const disahkan = lower.match(/(skripsi|proposal|laporan kerja praktik|kerja praktik|hasil)\s+ini\s+telah\s+disahkan/);
  const expectWord = docType === "skripsi" ? "skripsi" : docType === "proposal" ? "proposal" : docType === "kp" ? "laporan kerja praktik" : docType === "hasil" ? "hasil" : undefined;
  if (disahkan && expectWord && !disahkan[1].includes(expectWord.split(" ").pop()!))
    c.error("PENGESAHAN-02", CAT_PENGESAHAN, "Jenis naskah pada lembar pengesahan tidak sesuai sampul", `Lembar pengesahan menyebut "${disahkan[0]}" sedangkan sampul menyatakan naskah ${expectWord.toUpperCase()}.`, loc, { expected: `${capital(expectWord)} ini telah disahkan` });
  // title: first non-empty paragraph(s) before "Oleh"
  const olehIdx = paras.findIndex((p) => /^oleh$/i.test(p.text.trim()));
  const titleParas = olehIdx > 0 ? paras.slice(0, olehIdx) : paras.slice(0, 1);
  const title = titleParas.map((p) => p.text).join(" ");
  if (ctx.coverTitle && title && similarity(title, ctx.coverTitle) < 0.6)
    c.error("PENGESAHAN-03", CAT_PENGESAHAN, "Judul pada lembar pengesahan berbeda dengan sampul", `Lembar pengesahan: "${title.slice(0, 100)}" ≠ sampul: "${ctx.coverTitle.slice(0, 100)}".`, loc);
  for (const p of titleParas) {
    if (!isMostlyBold(p)) c.warn("PENGESAHAN-04", CAT_PENGESAHAN, "Judul pada lembar pengesahan tidak tebal", `Judul penelitian pada lembar pengesahan harus di-bold dengan line spacing 1.0.`, locOf(p, s.label), { fold: true });
    if (!ctx.isPdf && p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1) > 0.05) c.warn("PENGESAHAN-05", CAT_PENGESAHAN, "Line spacing judul pengesahan bukan 1.0", `Line spacing ${fmtSpacing(p.lineSpacing)}; panduan 1.0.`, locOf(p, s.label), { fold: true });
  }
}

function pernyataan(ctx: RuleContext, s: LogicalSection) {
  const { c } = ctx;
  const paras = ctx.parasOf(s);
  const text = paras.map((p) => p.text).join(" \n ");
  const lower = text.toLowerCase();
  const need = [
    { re: /\bnama\b/, label: "Nama" },
    { re: /\bnpm\b/, label: "NPM" },
    { re: /\bfakultas\b/, label: "Fakultas" },
    { re: /jurusan|program studi/, label: "Jurusan/Program Studi" },
    { re: /\bjudul\b/, label: "Judul Skripsi" },
    { re: /\bpenulis\b/, label: "Penulis (tanda tangan)" },
    { re: /universitas khairun/, label: "Universitas Khairun" },
  ];
  const missing = need.filter((n) => !n.re.test(lower)).map((n) => n.label);
  const loc = paras[0] ? locOf(paras[0], s.label) : {};
  if (missing.length) c.warn("PERNYATAAN-01", CAT_PERNYATAAN, "Komponen lembar pernyataan keaslian tidak lengkap", `Tidak ditemukan: ${missing.join(", ")}.`, loc);
  // title after "Judul ... :"
  const m = text.match(/judul(?:\s+skripsi)?\s*:\s*([^\n]+(?:\n[^\n:]+)*)/i);
  if (m) {
    const title = m[1].replace(/\s+/g, " ").trim();
    if (isUpperCase(title) && words(title).length > 3) c.error("PERNYATAAN-02", CAT_PERNYATAAN, "Judul pada pernyataan keaslian tidak boleh kapital seluruhnya", `Judul harus ditulis dengan huruf awal kapital pada setiap kata (Capitalize Each Word), bukan "${title.slice(0, 80)}".`, loc);
    else {
      const bad = titleCaseViolations(title, { allowLowerConjunctions: true });
      if (bad.length > 1) c.warn("PERNYATAAN-02", CAT_PERNYATAAN, "Judul pada pernyataan keaslian tidak Capitalize Each Word", `Kata "${bad.slice(0, 5).join('", "')}" harus diawali huruf kapital.`, loc);
    }
    if (ctx.coverTitle && similarity(title, ctx.coverTitle) < 0.6) c.error("PERNYATAAN-03", CAT_PERNYATAAN, "Judul pada pernyataan keaslian berbeda dengan sampul", `Pernyataan: "${title.slice(0, 100)}" ≠ sampul: "${ctx.coverTitle.slice(0, 100)}".`, loc);
  }
  if (!ctx.isPdf) {
    const bad = paras.filter((p) => p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1.5) > 0.05 && p.text.length > 40);
    if (bad.length) c.warn("PERNYATAAN-04", CAT_PERNYATAAN, "Line spacing pernyataan keaslian bukan 1,5", `${bad.length} paragraf menggunakan spacing selain 1,5 (contoh ${fmtSpacing(bad[0].lineSpacing)}).`, locOf(bad[0], s.label));
  }
}

const THANKS_RANK: { re: RegExp; rank: number; label: string }[] = [
  { re: /\brektor\b/i, rank: 1, label: "Rektor" },
  { re: /\bdekan\b/i, rank: 2, label: "Dekan Fakultas Teknik" },
  { re: /koordinator\s+(program\s+studi|prodi)|ketua\s+(program\s+studi|prodi|jurusan)/i, rank: 3, label: "Koordinator Program Studi" },
  { re: /koordinator\s+(kerja\s+praktik|kp)\b/i, rank: 4, label: "Koordinator Kerja Praktik" },
  { re: /pembimbing\s+(utama|pertama|1\b|i\b)|dosen\s+pembimbing\s+(utama|1\b|i\b)/i, rank: 5, label: "Pembimbing 1" },
  { re: /pembimbing\s+(pendamping|kedua|2\b|ii\b)/i, rank: 6, label: "Pembimbing 2" },
  { re: /pembimbing\s+(kp\s+)?lapangan/i, rank: 7, label: "Pembimbing KP Lapangan" },
  { re: /pembimbing\s+(kp\s+)?kampus/i, rank: 8, label: "Pembimbing KP Kampus" },
  { re: /ketua\s+penguji|penguji\s+(utama|pertama|1\b|i\b)/i, rank: 9, label: "Penguji 1" },
  { re: /anggota\s+penguji|penguji\s+(kedua|2\b|ii\b|ketiga|3\b|iii\b)/i, rank: 10, label: "Anggota Penguji" },
  { re: /(seluruh|semua|segenap|para)\s+(bapak\/ibu\s+)?dosen|bapak\s*\/\s*ibu\s+dosen|dosen\s+(program\s+studi|prodi)/i, rank: 12, label: "Seluruh Dosen Informatika" },
  { re: /orang\s*tua|ayah|ibunda|ayahanda|keluarga|kedua\s+orangtua/i, rank: 13, label: "Orang tua/Keluarga" },
  { re: /angkatan|teman|sahabat|rekan|himpunan|kawan/i, rank: 14, label: "Angkatan/Teman" },
  { re: /(semua|seluruh)\s+pihak/i, rank: 15, label: "Pihak yang terlibat" },
];

function kataPengantar(ctx: RuleContext, s: LogicalSection) {
  const { c, docType } = ctx;
  const paras = ctx.parasOf(s);
  const all = paras.map((p) => p.text).join(" \n ");
  const loc = paras[0] ? locOf(paras[0], s.label) : {};

  // forbidden abbreviations
  for (const p of paras) {
    const m = p.text.match(/\b(SWT|SAW)\b\.?/);
    if (m) {
      const at = m.index ?? 0;
      const around = p.text.slice(Math.max(0, at - 40), at + 20).trim();
      c.error("KP-01", CAT_KP, `Singkatan gelar "${m[1]}" tidak diperbolehkan`, `Ditemukan "…${around}…". Tulis lengkap: "Allah Subhanahu wata’ala" dan "Muhammad Shallallahu ‘alaihi wasallam", bukan "ALLAH SWT"/"Muhammad SAW".`, locOf(p, s.label, `…${around}…`), { fold: true });
    }
  }
  // quoted title
  for (const p of paras) {
    const q = p.text.match(/[“"]([^”"]{15,})[”"]/);
    if (!q) continue;
    const quoted = q[1].trim();
    if (ctx.coverTitle && similarity(quoted, ctx.coverTitle) >= 0.3) {
      if (similarity(quoted, ctx.coverTitle) < 0.6) c.error("KP-02", CAT_KP, "Judul pada kata pengantar berbeda dengan judul sampul", `Kata pengantar: "${quoted.slice(0, 100)}" ≠ sampul: "${ctx.coverTitle.slice(0, 100)}". Samakan judul di seluruh bagian naskah.`, locOf(p, s.label));
      if (isUpperCase(quoted)) c.error("KP-03", CAT_KP, "Judul pada kata pengantar ditulis kapital seluruhnya", `Judul yang dikutip pada kata pengantar tidak boleh kapital semua; gunakan huruf awal kapital tiap kata (contoh panduan: "Audit Tingkat Kapabilitas Sistem Informasi Kubermas (SIMAS) Menggunakan Framework COBIT 5").`, locOf(p, s.label));
      const quotedRuns = p.runs.filter((r) => quoted.includes(r.text.trim()) && r.text.trim().length > 3);
      if (quotedRuns.length && quotedRuns.every((r) => r.italic)) c.error("KP-04", CAT_KP, "Judul pada kata pengantar dimiringkan (italic)", "Judul yang dikutip pada kata pengantar tidak boleh italic.", locOf(p, s.label));
      const capConj = words(quoted).filter((w, i) => i > 0 && CONJUNCTIONS.has(w.toLowerCase()) && /^[A-Z]/.test(w));
      if (capConj.length) c.warn("KP-05", CAT_KP, "Kata penghubung pada judul ditulis kapital", `Kata "${[...new Set(capConj)].join('", "')}" pada judul di kata pengantar sebaiknya huruf kecil (dan, pada, di, untuk, dengan, …).`, locOf(p, s.label));
    }
  }
  // document type mention
  const typeWord = docType === "skripsi" ? /\bskripsi\b/i : docType === "proposal" ? /\bproposal\b/i : docType === "kp" ? /kerja praktik/i : undefined;
  const typeLabel = docType === "kp" ? "Kerja Praktik" : capital(docType);
  if (typeWord && !typeWord.test(all)) {
    const others = [["skripsi", /\bskripsi\b/gi], ["proposal", /\bproposal\b/gi], ["kerja praktik", /kerja praktik/gi]] as const;
    const wrong = others.map(([w, re]) => [w, (all.match(re) ?? []).length] as const).filter(([w, n]) => n > 0 && w !== typeLabel.toLowerCase());
    if (wrong.length) {
      const [w, n] = wrong.sort((a, b) => b[1] - a[1])[0];
      const hit = paras.find((p) => new RegExp(`\\b${w}\\b`, "i").test(p.text));
      c.error("KP-06", CAT_KP, `Kata pengantar menyebut "${w}" padahal naskah ini ${typeLabel}`, `Kata "${w}" muncul ${n}× di kata pengantar, sedangkan sampul menyatakan ${typeLabel.toUpperCase()}. Panduan: jika naskah Proposal cantumkan Proposal, jika Skripsi cantumkan Skripsi, jika Kerja Praktik cantumkan Kerja Praktik.`, hit ? locOf(hit, s.label) : loc, { expected: typeLabel, actual: w, fix: `Ganti setiap "${w}" menjadi "${typeLabel.toLowerCase()}" pada kata pengantar.` });
    } else c.warn("KP-06", CAT_KP, "Kata pengantar tidak menyebut jenis naskah", `Kata pengantar harus menyebut jenis naskah sesuai sampul (${typeLabel}).`, loc);
  }
  // thanks order
  const items = paras.filter((p) => /^(\d{1,2})[.)]\s/.test(p.text) || p.hasNumbering);
  let last = 0;
  const seen: number[] = [];
  for (const p of items) {
    const hit = THANKS_RANK.find((r) => r.re.test(p.text));
    if (!hit) continue;
    seen.push(hit.rank);
    if (hit.rank < last) {
      const prevLabel = THANKS_RANK.find((r) => r.rank === last)?.label;
      c.warn("KP-07", CAT_KP, "Urutan ucapan terima kasih tidak sesuai panduan", `"${hit.label}" disebut setelah "${prevLabel}". Urutan: Rektor → Dekan → Koordinator Prodi → (Koordinator KP) → Pembimbing 1 → Pembimbing 2 → (Pembimbing KP) → Penguji 1 → Penguji 2 → Penguji 3 → Seluruh Dosen → Orang tua/Keluarga → Angkatan → Pihak lain.`, locOf(p, s.label), { fold: true });
    }
    last = Math.max(last, hit.rank);
  }
  if (items.length >= 3) {
    for (const [rank, label] of [[1, "Rektor"], [2, "Dekan"], [3, "Koordinator Program Studi"]] as [number, string][]) if (!seen.includes(rank)) c.info("KP-08", CAT_KP, `Ucapan terima kasih kepada ${label} tidak ditemukan`, `Panduan menempatkan ucapan kepada ${label} pada urutan ke-${rank}.`, loc, { fold: true });
  }
  // spacing 1.5 and justify
  const body = paras.filter((p) => p.text.length > 60 && !p.inTable);
  const badSp = body.filter((p) => p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1.5) > 0.1 && (ctx.isPdf ? (p.lineCount ?? 0) >= 2 : true));
  if (badSp.length) c.error("KP-09", CAT_KP, "Line spacing kata pengantar bukan 1,5", `${badSp.length} paragraf menggunakan spacing ${fmtSpacing(badSp[0].lineSpacing)} (panduan: 1,5 dengan Space Before/After dihapus).`, locOf(badSp[0], s.label), { expected: "1,5", actual: fmtSpacing(badSp[0].lineSpacing) });
  const notJust = body.filter((p) => (ctx.isPdf ? p.justified === false : p.align !== "both"));
  if (notJust.length) c.warn("KP-10", CAT_KP, "Paragraf kata pengantar tidak rata kiri-kanan (justify)", `${notJust.length} paragraf tidak justify (Ctrl+J).`, locOf(notJust[0], s.label));
  // closing
  const dateLine = paras.find((p) => /^ternate\s*,/i.test(p.text.trim()));
  if (dateLine && /\bx{2,}\b|\bbulan\b/i.test(dateLine.text)) c.warn("KP-12", CAT_KP, "Tanggal pada kata pengantar belum diisi", `Baris "${dateLine.text}" masih berisi placeholder dari template. Isi dengan tanggal sebenarnya, contoh "Ternate, 15 Juni 2026".`, locOf(dateLine, s.label));
  if (!dateLine && !/ternate,\s*\S+\s+\S+\s+\d{4}/i.test(all)) c.warn("KP-11", CAT_KP, "Baris tempat/tanggal (Ternate, xx bulan 20xx) tidak ditemukan", "Akhiri kata pengantar dengan \"Ternate, xx bulan 20xx\" dan \"Penulis\" rata kanan.", loc);
  if (!/\bpenulis\b\s*$/i.test(all.trim()) && !/\bpenulis\b/i.test(paras.slice(-3).map((p) => p.text).join(" "))) c.warn("KP-11", CAT_KP, 'Kata "Penulis" di akhir kata pengantar tidak ditemukan', 'Akhiri kata pengantar dengan "Penulis" (tanda tangan) rata kanan.', loc);
}

/* ------------------------------------------------------------------ */

interface TocEntry {
  para: Para;
  text: string; // entry title without leaders/page
  page?: string;
  num?: string; // "1.1." etc
}

function parseEntries(paras: Para[]): TocEntry[] {
  const out: TocEntry[] = [];
  for (const p of paras) {
    for (const raw of p.textLines.length ? p.textLines : [p.text]) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line || /^halaman$/i.test(line)) continue;
      const m = line.match(/^(.*?)\s*(?:\.{2,}|…+)\s*([ivxlc]+|\d+)?\s*$/i) ?? line.match(/^(.*?)\s+([ivxlc]+|\d{1,3})$/i);
      let text = line, page: string | undefined;
      if (m) {
        text = m[1].replace(/[\s.]+$/g, "").trim();
        page = m[2];
      }
      if (!text) continue;
      const num = text.match(/^(\d+(?:\.\d+)+\.?)\s/)?.[1];
      out.push({ para: p, text, page, num });
    }
  }
  return out;
}

function daftarIsi(ctx: RuleContext, s: LogicalSection) {
  const { c, docType, doc } = ctx;
  const paras = ctx.parasOf(s);
  const entries = parseEntries(paras);
  const all = paras.map((p) => p.text).join(" \n ").toUpperCase();
  const loc = paras[0] ? locOf(paras[0], s.label) : {};
  if (!entries.length) {
    c.error("TOC-01", CAT_DAFTAR, "Daftar isi kosong / tidak terbaca", "Tidak ada entri yang terbaca pada Daftar Isi.", loc);
    return;
  }
  if (!/\bHALAMAN\b/.test(all)) c.warn("TOC-02", CAT_DAFTAR, 'Kata "Halaman" tidak ditemukan pada Daftar Isi', 'Daftar isi diawali label "Halaman" rata kanan di atas nomor halaman.', loc);
  const need = ["HALAMAN JUDUL", "HALAMAN PENGESAHAN", "KATA PENGANTAR", "DAFTAR ISI", "DAFTAR GAMBAR", "DAFTAR TABEL", "DAFTAR PUSTAKA"];
  if (docType === "skripsi") need.push("PERNYATAAN KEASLIAN", "ABSTRAK");
  const missing = need.filter((n) => !all.includes(n) && !(n === "HALAMAN JUDUL" && /SAMPUL|COVER/.test(all)) && !(n === "HALAMAN PENGESAHAN" && /LEMBAR PENGESAHAN/.test(all)));
  if (missing.length) c.warn("TOC-03", CAT_DAFTAR, "Entri wajib pada Daftar Isi tidak lengkap", `Tidak ditemukan: ${missing.join(", ")}.`, loc);
  // chapters present
  const chapters = ctx.sections.filter((x) => x.kind === "bab");
  for (const ch of chapters) {
    if (!new RegExp(`BAB\\s+${toRoman(ch.chapter ?? 0)}\\b`).test(all)) c.warn("TOC-04", CAT_DAFTAR, `BAB ${toRoman(ch.chapter ?? 0)} tidak tercantum pada Daftar Isi`, `Judul "${ch.label}" ada di naskah tetapi tidak ada di Daftar Isi. Perbarui daftar isi (Update Table).`, loc, { fold: true });
  }
  // numbering format consistency "1.1." vs "1.1"
  const numbered = entries.filter((e) => e.num);
  const withDot = numbered.filter((e) => e.num!.endsWith("."));
  const withoutDot = numbered.filter((e) => !e.num!.endsWith("."));
  if (withoutDot.length && (withDot.length || true))
    c.warn("TOC-05", CAT_DAFTAR, "Penomoran sub bab pada Daftar Isi tidak konsisten / tanpa titik", `Panduan menulis nomor sub bab dengan titik di akhir (contoh "1.1. Judul Sub BAB"). Entri tanpa titik: ${withoutDot.slice(0, 6).map((e) => `"${e.text.slice(0, 40)}"`).join(", ")}${withoutDot.length > 6 ? ", …" : ""}.`, locOf(withoutDot[0].para, s.label, withoutDot[0].text), { expected: "1.1. Judul Sub BAB", actual: withoutDot[0].text.slice(0, 40) });
  // compare with body sub headings
  const headings = subHeadingsInBody(ctx);
  const pageChecks: PageCheck[] = [];
  const tocKeys = new Map<string, TocEntry>();
  for (const e of numbered) tocKeys.set(normNum(e.num!), e);
  for (const h of headings) {
    const key = normNum(h.num);
    const e = tocKeys.get(key);
    if (!e) {
      c.warn("TOC-06", CAT_DAFTAR, "Sub bab pada naskah tidak ada di Daftar Isi", `"${h.para.text.slice(0, 70)}" (${h.label}${h.para.page ? `, hal. ${h.para.page}` : ""}) tidak tercantum di Daftar Isi.`, locOf(h.para, h.label), { fold: true, fix: "Perbarui Daftar Isi (References → Update Table) atau tambahkan entri secara manual." });
      continue;
    }
    const tTitle = e.text.replace(/^\d+(?:\.\d+)+\.?\s*/, "");
    const hTitle = h.title;
    if (similarity(tTitle, hTitle) < 0.6) c.warn("TOC-07", CAT_DAFTAR, "Judul sub bab di Daftar Isi berbeda dengan naskah", `Daftar Isi: "${e.text.slice(0, 60)}" vs naskah: "${h.para.text.slice(0, 60)}".`, locOf(e.para, s.label, e.text), { fold: true });
    // page check (pdf with printed numbers)
    if (e.page && h.para.page !== undefined) {
      const printed = printedPageOf(ctx, h.para);
      const tocPage = parseInt(e.page, 10);
      if (printed !== undefined && Number.isFinite(tocPage)) pageChecks.push({ entry: e, tocPage, printed });
    }
  }
  reportPageMismatches(ctx, s, pageChecks, "Daftar Isi", "TOC-08");
  for (const [key, e] of tocKeys) {
    if (!headings.some((h) => normNum(h.num) === key)) c.warn("TOC-09", CAT_DAFTAR, "Entri Daftar Isi tidak ditemukan pada naskah", `Entri "${e.text.slice(0, 60)}" tidak memiliki sub bab padanan pada isi naskah.`, locOf(e.para, s.label, e.text), { fold: true });
  }
  // spacing
  if (!ctx.isPdf) {
    const bad = paras.filter((p) => p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1.5) > 0.05 && /\.{3,}/.test(p.text));
    if (bad.length) c.warn("TOC-10", CAT_DAFTAR, "Line spacing entri Daftar Isi bukan 1,5", `${bad.length} entri menggunakan spacing ${fmtSpacing(bad[0].lineSpacing)}; panduan 1,5 (judul DAFTAR ISI 2.0).`, locOf(bad[0], s.label));
  } else {
    const multi = paras.filter((p) => (p.lineCount ?? 0) >= 3 && p.lineSpacing !== undefined);
    const bad = multi.filter((p) => Math.abs(p.lineSpacing! - 1.5) > 0.12);
    if (bad.length && bad.length >= multi.length / 2) c.warn("TOC-10", CAT_DAFTAR, "Line spacing entri Daftar Isi bukan 1,5", `Jarak baris entri terukur ≈ ${fmtSpacing(bad[0].lineSpacing)}; panduan 1,5.`, locOf(bad[0], s.label));
  }
}

/** Page number printed on the page holding `p` (pdf: read from the page; docx: estimated). */
function printedPageOf(ctx: RuleContext, p: Para): number | undefined {
  if (ctx.isPdf) return p.page !== undefined ? ctx.doc.pages?.[p.page - 1]?.pageNumber?.value : undefined;
  return p.printedPage;
}

interface PageCheck {
  entry: TocEntry;
  tocPage: number;
  printed: number;
}

function reportPageMismatches(ctx: RuleContext, s: LogicalSection, checks: PageCheck[], listName: string, id: string) {
  const bad = checks.filter((x) => x.tocPage !== x.printed);
  if (!bad.length) return;
  const sevFn = ctx.isPdf ? ctx.c.error.bind(ctx.c) : ctx.c.warn.bind(ctx.c);
  const note = ctx.isPdf ? "" : " (DOCX: nomor halaman naskah diperkirakan dari tata letak terakhir yang disimpan Word; pastikan dengan Update Table.)";
  const diffs = bad.map((x) => x.printed - x.tocPage);
  const freq = new Map<number, number>();
  for (const d of diffs) freq.set(d, (freq.get(d) ?? 0) + 1);
  const [modeDiff, modeCount] = [...freq].sort((a, b) => b[1] - a[1])[0];
  if (bad.length >= 3 && modeCount >= bad.length * 0.6) {
    const first = bad.find((x) => x.printed - x.tocPage === modeDiff)!;
    const rest = bad.filter((x) => x.printed - x.tocPage !== modeDiff);
    sevFn(id, CAT_DAFTAR, `Semua nomor halaman pada ${listName} bergeser ${modeDiff > 0 ? "+" : ""}${modeDiff}`, `${modeCount} dari ${checks.length} entri ${listName} berbeda ${Math.abs(modeDiff)} halaman dari nomor yang tercetak pada naskah (contoh "${first.entry.text.slice(0, 50)}": tercantum ${first.tocPage}, tercetak ${first.printed}). Biasanya karena penomoran halaman BAB I tidak dimulai dari 1 atau ${listName} belum diperbarui.${note}`, locOf(first.entry.para, s.label, first.entry.text), { fix: "Perbaiki penomoran halaman (Start at 1 pada BAB I), lalu References → Update Table → Update entire table." });
    for (const x of rest) sevFn(id, CAT_DAFTAR, `Nomor halaman pada ${listName} tidak sesuai`, `"${x.entry.text.slice(0, 50)}" tercantum halaman ${x.tocPage}, tetapi pada naskah berada di halaman bernomor ${x.printed}.`, locOf(x.entry.para, s.label, x.entry.text), { fold: true });
    return;
  }
  for (const x of bad) sevFn(id, CAT_DAFTAR, `Nomor halaman pada ${listName} tidak sesuai`, `"${x.entry.text.slice(0, 50)}" tercantum halaman ${x.tocPage}, tetapi pada naskah berada di halaman bernomor ${x.printed}.${note}`, locOf(x.entry.para, s.label, x.entry.text), { fold: true, fix: "References → Update Table → Update entire table." });
}

function normNum(n: string): string {
  return n.replace(/\.$/, "");
}

function daftarGambarTabel(ctx: RuleContext, s: LogicalSection, kind: "Gambar" | "Tabel") {
  const { c, doc } = ctx;
  const paras = ctx.parasOf(s);
  const entries = parseEntries(paras).filter((e) => new RegExp(`^${kind}\\s+\\d`, "i").test(e.text));
  const loc = paras[0] ? locOf(paras[0], s.label) : {};
  const all = paras.map((p) => p.text).join(" ").toUpperCase();
  if (!/\bHALAMAN\b/.test(all)) c.warn("LIST-01", CAT_DAFTAR, `Kata "Halaman" tidak ditemukan pada Daftar ${kind}`, `Daftar ${kind} diawali label "Halaman" rata kanan.`, loc);
  const re = new RegExp(`^${kind}\\s+(\\d+)[.,](\\d+)\\.?\\s*(.*)$`, "i");
  const parsed = entries.map((e) => ({ e, m: e.text.match(re) })).filter((x) => x.m) as { e: TocEntry; m: RegExpMatchArray }[];
  // sequence
  const byChapter = new Map<number, number[]>();
  for (const { m } of parsed) {
    const ch = parseInt(m[1], 10), n = parseInt(m[2], 10);
    byChapter.set(ch, [...(byChapter.get(ch) ?? []), n]);
  }
  for (const [ch, nums] of byChapter) {
    const sorted = [...nums].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        c.warn("LIST-02", CAT_DAFTAR, `Penomoran ${kind} BAB ${toRoman(ch)} tidak berurutan`, `Nomor ${kind.toLowerCase()} pada BAB ${toRoman(ch)}: ${nums.map((n) => `${ch}.${n}`).join(", ")}. Penomoran harus berurutan 1, 2, 3, … tanpa lompatan.`, loc, { fold: true });
        break;
      }
    }
  }
  // capitalization of caption words
  for (const { e, m } of parsed) {
    const title = m[3].replace(/\([^)]*\)\s*$/, "").trim();
    const bad = titleCaseViolations(title, { allowLowerConjunctions: true });
    if (bad.length) c.warn("LIST-03", CAT_DAFTAR, `Huruf awal keterangan ${kind.toLowerCase()} harus kapital`, `Pada entri "${e.text.slice(0, 60)}", kata "${bad.slice(0, 4).join('", "')}" harus diawali huruf besar (panduan: huruf awal masing-masing keterangan huruf besar).`, locOf(e.para, s.label, e.text), { fold: true });
  }
  // compare with body captions
  const caps = captionsInBody(ctx).filter((x) => x.kind === kind);
  const pageChecks: PageCheck[] = [];
  const listNums = new Set(parsed.map(({ m }) => `${parseInt(m[1], 10)}.${parseInt(m[2], 10)}`));
  const bodyNums = new Set(caps.map((x) => `${x.chapter}.${x.number}`));
  for (const x of caps) {
    if (!listNums.has(`${x.chapter}.${x.number}`)) c.warn("LIST-04", CAT_DAFTAR, `${kind} pada naskah tidak tercantum di Daftar ${kind}`, `"${x.para.text.slice(0, 70)}"${x.para.page ? ` (hal. ${x.para.page})` : ""} tidak ada di Daftar ${kind}.`, locOf(x.para, x.label), { fold: true });
    else if (x.para.page !== undefined) {
      const entry = parsed.find(({ m }) => `${parseInt(m[1], 10)}.${parseInt(m[2], 10)}` === `${x.chapter}.${x.number}`);
      const printed = printedPageOf(ctx, x.para);
      if (entry?.e.page && printed !== undefined) pageChecks.push({ entry: entry.e, tocPage: parseInt(entry.e.page, 10), printed });
    }
  }
  reportPageMismatches(ctx, s, pageChecks, `Daftar ${kind}`, "LIST-05");
  for (const { e, m } of parsed) {
    if (!bodyNums.has(`${parseInt(m[1], 10)}.${parseInt(m[2], 10)}`)) c.warn("LIST-06", CAT_DAFTAR, `Entri Daftar ${kind} tidak ditemukan pada naskah`, `"${e.text.slice(0, 60)}" tidak memiliki keterangan ${kind.toLowerCase()} padanan di isi naskah.`, locOf(e.para, s.label, e.text), { fold: true });
  }
  if (!parsed.length) c.warn("LIST-07", CAT_DAFTAR, `Daftar ${kind} tidak memiliki entri`, `Tidak ada entri "${kind} X.Y …" yang terbaca.`, loc);
}

/* ------------------------------------------------------------------ */

function abstrak(ctx: RuleContext, s: LogicalSection) {
  const { c } = ctx;
  const paras = ctx.parasOf(s);
  if (!paras.length) return;
  const loc = locOf(paras[0], s.label);
  const title = paras[0];
  const tsize = dominantSize(title);
  if (!isUpperCase(title.text)) c.error("ABS-01", CAT_ABSTRAK, "Judul abstrak harus huruf kapital", `"${title.text.slice(0, 80)}" harus kapital, tebal, 12 pt, rata tengah, maksimal 15 kata.`, loc);
  if (!isMostlyBold(title)) c.warn("ABS-01", CAT_ABSTRAK, "Judul abstrak tidak tebal", "Judul abstrak harus bold.", loc);
  if (tsize !== undefined && Math.abs(tsize - 12) > 0.6) c.warn("ABS-02", CAT_ABSTRAK, "Ukuran font judul abstrak bukan 12 pt", `Terukur ${tsize} pt.`, loc, { expected: "12 pt", actual: `${tsize} pt` });
  if (words(title.text).length > 15) c.warn("ABS-03", CAT_ABSTRAK, `Judul abstrak melebihi 15 kata (${words(title.text).length})`, "Panduan: judul abstrak maksimal 15 kata.", loc);
  if (title.align !== "center") c.warn("ABS-04", CAT_ABSTRAK, "Judul abstrak tidak rata tengah", "Judul abstrak harus rata tengah.", loc);
  if (ctx.coverTitle && similarity(title.text, ctx.coverTitle) < 0.6) c.error("ABS-05", CAT_ABSTRAK, "Judul abstrak berbeda dengan judul sampul", `Abstrak: "${title.text.slice(0, 90)}" ≠ sampul: "${ctx.coverTitle.slice(0, 90)}".`, loc);
  const kkIdx = paras.findIndex((p) => /^kata\s*kunci\s*:/i.test(p.text));
  const body = paras.slice(1, kkIdx > 0 ? kkIdx : undefined).filter((p) => p.text.length > 120);
  const wc = body.reduce((n, p) => n + words(p.text).length, 0);
  if (body.length && (wc < 150 || wc > 250)) c.warn("ABS-06", CAT_ABSTRAK, `Panjang abstrak ${wc} kata`, "Panjang ideal abstrak 150–250 kata.", locOf(body[0], s.label), { expected: "150–250 kata", actual: `${wc} kata` });
  for (const p of body) {
    const sz = dominantSize(p);
    if (sz !== undefined && Math.abs(sz - 11) > 0.6) c.error("ABS-07", CAT_ABSTRAK, "Ukuran font isi abstrak bukan 11 pt", `Isi abstrak terukur ${sz} pt; panduan Arial Narrow 11 pt.`, locOf(p, s.label), { expected: "11 pt", actual: `${sz} pt`, fold: true });
    if (p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1) > 0.1 && (ctx.isPdf ? (p.lineCount ?? 0) >= 2 : true)) c.warn("ABS-08", CAT_ABSTRAK, "Line spacing isi abstrak bukan 1.0", `Terukur ${fmtSpacing(p.lineSpacing)}.`, locOf(p, s.label), { fold: true });
    if (ctx.isPdf ? p.justified === false : p.align !== "both") c.warn("ABS-09", CAT_ABSTRAK, "Isi abstrak tidak rata kiri-kanan", "Isi abstrak harus justify.", locOf(p, s.label), { fold: true });
  }
  if (kkIdx < 0) c.error("ABS-10", CAT_ABSTRAK, '"Kata kunci:" tidak ditemukan', 'Abstrak harus diakhiri baris "Kata kunci: …" (maksimal enam kata, huruf kecil kecuali singkatan, dipisahkan koma, 11 pt).', loc);
  else {
    const kk = paras[kkIdx];
    const list = kk.text.replace(/^kata\s*kunci\s*:/i, "").split(/[,;]/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean);
    if (list.length > 6) c.warn("ABS-11", CAT_ABSTRAK, `Kata kunci lebih dari enam (${list.length})`, "Maksimum enam kata kunci dipisahkan koma.", locOf(kk, s.label));
    const upper = list.filter((k) => /^[A-Z][a-z]/.test(k));
    if (upper.length) c.warn("ABS-12", CAT_ABSTRAK, "Kata kunci diawali huruf kapital", `"${upper.join('", "')}" sebaiknya huruf kecil (kecuali singkatan).`, locOf(kk, s.label));
    const sz = dominantSize(kk);
    if (sz !== undefined && Math.abs(sz - 11) > 0.6) c.warn("ABS-07", CAT_ABSTRAK, "Ukuran font kata kunci bukan 11 pt", `Terukur ${sz} pt.`, locOf(kk, s.label), { fold: true });
  }
  void isMostlyItalic;
}

/* ------------------------------------------------------------------ */

export function toRoman(num: number): string {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (num >= v) (out += s), (num -= v);
  return out || String(num);
}
function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
