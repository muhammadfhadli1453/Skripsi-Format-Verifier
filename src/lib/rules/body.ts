import type { RuleContext } from "./context";
import type { LogicalSection, Para } from "../model";
import { cmToPt, ptToCm } from "../model";
import { toRoman } from "./frontmatter";
import { FOREIGN_TERMS } from "./foreign";
import { dominantSize, fmtSpacing, isMostlyBold, isUpperCase, locOf, snippet, titleCaseViolations, words } from "./util";

const CAT_BAB = "Judul BAB & Sub BAB";
const CAT_PARA = "Paragraf Isi";
const CAT_TEXT = "Tanda Baca & Sitasi";
const CAT_CAPTION = "Gambar & Tabel";
const CAT_LANG = "Istilah Asing";

export interface SubHeading {
  para: Para;
  num: string; // "1.1." or "1.1"
  parts: number[];
  title: string;
  label: string;
  chapter: number;
}
export interface Caption {
  para: Para;
  kind: "Gambar" | "Tabel";
  chapter: number;
  number: number;
  title: string;
  label: string;
}

const SUB_RE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?(\.)?\s+(\S.*)$/;
const CAPTION_RE = /^(Gambar|Tabel)\s+(\d{1,2})[.,](\d{1,2})\.?\s*(.*)$/i;
const LIST_RE = /^(\d{1,2}[.)]|[a-zA-Z][.)]|[-•–])\s+\S/;
const LIST_MARKER = /^(\d{1,2}[.)]|[a-zA-Z][.)]|[-•–])\s+/;

function isSubHeading(p: Para): RegExpMatchArray | null {
  if (p.inTable) return null;
  const m = p.text.match(SUB_RE);
  if (!m) return null;
  const title = m[6];
  if (words(title).length > 14) return null;
  if (/[.:;,]$/.test(title.trim()) && !/\.\)$/.test(title)) return null; // sentences end with punctuation; headings don't
  if (/\.{3,}/.test(title)) return null;
  if ((p.lineCount ?? 1) > 2) return null;
  return m;
}

export function subHeadingsInBody(ctx: RuleContext): SubHeading[] {
  const out: SubHeading[] = [];
  for (const s of ctx.sections) {
    if (s.kind !== "bab") continue;
    for (const p of ctx.parasOf(s)) {
      const m = isSubHeading(p);
      if (!m) continue;
      const parts = [m[1], m[2], m[3], m[4]].filter(Boolean).map((x) => parseInt(x, 10));
      out.push({ para: p, num: parts.join(".") + (m[5] ?? ""), parts, title: m[6].trim(), label: s.label, chapter: s.chapter ?? 0 });
    }
  }
  return out;
}

export function captionsInBody(ctx: RuleContext): Caption[] {
  const out: Caption[] = [];
  for (const s of ctx.sections) {
    if (s.kind !== "bab" && s.kind !== "lampiran") continue;
    for (const p of ctx.parasOf(s)) {
      const m = p.text.match(CAPTION_RE);
      if (!m) continue;
      if (/\.{3,}/.test(p.text)) continue;
      if (words(p.text).length > 30) continue; // a sentence starting with "Gambar 2.1 menunjukkan ..."
      if (/^(Gambar|Tabel)\s+\d+[.,]\d+\.?\s+(di\s?atas|di\s?bawah|berikut|tersebut|menunjukkan|menjelaskan|menggambarkan|memperlihatkan|merupakan|adalah|dapat|yang|ini|pada|dengan|untuk|dari|dan|juga|sampai|hingga)\b/i.test(p.text)) continue;
      if (p.align !== "center" && words(p.text).length > 14 && /[.]\s+[A-Z]/.test(p.text)) continue; // multi-sentence text, not a caption
      out.push({ para: p, kind: m[1].toLowerCase() === "gambar" ? "Gambar" : "Tabel", chapter: parseInt(m[2], 10), number: parseInt(m[3], 10), title: m[4].trim(), label: s.label });
    }
  }
  return out;
}

