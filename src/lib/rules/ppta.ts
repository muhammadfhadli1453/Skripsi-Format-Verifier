/**
 * Rules from the university-wide guideline:
 *   reference/official format.pdf — Panduan Penulisan Tugas Akhir (PPTA) Universitas Khairun, Nov 2023.
 *
 * Precedence: the PPTA is the latest guideline and wins wherever it governs the same document (S1 proposal or
 * skripsi). The Prodi Informatika format still applies where the PPTA is silent (typography, margins, cover
 * layout, page-number positions) and for Kerja Praktik, which the PPTA does not cover. Rules here are additions;
 * conflicting rules were changed in place in the other rule files (search for "PPTA").
 */
import type { RuleContext } from "./context";
import { captionsInBody, proseText, subHeadingsInBody } from "./body";
import { TITLE_LOWERCASE, locOf, snippet, words } from "./util";
import { toRoman } from "./frontmatter";

const BASIS = { basis: "ppta" as const };
const CAT_CITE = "Sitasi (PPTA)";
const CAT_REF = "Daftar Pustaka (PPTA)";
const CAT_SPELL = "Ejaan (PPTA)";
const CAT_NUM = "Angka & Satuan (PPTA)";
const CAT_CAP = "Gambar & Tabel";
const CAT_ABS = "Abstrak";
const CAT_STRUCT = "Struktur Dokumen";
const CAT_BAB = "Judul BAB & Sub BAB";