export function bodyRules(ctx: RuleContext) {
  const { c, doc, docType } = ctx;
  const chapters = ctx.sections.filter((s) => s.kind === "bab");

  /* ---------- BAB headings ---------- */
  const expectedTitles: Record<number, RegExp> = {
    1: /PENDAHULUAN/,
    2: /TINJAUAN PUSTAKA|LANDASAN TEORI|KAJIAN (PUSTAKA|TEORI)/,
    3: /METOD(E|OLOGI) PENELITIAN|METODE/,
    4: /HASIL DAN PEMBAHASAN|HASIL/,
    5: /PENUTUP|KESIMPULAN/,
  };
  let prevChapter = 0;
  for (const s of chapters) {
    const h = doc.paras[s.headingParaIndex!];
    const num = s.chapter ?? 0;
    if (num !== prevChapter + 1) c.error("BAB-01", CAT_BAB, `Penomoran BAB tidak berurutan (BAB ${toRoman(num)} setelah BAB ${toRoman(prevChapter)})`, "BAB harus bernomor berurutan I, II, III, …", locOf(h, s.label));
    prevChapter = Math.max(prevChapter, num);
    if (!/^BAB\s+[IVX]+/.test(h.text.trim().toUpperCase())) c.warn("BAB-02", CAT_BAB, "Nomor BAB harus angka Romawi", `"${h.text}" — gunakan "BAB ${toRoman(num)}".`, locOf(h, s.label));
    const size = dominantSize(h);
    if (size !== undefined && Math.abs(size - 14) > 0.6) c.error("BAB-03", CAT_BAB, "Ukuran font judul BAB bukan 14 pt", `"${h.text}" berukuran ${size} pt; panduan 14 pt.`, locOf(h, s.label), { expected: "14 pt", actual: `${size} pt`, fold: true });
    if (!isMostlyBold(h)) c.warn("BAB-04", CAT_BAB, "Judul BAB tidak tebal", `"${h.text}" harus bold.`, locOf(h, s.label), { fold: true });
    if (h.align !== "center") c.error("BAB-05", CAT_BAB, "Judul BAB tidak rata tengah", `"${h.text}" harus rata tengah (Ctrl+E).`, locOf(h, s.label), { fold: true });
    else if (!ctx.isPdf && centerShiftPt(h) > 4) c.warn("BAB-05", CAT_BAB, "Judul BAB bergeser dari tengah karena indentasi", `"${h.text}" memakai Center tetapi masih memiliki indentasi kiri/baris pertama.`, locOf(h, s.label), { fix: "Paragraph → Indentation: Left 0, Special: (none).", fold: true });
    // title line
    const titlePara = findTitlePara(ctx, s);
    if (titlePara) {
      if (!isUpperCase(titlePara.text)) c.error("BAB-06", CAT_BAB, "Judul BAB harus huruf kapital", `"${titlePara.text}" harus kapital, misalnya "${titlePara.text.toUpperCase()}".`, locOf(titlePara, s.label), { fold: true });
      const ts = dominantSize(titlePara);
      if (ts !== undefined && Math.abs(ts - 14) > 0.6) c.error("BAB-03", CAT_BAB, "Ukuran font judul BAB bukan 14 pt", `"${titlePara.text}" berukuran ${ts} pt; panduan 14 pt.`, locOf(titlePara, s.label), { fold: true });
      if (titlePara.align !== "center") c.error("BAB-05", CAT_BAB, "Judul BAB tidak rata tengah", `"${titlePara.text}" harus rata tengah.`, locOf(titlePara, s.label), { fold: true });
      if (!isMostlyBold(titlePara)) c.warn("BAB-04", CAT_BAB, "Judul BAB tidak tebal", `"${titlePara.text}" harus bold.`, locOf(titlePara, s.label), { fold: true });
      const exp = expectedTitles[num];
      if (exp && !exp.test(titlePara.text.toUpperCase()) && (docType === "proposal" || docType === "skripsi")) c.info("BAB-07", CAT_BAB, `Judul BAB ${toRoman(num)} tidak lazim`, `Judul "${titlePara.text}"; panduan: ${["", "PENDAHULUAN", "TINJAUAN PUSTAKA", "METODE PENELITIAN", "HASIL DAN PEMBAHASAN", "PENUTUP"][num] ?? "-"}.`, locOf(titlePara, s.label));
      if (!ctx.isPdf && titlePara.lineSpacing !== undefined && Math.abs(titlePara.lineSpacing - 2) > 0.05) c.warn("BAB-08", CAT_BAB, "Line spacing judul BAB bukan 2.0", `"${titlePara.text}" menggunakan ${fmtSpacing(titlePara.lineSpacing)}; panduan 2.0.`, locOf(titlePara, s.label), { fold: true });
    } else c.error("BAB-06", CAT_BAB, "Judul BAB tidak ditemukan", `Setelah "${h.text}" harus ada baris judul BAB (kapital, 14 pt, rata tengah).`, locOf(h, s.label));
    if (!ctx.isPdf && h.lineSpacing !== undefined && Math.abs(h.lineSpacing - 2) > 0.05) c.warn("BAB-08", CAT_BAB, "Line spacing judul BAB bukan 2.0", `"${h.text}" menggunakan ${fmtSpacing(h.lineSpacing)}; panduan 2.0.`, locOf(h, s.label), { fold: true });
    // new page
    if (ctx.isPdf) {
      const pg = doc.pages?.[(h.page ?? 1) - 1];
      if (pg && pg.firstParaIndex !== h.index) {
        const before = doc.paras.slice(pg.firstParaIndex, h.index).filter((p) => !p.isEmpty);
        if (before.length) c.error("BAB-09", CAT_BAB, "BAB tidak dimulai pada halaman baru", `"${h.text}" berada di tengah halaman ${h.page}; setiap BAB harus dimulai di halaman baru (Page Break / Section Break).`, locOf(h, s.label), { fold: true });
      }
    } else {
      const prev = [...doc.paras.slice(0, h.index)].reverse().find((p) => !p.isEmpty);
      const sec = doc.sections.find((x) => x.firstParaIndex <= h.index && h.index <= x.lastParaIndex);
      const startsSection = sec && doc.paras.slice(sec.firstParaIndex, h.index).every((p) => p.isEmpty);
      if (prev && !h.pageBreakBefore && !startsSection && prev.page === h.page) c.error("BAB-09", CAT_BAB, "BAB tidak dimulai pada halaman baru", `"${h.text}" tidak diawali Page Break / Section Break (Next Page). Gunakan Section Break agar penomoran halaman BAB dapat diatur.`, locOf(h, s.label), { fold: true });
    }
  }

  /* ---------- sub headings ---------- */
  const subs = subHeadingsInBody(ctx);
  const perChapter = new Map<number, SubHeading[]>();
  for (const sh of subs) perChapter.set(sh.chapter, [...(perChapter.get(sh.chapter) ?? []), sh]);
  const withDot = subs.filter((s) => s.num.endsWith(".")).length;
  const withoutDot = subs.filter((s) => !s.num.endsWith("."));
  if (withoutDot.length) c.warn("SUB-01", CAT_BAB, "Nomor sub bab tanpa titik di akhir", `Panduan menulis "1.1. Judul Sub BAB" (titik setelah nomor). ${withoutDot.length} judul tanpa titik${withDot ? ` (sementara ${withDot} lainnya memakai titik — tidak konsisten)` : ""}, contoh: "${withoutDot[0].para.text.slice(0, 50)}".`, locOf(withoutDot[0].para, withoutDot[0].label), { expected: "1.1. Judul Sub BAB", actual: withoutDot[0].para.text.slice(0, 40), fold: true });
  for (const sh of withoutDot.slice(1, 25)) c.add({ id: "SUB-01", severity: "warning", category: CAT_BAB, title: "Nomor sub bab tanpa titik di akhir", detail: "", location: locOf(sh.para, sh.label), foldKey: "SUB-01::Nomor sub bab tanpa titik di akhir" });
  for (const [chapter, list] of perChapter) {
    const expectedLevel2 = new Map<string, number>(); // parent -> next expected
    for (const sh of list) {
      if (sh.parts[0] !== chapter) c.error("SUB-02", CAT_BAB, "Nomor sub bab tidak sesuai nomor BAB", `"${sh.para.text.slice(0, 60)}" berada di BAB ${toRoman(chapter)} tetapi diawali angka ${sh.parts[0]}.`, locOf(sh.para, sh.label), { fold: true });
      const parentKey = sh.parts.slice(0, -1).join(".");
      const exp = expectedLevel2.get(parentKey) ?? 1;
      const last = sh.parts[sh.parts.length - 1];
      if (last !== exp) c.error("SUB-03", CAT_BAB, "Penomoran sub bab tidak berurutan", `"${sh.para.text.slice(0, 60)}" — diharapkan nomor ${parentKey}.${exp}.`, locOf(sh.para, sh.label), { fold: true });
      expectedLevel2.set(parentKey, Math.max(exp, last) + 1);
      // reset deeper levels
      for (const k of [...expectedLevel2.keys()]) if (k.startsWith(sh.parts.join(".") + ".")) expectedLevel2.delete(k);
      if (!isMostlyBold(sh.para, 0.6)) c.warn("SUB-04", CAT_BAB, "Judul sub bab tidak tebal", `"${sh.para.text.slice(0, 60)}" harus bold.`, locOf(sh.para, sh.label), { fold: true });
      const sz = dominantSize(sh.para);
      if (sz !== undefined && Math.abs(sz - 12) > 0.6) c.error("SUB-05", CAT_BAB, "Ukuran font judul sub bab bukan 12 pt", `"${sh.para.text.slice(0, 60)}" berukuran ${sz} pt.`, locOf(sh.para, sh.label), { fold: true });
      if (sh.para.align === "center") c.warn("SUB-06", CAT_BAB, "Judul sub bab rata tengah", `"${sh.para.text.slice(0, 60)}" harus rata kiri pada margin.`, locOf(sh.para, sh.label), { fold: true });
      const bad = titleCaseViolations(sh.title, { allowLowerConjunctions: true });
      if (bad.length) c.warn("SUB-07", CAT_BAB, "Huruf awal kata pada judul sub bab tidak kapital", `Pada "${sh.para.text.slice(0, 60)}", kata "${bad.slice(0, 4).join('", "')}" sebaiknya diawali huruf kapital.`, locOf(sh.para, sh.label), { fold: true });
    }
    // minimal two
    const level2 = list.filter((s) => s.parts.length === 2);
    if (level2.length === 1) c.warn("SUB-08", CAT_BAB, `BAB ${toRoman(chapter)} hanya memiliki satu sub bab`, "Penomoran sub bab minimal dua (1.1. dan 1.2.).", locOf(level2[0].para, level2[0].label));
    const byParent = new Map<string, SubHeading[]>();
    for (const s of list.filter((x) => x.parts.length >= 3)) byParent.set(s.parts.slice(0, -1).join("."), [...(byParent.get(s.parts.slice(0, -1).join(".")) ?? []), s]);
    for (const [parent, kids] of byParent) if (kids.length === 1) c.warn("SUB-08", CAT_BAB, `Sub bab ${parent} hanya memiliki satu anak sub bab`, `Anak sub bab minimal dua (${parent}.1. dan ${parent}.2.).`, locOf(kids[0].para, kids[0].label), { fold: true });
  }

  /* ---------- body paragraphs ---------- */
  const captions = captionsInBody(ctx);
  const captionIdx = new Set(captions.map((x) => x.para.index));
  const subIdx = new Set(subs.map((x) => x.para.index));
  const headingIdx = new Set(chapters.flatMap((s) => [s.headingParaIndex!, findTitlePara(ctx, s)?.index ?? -1]));
  const isLast = (p: Para) => ctx.isPdf && doc.pages?.[(p.page ?? 1) - 1]?.lastParaIndex === p.index;
  const nextNonEmpty = (p: Para) => doc.paras.slice(p.index + 1).find((x) => !x.isEmpty);
  const body: { p: Para; s: LogicalSection }[] = [];
  for (const s of chapters) {
    for (const p of ctx.parasOf(s)) {
      if (p.inTable || captionIdx.has(p.index) || subIdx.has(p.index) || headingIdx.has(p.index)) continue;
      if (p.images.length) continue;
      if (/\(\d+\.\d+\)\s*$/.test(p.text)) continue; // equation
      if (/[=≈±×÷∑√≤≥]/.test(p.text) && /\d/.test(p.text) && p.text.length < 220) continue; // worked calculation
      if (LIST_RE.test(p.text)) continue;
      if (p.text.length < 40) continue;
      if ((p.firstLineIndent ?? 0) > cmToPt(3)) continue; // table/figure fragments, not body paragraphs
      if (p.runs.some((r) => r.font === "Cambria Math") && p.text.length < 120) continue;
      body.push({ p, s });
    }
  }
  const sizes = body.map(({ p }) => dominantSize(p)).filter((x): x is number => x !== undefined);
  for (const { p, s } of body) {
    const sz = dominantSize(p);
    if (sz !== undefined && Math.abs(sz - 12) > 0.6) c.error("PARA-01", CAT_PARA, "Ukuran font paragraf isi bukan 12 pt", `Paragraf "${snippet(p.text, 60)}" berukuran ${sz} pt; panduan Arial Narrow 12 pt.`, locOf(p, s.label), { expected: "12 pt", actual: `${sz} pt`, fold: true });
    const measurable = ctx.isPdf ? (p.lineCount ?? 0) >= 2 : true;
    if (measurable && p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 2) > 0.12) c.error("PARA-02", CAT_PARA, "Line spacing paragraf isi bukan 2.0", `Paragraf "${snippet(p.text, 60)}" menggunakan spacing ${fmtSpacing(p.lineSpacing)}; panduan 2.0 dengan Space Before/After dihapus.`, locOf(p, s.label), { expected: "2.0", actual: fmtSpacing(p.lineSpacing), fold: true });
    const notJustified = ctx.isPdf ? p.justified === false && (p.lineCount ?? 0) >= 2 : p.align !== "both";
    if (notJustified) c.warn("PARA-03", CAT_PARA, "Paragraf isi tidak rata kiri-kanan (justify)", `Paragraf "${snippet(p.text, 60)}" tidak justify (Ctrl+J).`, locOf(p, s.label), { fold: true });
    // end punctuation
    const t = p.text.trim();
    if (!isLast(p) && /[A-Za-z0-9]$/.test(t) && !(nextNonEmpty(p)?.text ?? "").match(/^[a-z]/) && !/^[a-z]/.test(t) && (p.lineCount ?? 1) >= 1) {
      c.warn("TEXT-01", CAT_TEXT, "Kalimat tidak diakhiri tanda baca", `Paragraf "…${t.slice(-50)}" tidak diakhiri titik.`, locOf(p, s.label, snippet(t.slice(-80))), { fold: true });
    }
  }
  // indentation consistency
  const indents = body.map(({ p }) => Math.round((p.firstLineIndent ?? 0) / 2) * 2).filter((x) => x >= 0);
  if (indents.length >= 5) {
    const freq = new Map<number, number>();
    for (const i of indents) freq.set(i, (freq.get(i) ?? 0) + 1);
    const mode = [...freq].sort((a, b) => b[1] - a[1])[0][0];
    const deviants = body.filter(({ p }) => Math.abs((p.firstLineIndent ?? 0) - mode) > 5 && (p.lineCount ?? 2) >= 2);
    if (deviants.length && deviants.length < body.length * 0.5) {
      // one issue per distinct indent value so the title matches every listed location
      const byValue = new Map<string, typeof deviants>();
      const bucket = (pt: number) => {
        const cmv = ptToCm(Math.max(0, pt));
        for (const known of [0, 1, 1.27, 1.5, 2]) if (Math.abs(cmv - known) <= 0.06) return known.toFixed(2);
        return (Math.round(cmv * 4) / 4).toFixed(2);
      };
      for (const d of deviants) {
        const k = bucket(d.p.firstLineIndent ?? 0);
        byValue.set(k, [...(byValue.get(k) ?? []), d]);
      }
      for (const [cmVal, list] of byValue) {
        const d0 = list[0];
        const title = `Indentasi baris pertama ${cmVal} cm (mayoritas ${ptToCm(mode).toFixed(2)} cm)`;
        c.warn("PARA-04", CAT_PARA, title, `${list.length} paragraf menjorok ${cmVal} cm, sedangkan mayoritas paragraf isi ${ptToCm(mode).toFixed(2)} cm. Indentasi harus konsisten. Contoh: "${snippet(d0.p.text, 60)}".${cmVal === "1.27" ? " Nilai 1,27 cm biasanya berasal dari tombol Tab tanpa tab stop khusus." : ""}`, locOf(d0.p, d0.s.label), { expected: `${ptToCm(mode).toFixed(2)} cm (konsisten)`, actual: `${cmVal} cm`, fix: "Hapus Tab di awal paragraf dan atur Paragraph → Indentation → Special: First line sebesar nilai yang konsisten.", fold: true });
        for (const d of list.slice(1, 25)) c.add({ id: "PARA-04", severity: "warning", category: CAT_PARA, title, detail: "", location: locOf(d.p, d.s.label), foldKey: `PARA-04::${title}` });
      }
    }
    if (Math.abs(mode - cmToPt(1)) > 5 && mode > 0) c.info("PARA-05", CAT_PARA, `Indentasi paragraf umumnya ${ptToCm(mode).toFixed(2)} cm`, "Contoh pada panduan menggunakan indentasi baris pertama sekitar 1 cm. Samakan dengan arahan pembimbing.", {});
    if (mode === 0) c.warn("PARA-05", CAT_PARA, "Paragraf isi tidak menjorok (first line indent 0)", "Pada contoh panduan, baris pertama paragraf isi menjorok ± 1 cm.", locOf(body[0].p, body[0].s.label));
  }
  void sizes;

  /* ---------- punctuation & citations (all bab paragraphs) ---------- */
  for (const s of chapters) {
    for (const p of ctx.parasOf(s)) {
      if (p.inTable) continue;
      const t = proseText(p);
      // space before punctuation
      for (const m of t.matchAll(/\S\s+([,.;:!?])(?=\s|$)/g)) {
        const ctxStr = t.slice(Math.max(0, (m.index ?? 0) - 25), (m.index ?? 0) + 30);
        if (/\d\s+[.,]\s*\d/.test(ctxStr)) continue;
        const legend = m[1] === ":" && t.length < 70; // "S : Node saat ini" (keterangan rumus)
        c.add({ id: "TEXT-02", severity: legend ? "warning" : "error", category: CAT_TEXT, title: `Spasi sebelum tanda baca "${m[1]}"`, detail: `"…${ctxStr}…" — tanda baca (${m[1]}) tidak boleh didahului spasi (contoh salah pada panduan: "seperti ini :").`, location: locOf(p, s.label, snippet(ctxStr, 80)) }, { fold: true });
      }
      if (/\(\s+\S|\S\s+\)/.test(t)) c.warn("TEXT-03", CAT_TEXT, "Spasi di dalam tanda kurung", `"${snippet(t.match(/.{0,20}(\(\s+\S|\S\s+\)).{0,20}/)?.[0] ?? t, 70)}" — tidak ada spasi setelah "(" atau sebelum ")".`, locOf(p, s.label), { fold: true });
      // missing space after comma/semicolon
      for (const m of t.matchAll(/[,;](?=[A-Za-z])/g)) {
        const ctxStr = t.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 25);
        if (/https?:|www\.|@|\d,\d/.test(ctxStr)) continue;
        c.warn("TEXT-04", CAT_TEXT, "Tidak ada spasi setelah koma/titik koma", `"…${ctxStr}…".`, locOf(p, s.label, snippet(ctxStr, 70)), { fold: true });
      }
      if (!ctx.isPdf && /\S {2,}\S/.test(t)) c.info("TEXT-05", CAT_TEXT, "Spasi ganda di dalam teks", `"${snippet(t.match(/.{0,20}\S {2,}\S.{0,20}/)?.[0] ?? t, 60)}".`, locOf(p, s.label), { fold: true });
      // citations
      for (const m of t.matchAll(/\(([^()]{2,80}?)\s*[.,]\s*,\s*((?:19|20)\d{2})[a-z]?\)/g)) {
        if (/\b(et al|dkk)\s*\.\s*,\s*(?:19|20)\d{2}[a-z]?\)$/i.test(m[0])) continue; // "(Nama et al., 2025)" is correct
        c.error("TEXT-06", CAT_TEXT, "Format sitasi tidak sesuai", `"${m[0]}" — tulis "(Nama, ${m[2]})" tanpa titik/koma ganda sebelum tahun.`, locOf(p, s.label, m[0]), { fold: true });
      }
      for (const m of t.matchAll(/\(([^()]{2,80}?)\s+((?:19|20)\d{2})[a-z]?\)/g)) {
        if (/,\s*$/.test(m[1]) || /\bet al\.?$|\bdkk\.?$/i.test(m[1])) continue;
        if (/\d$/.test(m[1])) continue;
        c.warn("TEXT-06", CAT_TEXT, "Format sitasi tidak sesuai", `"${m[0]}" — nama dan tahun dipisahkan koma: "(${m[1].trim()}, ${m[2]})".`, locOf(p, s.label, m[0]), { fold: true });
      }
      for (const m of t.matchAll(/[A-Za-z]\.\s+(\([^()]{2,80}?,\s*(?:19|20)\d{2}[a-z]?\))\s*\.?/g)) {
        if (/^[A-Z]/.test(t.slice((m.index ?? 0) + m[0].length).trim()) || (m.index ?? 0) + m[0].length >= t.length - 1) {
          c.warn("TEXT-07", CAT_TEXT, "Titik ditempatkan sebelum sitasi", `"…${t.slice(Math.max(0, (m.index ?? 0) - 15), (m.index ?? 0) + m[0].length + 2)}" — titik akhir kalimat ditulis setelah sitasi: "… ${m[1]}."`, locOf(p, s.label, m[0]), { fold: true });
        }
      }
      // list items
      if (LIST_RE.test(t) && !isLast(p) && !isSubHeading(p)) {
        const isSentence = words(t.replace(LIST_MARKER, "")).length >= 5; // "1. Cleaning" is a label, not a sentence
        if (isSentence && /[A-Za-z0-9)]$/.test(t) && !/^[a-z]/.test(nextNonEmpty(p)?.text ?? "")) c.warn("TEXT-08", CAT_TEXT, "Poin/daftar tidak diakhiri tanda baca", `"${snippet(t, 70)}" — setiap poin diakhiri titik (atau titik koma/koma bila berupa rangkaian).`, locOf(p, s.label), { fold: true });
        if (ctx.isPdf && (p.lineCount ?? 1) >= 2 && (p.hangingIndent === undefined || p.hangingIndent < 8)) c.warn("TEXT-09", CAT_TEXT, "Teks lanjutan poin tidak sejajar", `Baris kedua poin "${snippet(t, 50)}" tidak sejajar dengan awal teks poin (gunakan hanging indent ± 1 cm).`, locOf(p, s.label), { fold: true });
        if (!ctx.isPdf && !p.hasNumbering && !(p.hangingIndent && p.hangingIndent > 8)) c.warn("TEXT-09", CAT_TEXT, "Poin tanpa hanging indent", `"${snippet(t, 50)}" — gunakan penomoran otomatis atau hanging indent agar baris lanjutan sejajar.`, locOf(p, s.label), { fold: true });
      }
    }
  }

  /* ---------- captions ---------- */
  const bodyText = chapters.flatMap((s) => ctx.parasOf(s)).filter((p) => !captionIdx.has(p.index)).map((p) => p.text).join(" \n ").toLowerCase();
  const seq = new Map<string, number[]>();
  for (const cap of captions) {
    const key = `${cap.kind}-${cap.chapter}`;
    seq.set(key, [...(seq.get(key) ?? []), cap.number]);
    const sec = ctx.sectionOf(cap.para.index);
    if (sec?.kind === "bab" && sec.chapter !== cap.chapter) c.error("CAP-01", CAT_CAPTION, `Nomor ${cap.kind.toLowerCase()} tidak sesuai nomor BAB`, `"${snippet(cap.para.text, 60)}" berada di BAB ${toRoman(sec.chapter ?? 0)} tetapi bernomor ${cap.chapter}.${cap.number}.`, locOf(cap.para, cap.label), { fold: true });
    if (cap.para.align !== "center") c.error("CAP-02", CAT_CAPTION, `Keterangan ${cap.kind.toLowerCase()} tidak rata tengah`, `"${snippet(cap.para.text, 60)}" harus rata tengah (Ctrl+E).`, locOf(cap.para, cap.label), { fold: true });
    else if (!ctx.isPdf && centerShiftPt(cap.para) > 4) c.error("CAP-02", CAT_CAPTION, `Keterangan ${cap.kind.toLowerCase()} rata tengah tetapi bergeser karena indentasi`, `"${snippet(cap.para.text, 60)}" memakai Center, namun masih memiliki indentasi (kiri ${ptToCm(cap.para.leftIndent ?? 0).toFixed(2)} cm, baris pertama ${ptToCm(cap.para.firstLineIndent ?? 0).toFixed(2)} cm) sehingga posisinya tidak tepat di tengah.`, locOf(cap.para, cap.label), { fix: "Paragraph → Indentation: Left 0, Special: (none), lalu Ctrl+E.", fold: true });
    const bad = titleCaseViolations(cap.title.replace(/\([^)]*\)\s*$/, ""), { allowLowerConjunctions: true });
    if (bad.length) c.warn("CAP-03", CAT_CAPTION, `Huruf awal kata pada keterangan ${cap.kind.toLowerCase()} tidak kapital`, `"${snippet(cap.para.text, 60)}" — kata "${bad.slice(0, 4).join('", "')}" sebaiknya diawali huruf kapital.`, locOf(cap.para, cap.label), { fold: true });
    const ref = new RegExp(`\\b${cap.kind.toLowerCase()}\\s+${cap.chapter}[.,]${cap.number}\\b(?![.,]\\d)`);
    if (!ref.test(bodyText)) c.warn("CAP-04", CAT_CAPTION, `${cap.kind} ${cap.chapter}.${cap.number} tidak dirujuk dalam teks`, `Tidak ada kalimat yang merujuk "${cap.kind.toLowerCase()} ${cap.chapter}.${cap.number}" (contoh: "… dapat dilihat pada ${cap.kind.toLowerCase()} ${cap.chapter}.${cap.number}.").`, locOf(cap.para, cap.label), { fold: true });
    const sz = dominantSize(cap.para);
    if (sz !== undefined && Math.abs(sz - 12) > 0.6) c.warn("CAP-05", CAT_CAPTION, `Ukuran font keterangan ${cap.kind.toLowerCase()} bukan 12 pt`, `"${snippet(cap.para.text, 50)}" berukuran ${sz} pt.`, locOf(cap.para, cap.label), { fold: true });
    // position
    if (cap.kind === "Gambar") {
      if (ctx.isPdf) {
        if (!cap.para.images.length) c.warn("CAP-06", CAT_CAPTION, "Keterangan gambar tidak tepat di bawah gambar", `Tidak terdeteksi gambar tepat di atas "${snippet(cap.para.text, 50)}" (hal. ${cap.para.page}). Keterangan gambar harus berada tepat di bawah gambar, rata tengah. (Gambar berupa vektor/shape mungkin tidak terdeteksi.)`, locOf(cap.para, cap.label), { fold: true });
      } else {
        const prev = [...doc.paras.slice(0, cap.para.index)].reverse().find((p) => !p.isEmpty || p.images.length);
        if (!prev?.images.length) c.warn("CAP-06", CAT_CAPTION, "Keterangan gambar tidak tepat di bawah gambar", `Paragraf sebelum "${snippet(cap.para.text, 50)}" bukan gambar. Keterangan gambar harus tepat di bawah gambar.`, locOf(cap.para, cap.label), { fold: true });
      }
    } else if (!ctx.isPdf) {
      const tbl = doc.tables.find((t) => {
        const between = doc.paras.slice(cap.para.index + 1, t.prevParaIndex + 1);
        return t.prevParaIndex >= cap.para.index && between.every((p) => p.isEmpty);
      });
      if (!tbl) c.error("CAP-07", CAT_CAPTION, "Keterangan tabel tidak tepat di atas tabel", `"${snippet(cap.para.text, 50)}" tidak diikuti tabel. Keterangan tabel ditulis tepat di atas tabel, rata tengah.`, locOf(cap.para, cap.label), { fold: true });
    }
  }
  for (const [key, nums] of seq) {
    const [kind, ch] = key.split("-");
    const sorted = [...nums].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) {
      c.warn("CAP-08", CAT_CAPTION, `Penomoran ${kind.toLowerCase()} BAB ${toRoman(parseInt(ch, 10))} tidak berurutan`, `Ditemukan ${kind} ${nums.map((n) => `${ch}.${n}`).join(", ")}; penomoran harus 1, 2, 3, … berurutan.`, {}, { fold: true });
      break;
    }
  }
  // figures without caption / oversized / not centered
  for (const s of chapters) {
    for (const p of doc.paras.slice(s.firstParaIndex, s.lastParaIndex + 1)) {
      if (!p.images.length || p.inTable) continue;
      if (ctx.isPdf) continue; // in pdf images are attached to the caption paragraph itself
      const next = doc.paras.slice(p.index + 1).find((x) => !x.isEmpty);
      if (!next || !CAPTION_RE.test(next.text) || !/^Gambar/i.test(next.text)) c.warn("CAP-09", CAT_CAPTION, "Gambar tanpa keterangan", `Gambar pada ${s.label}${p.page ? ` (± hal. ${p.page})` : ""} tidak diikuti keterangan "Gambar X.Y …".`, locOf(p, s.label, next?.text ?? ""), { fold: true });
      if (p.align !== "center") c.warn("CAP-10", CAT_CAPTION, "Gambar tidak rata tengah", `Paragraf gambar pada ${s.label} tidak rata tengah.`, locOf(p, s.label), { fold: true });
      for (const img of p.images) if (img.widthCm > 14.2) c.error("CAP-11", CAT_CAPTION, "Lebar gambar melebihi lebar area teks (14 cm)", `Gambar selebar ${img.widthCm.toFixed(1)} cm pada ${s.label}.`, locOf(p, s.label), { fold: true });
    }
  }
  if (ctx.isPdf) {
    for (const pg of doc.pages ?? []) {
      for (const img of pg.images) {
        const sec = ctx.sectionOf(pg.firstParaIndex);
        if (!sec || sec.kind !== "bab") continue;
        if (img.widthCm > 14.4) c.error("CAP-11", CAT_CAPTION, "Lebar gambar melebihi lebar area teks (14 cm)", `Gambar selebar ${img.widthCm.toFixed(1)} cm pada hal. ${pg.number}.`, { page: pg.number, section: sec.label }, { fold: true });
        const cx = img.bbox!.x + img.bbox!.w / 2;
        const tc = pg.textBounds ? (pg.textBounds.x0 + pg.textBounds.x1) / 2 : pg.width / 2;
        if (img.widthCm > 2 && Math.abs(cx - tc) > 12 && Math.abs(cx - pg.width / 2) > 12) c.warn("CAP-10", CAT_CAPTION, "Gambar tidak rata tengah", `Gambar pada hal. ${pg.number} bergeser ${ptToCm(cx - tc).toFixed(1)} cm dari tengah area teks.`, { page: pg.number, section: sec.label }, { fold: true });
      }
    }
  }
  // tables (docx)
  if (!ctx.isPdf) {
    for (const t of doc.tables) {
      const sec = ctx.sectionOf(Math.max(0, t.prevParaIndex));
      if (!sec || sec.kind !== "bab") continue;
      const prev = [...doc.paras.slice(0, t.prevParaIndex + 1)].reverse().find((p) => !p.isEmpty);
      if (!prev || !/^Tabel\s+\d/i.test(prev.text)) c.error("CAP-12", CAT_CAPTION, "Tabel tanpa keterangan di atasnya", `Tabel pada ${sec.label} tidak diawali keterangan "Tabel X.Y …" rata tengah.`, prev ? locOf(prev, sec.label) : {}, { fold: true });
      const cells = t.cellParaIndexes.map((i) => doc.paras[i]).filter((p) => !p.isEmpty);
      const badSp = cells.filter((p) => p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1) > 0.05);
      if (badSp.length) c.warn("CAP-13", CAT_CAPTION, "Line spacing isi tabel bukan 1.0", `${badSp.length} sel pada tabel di ${sec.label} menggunakan spacing ${fmtSpacing(badSp[0].lineSpacing)}; panduan 1.0.`, locOf(badSp[0], sec.label), { fold: true });
      const badAfter = cells.filter((p) => (p.spaceAfter ?? 0) > 0.5 || (p.spaceBefore ?? 0) > 0.5);
      if (badAfter.length) c.warn("CAP-15", CAT_CAPTION, "Isi tabel masih memiliki Space Before/After", `${badAfter.length} sel pada tabel di ${sec.label} memiliki spasi sebelum/sesudah paragraf (contoh ${badAfter[0].spaceAfter ?? 0} pt sesudah). Isi tabel memakai spasi 1.0 tanpa tambahan spasi paragraf.`, locOf(badAfter[0], sec.label), { fix: "Blok seluruh tabel → Layout → Spacing Before/After = 0, Line spacing Single.", fold: true });
    }
  }
  // jadwal penelitian
  // tolerate common misspellings ("Jawal Penelitian") so the schedule table is still recognised
  const jadwal = captions.filter((x) => /\bjad?wal\s+(penelitian|kegiatan)|tabel\s+penelitian/i.test(x.para.text));
  if (docType === "skripsi" && jadwal.length) c.warn("CAP-14", CAT_CAPTION, "Tabel jadwal penelitian masih ada pada naskah skripsi", "Tabel penelitian (jadwal) dihapus bila sudah pada tahap penyusunan skripsi.", locOf(jadwal[0].para, jadwal[0].label));
  if (docType === "proposal" && !jadwal.length && chapters.some((s) => s.chapter === 3)) c.info("CAP-14", CAT_CAPTION, "Tabel jadwal penelitian tidak ditemukan", "Proposal harus menjelaskan waktu penelitian secara detail dalam tabel jadwal penelitian pada BAB III.", {});

  /* ---------- sistematika penulisan ---------- */
  const sis = subs.find((s) => /sistematika/i.test(s.title));
  if (sis) {
    const next = subs.find((s) => s.para.index > sis.para.index);
    const range = doc.paras.slice(sis.para.index + 1, next ? next.para.index : sis.para.index + 40).map((p) => p.text).join(" ").toUpperCase();
    const maxBab = docType === "proposal" ? 3 : docType === "skripsi" ? 5 : 0;
    if (maxBab) {
      for (let n = 1; n <= maxBab; n++) if (!new RegExp(`BAB\\s+${toRoman(n)}\\b`).test(range)) c.warn("SIS-01", CAT_BAB, `Sistematika penulisan tidak menyebut BAB ${toRoman(n)}`, `Pada ${docType}, sistematika penulisan mencakup BAB I sampai BAB ${toRoman(maxBab)}.`, locOf(sis.para, sis.label), { fold: true });
      for (let n = maxBab + 1; n <= 5; n++) if (new RegExp(`BAB\\s+${toRoman(n)}\\b`).test(range)) c.warn("SIS-02", CAT_BAB, `Sistematika penulisan menyebut BAB ${toRoman(n)}`, `Pada proposal, sistematika dibatasi hingga BAB III Metodologi Penelitian.`, locOf(sis.para, sis.label), { fold: true });
    }
  }

  /* ---------- foreign terms not italic ---------- */
  let hits = 0;
  const seenTerms = new Map<string, number>();
  for (const s of chapters) {
    for (const p of ctx.parasOf(s)) {
      if (/https?:|www\./i.test(p.text)) continue;
      for (const r of p.runs) {
        if (r.italic) continue;
        const lower = r.text.toLowerCase();
        for (const term of FOREIGN_TERMS) {
          if (!lower.includes(term)) continue;
          if (!new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower)) continue;
          // skip when the same term appears italic elsewhere in this paragraph (partial split across runs)
          if (p.runs.some((o) => o.italic && o.text.toLowerCase().includes(term))) continue;
          const n = (seenTerms.get(term) ?? 0) + 1;
          seenTerms.set(term, n);
          hits++;
          if (n <= 3) c.warn("LANG-01", CAT_LANG, `Istilah asing "${term}" tidak dimiringkan`, `"${snippet(r.text, 70)}" (${s.label}${p.page ? `, hal. ${p.page}` : ""}). Hanya istilah asing yang dimiringkan (italic), huruf awal saja yang kapital bila di judul.`, locOf(p, s.label, snippet(r.text, 70)), { fold: true, foldKey: `LANG-01::${term}` });
        }
      }
    }
  }
  if (hits > 0) c.info("LANG-02", CAT_LANG, `Total ${hits} kemunculan istilah asing tanpa italic (${seenTerms.size} istilah berbeda)`, `Istilah: ${[...seenTerms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t} (${n}×)`).join(", ")}. Pemeriksaan berbasis daftar kata; aktifkan pemeriksaan AI untuk cakupan lebih luas.`, {});
}

/** Paragraph text with equation runs replaced by a placeholder, for prose-only punctuation checks. */
export function proseText(p: Para): string {
  if (!p.runs.some((r) => r.font === "Cambria Math")) return p.text;
  return p.runs
    .map((r) => (r.font === "Cambria Math" ? "∎" : r.text))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/∎(\s*∎)+/g, "∎")
    .trim();
}

/** Horizontal shift (pt) of a centred single-line paragraph caused by left/first-line indentation. */
export function centerShiftPt(p: Para): number {
  return Math.abs((p.leftIndent ?? 0) + (p.firstLineIndent ?? 0)) / 2;
}

export function findTitlePara(ctx: RuleContext, s: LogicalSection): Para | undefined {
  const h = ctx.doc.paras[s.headingParaIndex!];
  if (/^BAB\s+[IVXLC\d]+\s*[.:\-–]?\s+\S/i.test(h.text)) return h; // title on same line
  for (let i = h.index + 1; i < Math.min(ctx.doc.paras.length, h.index + 4); i++) {
    const p = ctx.doc.paras[i];
    if (!p.isEmpty) return p;
  }
  return undefined;
}