/** PPTA Tabel 4.1 "Contoh kesalahan pengejaan/penulisan kata" (+ same-category forms noted in comments). */
const SPELLING: [RegExp, string, string][] = [
  [/\baktip\b|\baktiv\b/gi, "aktif", "ejaan"],
  [/\baktifitas\b/gi, "aktivitas", "ejaan"],
  [/\bjadual\b/gi, "jadwal", "ejaan"],
  [/\bkementrian\b/gi, "kementerian", "ejaan"],
  [/\bkwalitas\b/gi, "kualitas", "ejaan"],
  [/\bnafas\b/gi, "napas", "ejaan"],
  [/\bpropinsi\b/gi, "provinsi", "ejaan"],
  [/\bmil(i)?yar\b/gi, "miliar", "ejaan"],
  [/\bantar kota\b/gi, "antarkota", "unsur terikat ditulis serangkai"],
  [/\banti virus\b/gi, "antivirus", "unsur terikat ditulis serangkai"],
  [/\bmulti strata\b/gi, "multistrata", "unsur terikat ditulis serangkai"],
  [/\bnon verbal\b/gi, "nonverbal", "unsur terikat ditulis serangkai"],
  [/\bpasca sarjana\b/gi, "pascasarjana", "unsur terikat ditulis serangkai"],
  [/\bsub bab\b/gi, "subbab", "unsur terikat ditulis serangkai"],
  [/\bbudidaya\b/gi, "budi daya", "gabungan kata ditulis terpisah"],
  [/\bkerjasama\b/gi, "kerja sama", "gabungan kata ditulis terpisah"],
  [/\blipatganda\b/gi, "lipat ganda", "gabungan kata ditulis terpisah"],
  [/\bsumberdaya\b/gi, "sumber daya", "gabungan kata ditulis terpisah"],
  [/\btandatangan\b/gi, "tanda tangan", "gabungan kata ditulis terpisah"],
  [/\btanggungjawab\b/gi, "tanggung jawab", "gabungan kata ditulis terpisah"],
  [/\bterimakasih\b/gi, "terima kasih", "gabungan kata ditulis terpisah"],
  [/\bmengkalibrasi\b/gi, "mengalibrasi", "peluluhan k/p/s/t"],
  [/\bmengkombinasikan\b/gi, "mengombinasikan", "peluluhan k/p/s/t"],
  [/\bmempamerkan\b/gi, "memamerkan", "peluluhan k/p/s/t"],
  [/\bmempengaruhi\b/gi, "memengaruhi", "peluluhan k/p/s/t"],
  [/\bmempublikasikan\b/gi, "memublikasikan", "peluluhan k/p/s/t"],
  [/\bmensambungkan\b/gi, "menyambungkan", "peluluhan k/p/s/t"],
  [/\bmensosialisasikan\b/gi, "menyosialisasikan", "peluluhan k/p/s/t"],
  [/\bmentaati\b/gi, "menaati", "peluluhan k/p/s/t"],
  [/\bmentargetkan\b/gi, "menargetkan", "peluluhan k/p/s/t"],
  [/\bpengkikisan\b/gi, "pengikisan", "peluluhan k/p/s/t"],
  [/\bpempupukan\b/gi, "pemupukan", "peluluhan k/p/s/t"],
  [/\bpensaluran\b/gi, "penyaluran", "peluluhan k/p/s/t"],
  [/\bpentaksiran\b/gi, "penaksiran", "peluluhan k/p/s/t"],
  [/\bmensahkan\b/gi, "mengesahkan", "kata dasar satu suku kata"],
  [/\bpensahan\b/gi, "pengesahan", "kata dasar satu suku kata"],
  [/\bpencatan\b/gi, "pengecatan", "kata dasar satu suku kata"],
  [/\bmerubah\b/gi, "mengubah", "kata dasar ubah, bukan rubah"],
  [/\bdirubah\b/gi, "diubah", "kata dasar ubah, bukan rubah"],
  [/\bmenyuci\b/gi, "mencuci", "kekeliruan kata dasar"],
  [/\bmenyampurkan\b/gi, "mencampurkan", "kekeliruan kata dasar"],
  [/\bmenyicipi\b/gi, "mencicipi", "kekeliruan kata dasar"],
  [/\banalisa\b/gi, "analisis", "ejaan mengikuti bahasa Inggris, bukan Belanda"],
  [/\bfotosintesa\b/gi, "fotosintesis", "ejaan mengikuti bahasa Inggris, bukan Belanda"],
  [/\bkomplex\b|\bkomplek\b/gi, "kompleks", "huruf x pada kata serapan"],
  [/\btaxonomi\b/gi, "taksonomi", "huruf x pada kata serapan"],
  [/\bamuba\b/gi, "ameba", "bentuk baku"],
  [/\batmosfir\b/gi, "atmosfer", "bentuk baku"],
  [/\bstandarisasi\b/gi, "standardisasi", "bentuk baku"],
  [/\bvaritas\b/gi, "varietas", "bentuk baku"],
  [/\bdi (ambil|dasari|lakukan|katakan|gunakan|jelaskan|tentukan|peroleh|hitung|buat)\b/gi, "di$1", "awalan di- ditulis serangkai"],
  [/\bdiantaranya\b/gi, "di antaranya", "kata depan di/ke ditulis terpisah"],
  [/\bdidalam\b/gi, "di dalam", "kata depan di/ke ditulis terpisah"],
  [/\bdidasar\b/gi, "di dasar", "kata depan di/ke ditulis terpisah"],
  [/\bdilapangan\b/gi, "di lapangan", "kata depan di/ke ditulis terpisah"],
  [/\bdisamping itu\b/gi, "di samping itu", "kata depan di/ke ditulis terpisah"],
  [/\bkedalam\b/gi, "ke dalam", "kata depan di/ke ditulis terpisah"],
  [/\bkelaboratorium\b/gi, "ke laboratorium", "kata depan di/ke ditulis terpisah"],
  // same category as the table's "didalam, didasar" (kata depan di + kata tempat)
  [/\bdiatas\b/gi, "di atas", "kata depan di/ke ditulis terpisah"],
  [/\bdibawah\b/gi, "di bawah", "kata depan di/ke ditulis terpisah"],
];

export function pptaRules(ctx: RuleContext) {
  const { c, doc, docType } = ctx;
  const chapters = ctx.sections.filter((s) => s.kind === "bab");
  const bodyParas = chapters.flatMap((s) => ctx.parasOf(s).map((p) => ({ p, s })));
  const nowYear = new Date().getFullYear();

  /* ---------------- spelling (PPTA Tabel 4.1) ---------------- */
  const spellScope = ctx.sections.filter((s) => s.kind !== "daftar-pustaka" && s.kind !== "cover" && s.kind !== "lampiran");
  for (const s of spellScope) {
    for (const p of ctx.parasOf(s)) {
      if (p.inTable) continue; // table cells often quote other authors' titles
      if (ctx.isPdf && words(p.text).length < 6) continue; // likely an undetected table-cell fragment
      // only non-italic text: italic marks foreign words, which keep their own spelling
      const plain = p.runs.filter((r) => !r.italic && r.font !== "Cambria Math").map((r) => r.text).join("");
      if (!plain) continue;
      for (const [re, right, why] of SPELLING) {
        re.lastIndex = 0;
        for (const m of plain.matchAll(re)) {
          const wrong = m[0];
          const fix = right.includes("$1") ? right.replace("$1", (m[1] ?? "").toLowerCase()) : right;
          const key = wrong.toLowerCase();
          const at = m.index ?? 0;
          // fold every occurrence under one issue per word
          c.add({ id: "SPELL-01", severity: "warning", category: CAT_SPELL, title: `Penulisan tidak baku: "${key}" → "${fix}"`, detail: `${why[0].toUpperCase()}${why.slice(1)} (PPTA Tabel 4.1). Ditemukan "…${plain.slice(Math.max(0, at - 30), at + wrong.length + 30).replace(/\s+/g, " ").trim()}…".`, expected: fix, actual: wrong, fix: `Ganti "${wrong}" menjadi "${fix}" (Ctrl+H untuk mengganti semua).`, location: locOf(p, s.label, snippet(plain.slice(Math.max(0, at - 30), at + wrong.length + 30))), ...BASIS }, { fold: true });
        }
      }
    }
  }

  /* ---------------- citations (PPTA 7.1.3) ---------------- */
  for (const { p, s } of bodyParas) {
    if (p.inTable) continue;
    const t = proseText(p);
    // et al. must be italic
    if (/\bet\s+al\b/.test(t)) {
      const nonItalic = p.runs.some((r) => !r.italic && /\bet\s+al\b/.test(r.text));
      if (nonItalic) c.warn("CITE-01", CAT_CITE, '"et al." harus ditulis miring', `Pada "${snippet(t.match(/.{0,40}\bet\s+al\.?.{0,15}/)?.[0] ?? t, 70)}", "et al." tidak italic. PPTA 7.1.3: "et al.," ditulis miring, dengan titik dan koma sebelum tahun.`, locOf(p, s.label), { fix: 'Blok "et al." lalu Ctrl+I (atau atur gaya sitasi Mendeley agar et al. italic).', fold: true, ...BASIS });
    }
    for (const m of t.matchAll(/\(([^()]{3,200}?(?:19|20)\d{2}[a-z]?)\)/g)) {
      const inner = m[1];
      // two authors joined by "&" in Indonesian text
      if (/[A-Za-z]\s*&\s*[A-Z]/.test(inner)) c.warn("CITE-02", CAT_CITE, 'Dua penulis dihubungkan dengan "&"', `"${m[0]}" — untuk teks berbahasa Indonesia gunakan kata hubung "dan", contoh "(Ramili dan Umasangaji, 2022)" (PPTA 7.1.3 g).`, locOf(p, s.label, m[0]), { fix: 'Ganti "&" dengan "dan" (atur gaya sitasi Mendeley/Zotero berbahasa Indonesia).', fold: true, ...BASIS });
      // several sources in one bracket: chronological order
      if (inner.includes(";")) {
        const years = inner.split(";").map((x) => parseInt(x.match(/((?:19|20)\d{2})/)?.[1] ?? "0", 10)).filter(Boolean);
        if (years.some((y, i) => i > 0 && y < years[i - 1])) c.warn("CITE-03", CAT_CITE, "Urutan beberapa sumber dalam satu sitasi tidak kronologis", `"${m[0]}" — beberapa sumber ditulis berurutan dari terbitan paling lama ke paling baru, dipisahkan titik koma (PPTA 7.1.3 j).`, locOf(p, s.label, m[0]), { fold: true, ...BASIS });
      }
    }
    // separate brackets side by side: "(A, 2020), (B, 2021)" or "(A, 2020) (B, 2021)"
    const multi = t.match(/\([^()]{3,80}?(?:19|20)\d{2}[a-z]?\)\s*,?\s*\([^()]{3,80}?(?:19|20)\d{2}[a-z]?\)/);
    if (multi) c.warn("CITE-04", CAT_CITE, "Beberapa sumber ditulis dalam kurung terpisah", `"${snippet(multi[0], 80)}" — gabungkan dalam satu kurung dengan pemisah titik koma, urut tahun terbit: "(Douglas, 2009; Alogi, 2010)" (PPTA 7.1.3 j).`, locOf(p, s.label, snippet(multi[0], 80)), { fold: true, ...BASIS });
  }

  /* ---------------- numbers & units (PPTA 5.1, 5.2) ---------------- */
  for (const { p, s } of bodyParas) {
    if (p.inTable || p.runs.every((r) => r.font === "Cambria Math")) continue;
    const t = proseText(p);
    if (/^(Gambar|Tabel)\s+\d/.test(t) || /^\d+(\.\d+)+\.?\s/.test(t)) continue; // captions, sub-headings
    // decimal point instead of comma: 0.87, 96.5%
    for (const m of t.matchAll(/(?<![\w.,])(0\.\d+|\d{1,3}\.\d+\s?%)(?![\w.])/g)) {
      const fixed = m[1].replace(".", ",");
      c.warn("NUM-01", CAT_NUM, "Tanda desimal memakai titik", `"${m[1]}" — dalam bahasa Indonesia tanda desimal adalah koma: "${fixed}" (PPTA 5.1 d).`, locOf(p, s.label, snippet(t.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30))), { expected: fixed, actual: m[1], fold: true, ...BASIS });
    }
    // number glued to its unit: 64GB, 27cm
    for (const m of t.matchAll(/\b(\d+(?:[.,]\d+)?)(cm|mm|km|kg|mg|ml|mL|GB|MB|KB|TB|GHz|MHz|kHz|Hz|ms|kV|mAh|Mbps|kbps)\b/g)) {
      c.warn("NUM-02", CAT_NUM, "Angka dan satuan tidak diberi spasi", `"${m[0]}" — tulis "${m[1]} ${m[2]}" (PPTA 5.2 c: angka dan satuannya diberi spasi).`, locOf(p, s.label, m[0]), { expected: `${m[1]} ${m[2]}`, actual: m[0], fold: true, ...BASIS });
    }
    // sentence starting with a digit
    const pdfTableRow = ctx.isPdf && /^\d{1,2}\s+[A-Z]/.test(t); // "5 Bagus untuk …" = numbered row of an undetected table
    if (!/^(\d{1,2}[.)]|[a-z][.)])\s/.test(t) && !pdfTableRow) {
      for (const m of t.matchAll(/(?:^|[.!?]\s+)(\d[\d.,]*)\s+[A-Za-z]/g)) {
        if (/^\d+\.\d/.test(m[1])) continue; // "2.1 ..." references
        const before = t.slice(0, m.index ?? 0).match(/(\S+)$/)?.[1] ?? "";
        if (/^(No|Vol|Hal|hlm|dkk|al|dll|dsb|Dr|Ir|Prof|St|Jl|Kec|Kab|vs|Ed|Tbk|[A-Z])$/i.test(before)) continue; // "No. 88", "Vol. 3
        c.warn("NUM-03", CAT_NUM, "Kalimat diawali angka", `"${snippet(t.slice(m.index ?? 0, (m.index ?? 0) + 60), 60)}" — awal kalimat tidak boleh dimulai dengan angka; ubah susunan kalimat atau tulis angkanya dengan huruf (PPTA 5.1 h).`, locOf(p, s.label), { fold: true, ...BASIS });
      }
    }
  }

  /* ---------------- captions (PPTA 6.1.1, 6.2; Prodi body examples agree) ---------------- */
  for (const cap of captionsInBody(ctx)) {
    const t = cap.para.text.trim();
    const numDot = t.match(/^(Gambar|Tabel)\s+(\d+[.,]\d+)\./i);
    if (numDot) c.warn("CAP-16", CAT_CAP, `Nomor ${cap.kind.toLowerCase()} diakhiri titik`, `"${snippet(t, 60)}" — tulis "${cap.kind} ${numDot[2]} ${cap.title}" tanpa titik setelah nomor (PPTA 6.1.1 a.2 dan 6.2; contoh pada format prodi juga "Tabel 2.1 Keterangan Tabel").`, locOf(cap.para, cap.label), { expected: `${cap.kind} ${numDot[2]} …`, actual: `${cap.kind} ${numDot[2]}. …`, fold: true, basis: "keduanya" });
    const endsWithDot = /\.\s*$/.test(t) && !/\b(et al|dkk)\.\)?\s*$/.test(t) && words(cap.title).length <= 15;
    if (endsWithDot) c.warn("CAP-17", CAT_CAP, `Judul ${cap.kind.toLowerCase()} diakhiri tanda titik`, `"${snippet(t, 60)}" — judul ${cap.kind.toLowerCase()} tidak diakhiri titik, kecuali ada kalimat keterangan tambahan (PPTA 6.1.1 a.6 dan 6.2).`, locOf(cap.para, cap.label), { fold: true, ...BASIS });
  }

  /* ---------------- sub-chapter titles (PPTA 4.2.1.2) ---------------- */
  for (const sh of subHeadingsInBody(ctx)) {
    const capConj = words(sh.title).filter((w, i) => i > 0 && TITLE_LOWERCASE.has(w.toLowerCase()) && /^[A-Z][a-z]/.test(w));
    if (capConj.length) c.warn("SUB-09", CAT_BAB, "Kata penghubung pada judul subbab ditulis kapital", `"${snippet(sh.para.text, 60)}" — kata "${[...new Set(capConj)].join('", "')}" ditulis huruf kecil; setiap kata judul bab/subbab diawali kapital kecuali kata penghubung (PPTA 4.2.1.2, contoh "Alat dan Bahan").`, locOf(sh.para, sh.label), { fold: true, ...BASIS });
  }

  /* ---------------- BAB V: Simpulan dan Saran (PPTA 3.2.6; Prodi Daftar Isi 5.1/5.2) ---------------- */
  const penutup = chapters.find((s) => s.chapter === 5 || /PENUTUP/.test(s.chapterTitle ?? ""));
  if (penutup && docType === "skripsi") {
    const subs = subHeadingsInBody(ctx).filter((x) => x.chapter === penutup.chapter);
    const hasSimpulan = subs.some((x) => /\b(ke)?simpulan\b/i.test(x.title));
    const hasSaran = subs.some((x) => /\bsaran\b/i.test(x.title));
    const h = doc.paras[penutup.headingParaIndex!];
    if (!hasSimpulan || !hasSaran) c.warn("STRUCT-05", CAT_STRUCT, `${penutup.label} tidak memuat subbab ${[!hasSimpulan && "Kesimpulan", !hasSaran && "Saran"].filter(Boolean).join(" dan ")}`, `Bab penutup terdiri atas Simpulan dan Saran (PPTA 3.2.6; format prodi: 5.1 Kesimpulan, 5.2 Saran).`, locOf(h, penutup.label), { basis: "keduanya" });
  }

  /* ---------------- literature review ≤ 10% of main pages (PPTA 3.2) ---------------- */
  if (docType === "skripsi" && chapters.length >= 4) {
    const tp = chapters.find((s) => /TINJAUAN|LANDASAN|KAJIAN|KERANGKA/.test(s.chapterTitle ?? ""));
    const first = chapters[0], last = chapters[chapters.length - 1];
    const pages = (s: typeof first) => (s.lastPage ?? s.firstPage ?? 0) - (s.firstPage ?? 0) + 1;
    if (tp && first.firstPage && last.lastPage) {
      const total = last.lastPage - first.firstPage + 1;
      const share = pages(tp) / total;
      if (share > 0.1) c.warn("STRUCT-04", CAT_STRUCT, `${tp.label} ${Math.round(share * 100)}% dari bagian utama`, `${tp.label} ± ${pages(tp)} dari ${total} halaman bagian utama (${Math.round(share * 100)}%). PPTA 3.2: tinjauan pustaka/landasan teori boleh ditambahkan dengan ketentuan jumlah halamannya tidak melebihi 10% dari total halaman bagian utama.${ctx.isPdf ? "" : " (DOCX: halaman diperkirakan.)"}`, locOf(doc.paras[tp.headingParaIndex!], tp.label), { expected: "≤ 10%", actual: `${Math.round(share * 100)}%`, ...BASIS });
    }
  }

  /* ---------------- abstract (PPTA 3.1.4) ---------------- */
  const abs = ctx.sections.find((s) => s.kind === "abstrak");
  if (abs) {
    const paras = ctx.parasOf(abs);
    const kk = paras.find((p) => /^kata\s*kunci\s*:/i.test(p.text)); // keyword count/order: see frontmatter abstrak()
    for (const p of paras) {
      if (p === kk) continue;
      const cite = p.text.match(/\([^()]{2,60}(?:19|20)\d{2}[a-z]?\)|\b(Gambar|Tabel)\s+\d+[.,]\d+/);
      if (cite) c.warn("ABS-13", CAT_ABS, "Abstrak merujuk pustaka, gambar, atau tabel", `"${cite[0]}" — abstrak tidak boleh merujuk pada pustaka, gambar, atau tabel (PPTA 3.1.4).`, locOf(p, abs.label, cite[0]), { fold: true, ...BASIS });
    }
    if (docType === "skripsi" && !ctx.sections.some((s) => s.kind === "abstract")) c.warn("ABS-15", CAT_ABS, "Abstract (bahasa Inggris) tidak ditemukan", "PPTA 3.1.4: Abstrak dan Abstract ditulis untuk skripsi dalam bahasa Indonesia dan bahasa Inggris, diletakkan dalam satu halaman untuk kedua bahasa.", locOf(paras[0] ?? doc.paras[abs.headingParaIndex!], abs.label), { ...BASIS });
  }

  /* ---------------- references (PPTA 7, 7.3) ---------------- */
  const dp = ctx.sections.find((s) => s.kind === "daftar-pustaka");
  if (dp) {
    const entries = ctx.parasOf(dp).filter((p) => p.text.length > 20 && !p.inTable);
    const years = entries.map((p) => ({ p, year: parseInt(p.text.match(/\b((?:19|20)\d{2})[a-z]?\b/)?.[1] ?? "0", 10) })).filter((x) => x.year);
    const minYear = nowYear - 10;
    const old = years.filter((x) => x.year < minYear);
    for (const x of old) c.add({ id: "REF-09", severity: "warning", category: CAT_REF, title: `Referensi lebih dari 10 tahun (sebelum ${minYear})`, detail: `"${snippet(x.p.text, 70)}" terbit ${x.year}. PPTA 7.3: tugas akhir menggunakan referensi terbaru maksimal 10 tahun terakhir (kecuali sumber klasik yang memang diperlukan).`, location: locOf(x.p, dp.label), basis: "ppta" }, { fold: true });
    const minRefs = 20;
    if (entries.length < minRefs) {
      const sev = docType === "skripsi" ? "warning" : "info";
      c.add({ id: "REF-10", severity: sev, category: CAT_REF, title: `Jumlah referensi ${entries.length} (minimal ${minRefs})`, detail: `PPTA 7.3: tugas akhir minimal ${minRefs} referensi, 20% di antaranya dari internal UNKHAIR dan 10% merujuk tulisan pembimbing atau penguji.`, expected: `≥ ${minRefs}`, actual: String(entries.length), location: entries[0] ? locOf(entries[0], dp.label) : {}, basis: "ppta" });
    }
    for (const p of entries) if (/wikipedia/i.test(p.text)) c.warn("REF-11", CAT_REF, "Wikipedia digunakan sebagai referensi", `"${snippet(p.text, 70)}" — Wikipedia termasuk sumber yang tidak dapat dipercaya karena dapat disunting siapa pun (PPTA BAB VII).`, locOf(p, dp.label), { fold: true, ...BASIS });
  }
  void toRoman;
}
