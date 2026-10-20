import type { RuleContext } from "./context";
import { cmToPt } from "../model";
import { isArialNarrow, MATH_FONT_FAMILIES } from "../parse/fonts";
import { fmtCm, locOf, snippet, fmtSpacing } from "./util";

const CAT = "Tata Letak & Tipografi";
const A4 = { w: 595.3, h: 841.9 };
const MARGIN_COVER = { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 };
const MARGIN_BODY = { top: 4, right: 3, bottom: 3, left: 4 };

export function layoutRules(ctx: RuleContext) {
  const { doc, c } = ctx;

  /* ---------- paper size ---------- */
  const badPages: string[] = [];
  const landscape: number[] = [];
  if (ctx.isPdf) {
    for (const pg of doc.pages ?? []) {
      if (Math.abs(pg.width - A4.h) <= 4 && Math.abs(pg.height - A4.w) <= 4) {
        landscape.push(pg.number);
        continue;
      }
      if (Math.abs(pg.width - A4.w) > 4 || Math.abs(pg.height - A4.h) > 4) badPages.push(`hal. ${pg.number} (${fmtCm(pg.width, 1)} × ${fmtCm(pg.height, 1)})`);
    }
    if (landscape.length) c.info("LAYOUT-06", CAT, `Halaman landscape: ${landscape.join(", ")}`, "Halaman dengan orientasi landscape ditemukan. Pastikan penggunaannya memang diperlukan (tabel/gambar lebar) dan nomor halaman tetap konsisten.", { page: landscape[0] });
  } else {
    for (const s of doc.sections) if (Math.abs(s.pageWidth - A4.w) > 4 || Math.abs(s.pageHeight - A4.h) > 4) badPages.push(`section ${s.index + 1} (${fmtCm(s.pageWidth, 1)} × ${fmtCm(s.pageHeight, 1)})`);
  }
  if (badPages.length)
    c.error("LAYOUT-01", CAT, "Ukuran kertas bukan A4", `Ukuran kertas harus A4 (21 × 29,7 cm). Ditemukan ukuran lain pada: ${badPages.slice(0, 8).join(", ")}${badPages.length > 8 ? ", …" : ""}.`, {}, {
      expected: "A4 (21 × 29,7 cm)",
      actual: badPages[0],
      fix: "Layout → Size → A4 untuk seluruh section.",
    });

  /* ---------- margins ---------- */
  if (!ctx.isPdf) {
    for (const s of doc.sections) {
      if (!s.margins) continue;
      const first = doc.paras.slice(s.firstParaIndex, s.lastParaIndex + 1).find((p) => !p.isEmpty);
      const sec = first ? ctx.sectionOf(first.index) : undefined;
      const kind = sec?.kind ?? "unknown";
      const isCoverLike = kind === "cover" || kind === "pengesahan" || (kind === "unknown" && s.index <= 1);
      const exp = isCoverLike ? MARGIN_COVER : MARGIN_BODY;
      const diffs: string[] = [];
      for (const side of ["top", "left", "right", "bottom"] as const) {
        const actualCm = s.margins[side] / 28.3465;
        if (Math.abs(actualCm - exp[side]) > 0.12) diffs.push(`${sideLabel(side)} ${actualCm.toFixed(2)} cm (seharusnya ${exp[side]} cm)`);
      }
      const onlyTemplateBottom = isCoverLike && diffs.length === 1 && Math.abs(s.margins.bottom / 28.3465 - 2.0) < 0.06;
      if (onlyTemplateBottom) {
        c.warn("LAYOUT-02", CAT, `Margin bawah ${sec?.label ?? "sampul"} 2,00 cm (bukan 2,54 cm)`, "Teks panduan menetapkan margin Normal 2,54 cm untuk semua sisi. File template sampul pada panduan memang memakai margin bawah 2,00 cm, jadi nilai ini kemungkinan terbawa dari template. Konfirmasi dengan pembimbing.", first ? locOf(first, sec?.label) : {}, { expected: "2,54 cm", actual: "2,00 cm" });
        continue;
      }
      if (diffs.length)
        c.error("LAYOUT-02", CAT, `Margin section ${s.index + 1} (${sec?.label ?? "?"}) tidak sesuai`, `Margin pada section ini: ${diffs.join("; ")}.`, first ? locOf(first, sec?.label) : {}, {
          expected: isCoverLike ? "Normal: atas/kiri/bawah/kanan 2,54 cm (sampul & lembar pengesahan)" : "Atas 4 cm, kiri 4 cm, kanan 3 cm, bawah 3 cm",
          actual: diffs.join("; "),
          fix: "Layout → Margins → Custom Margins, terapkan pada section ini (Apply to: This section).",
        });
    }
  } else {
    // estimate from text bounds on body pages
    const tooLeft: number[] = [];
    const tooRight: number[] = [];
    const tooHigh: number[] = [];
    const tooLow: number[] = [];
    const leftActual: number[] = [];
    for (const pg of doc.pages ?? []) {
      if (!pg.textBounds) continue;
      const first = doc.paras[pg.firstParaIndex];
      const sec = first ? ctx.sectionOf(first.index) : undefined;
      const kind = sec?.kind;
      if (!kind || kind === "cover" || kind === "pengesahan" || kind === "unknown" || kind === "lampiran") continue;
      const pageParas = doc.paras.slice(pg.firstParaIndex, pg.lastParaIndex + 1);
      if (pageParas.length < 2) continue;
      if (pageParas.filter((p) => p.inTable).length > pageParas.length / 2) continue;
      const left = pg.textBounds.x0;
      const right = pg.width - pg.textBounds.x1;
      const top = pg.textBounds.yTop;
      const bottom = pg.height - pg.textBounds.yBottom;
      leftActual.push(left);
      if (Math.abs(left - cmToPt(MARGIN_BODY.left)) > 7) tooLeft.push(pg.number);
      // right margin only when the page has justified text reaching the edge
      const justifiedParas = doc.paras.slice(pg.firstParaIndex, pg.lastParaIndex + 1).filter((p) => p.justified && !p.inTable && p.bbox);
      if (justifiedParas.length) {
        const rightJ = pg.width - Math.max(...justifiedParas.map((p) => p.bbox!.x1));
        if (Math.abs(rightJ - cmToPt(MARGIN_BODY.right)) > 9) tooRight.push(pg.number);
      }
      void right;
      if (top < cmToPt(MARGIN_BODY.top) - 9) tooHigh.push(pg.number);
      if (bottom < cmToPt(MARGIN_BODY.bottom) - 9) tooLow.push(pg.number);
    }
    const list = (a: number[]) => a.slice(0, 12).join(", ") + (a.length > 12 ? ", …" : "");
    if (tooLeft.length && tooLeft.length >= Math.max(1, Math.floor(leftActual.length * 0.15)))
      c.error("LAYOUT-02", CAT, "Margin kiri halaman isi bukan 4 cm", `Tepi kiri teks pada halaman ${list(tooLeft)} tidak berada pada 4 cm dari tepi kertas.`, { page: tooLeft[0] }, {
        expected: "Kiri 4 cm",
        actual: `≈ ${fmtCm(median(leftActual))}`,
        fix: "Layout → Margins → Custom Margins: Top 4, Left 4, Right 3, Bottom 3 cm untuk section isi.",
      });
    if (tooRight.length)
      c.warn("LAYOUT-03", CAT, "Margin kanan halaman isi tampaknya bukan 3 cm", `Tepi kanan teks rata (justify) pada halaman ${list(tooRight)} tidak berada pada 3 cm dari tepi kertas.`, { page: tooRight[0] }, {
        expected: "Kanan 3 cm",
        fix: "Periksa Layout → Margins pada section isi.",
      });
    if (tooHigh.length)
      c.warn("LAYOUT-04", CAT, "Teks dimulai di atas margin atas 4 cm", `Pada halaman ${list(tooHigh)} teks dimulai lebih tinggi dari 4 cm dari tepi atas kertas.`, { page: tooHigh[0] }, {
        expected: "Atas 4 cm",
        fix: "Periksa margin atas section isi (4 cm) dan pastikan header tidak mendorong teks.",
      });
    if (tooLow.length)
      c.warn("LAYOUT-05", CAT, "Teks melewati margin bawah 3 cm", `Pada halaman ${list(tooLow)} teks berakhir lebih rendah dari batas margin bawah 3 cm.`, { page: tooLow[0] }, {
        expected: "Bawah 3 cm",
      });
  }

  /* ---------- font family ---------- */
  const badFonts = new Map<string, { chars: number; samples: { label: string; para: number; page?: number; snippet: string }[] }>();
  for (const p of doc.paras) {
    if (p.isEmpty) continue;
    const sec = ctx.sectionOf(p.index);
    for (const r of p.runs) {
      if (!r.font || isArialNarrow(r.font)) continue;
      if (MATH_FONT_FAMILIES.has(r.font)) continue;
      const n = r.text.replace(/\s/g, "").length;
      if (n < 2) continue;
      // tolerate symbols-only runs
      if (!/[A-Za-z0-9]/.test(r.text)) continue;
      const e = badFonts.get(r.font) ?? { chars: 0, samples: [] };
      e.chars += n;
      if (e.samples.length < 6) e.samples.push({ label: sec?.label ?? "?", para: p.index, page: p.page, snippet: snippet(r.text, 60) });
      badFonts.set(r.font, e);
    }
  }
  for (const [font, e] of badFonts) {
    const sev = e.chars > 200 ? "error" : "warning";
    const detail = `Ditemukan ${e.chars} karakter dengan font "${font}". Seluruh naskah harus menggunakan Arial Narrow. Contoh: ${e.samples.map((s) => `"${s.snippet}" (${s.label}${s.page ? `, hal. ${s.page}` : ""})`).join("; ")}.`;
    c.add({
      id: "FONT-01",
      severity: sev,
      category: CAT,
      title: `Font bukan Arial Narrow: ${font}`,
      detail,
      expected: "Arial Narrow",
      actual: font,
      fix: "Ctrl+A → pilih font Arial Narrow. Periksa juga header/footer, keterangan gambar, dan isi tabel.",
      location: { page: e.samples[0]?.page, paraIndex: e.samples[0]?.para, section: e.samples[0]?.label, snippet: e.samples[0]?.snippet },
    });
  }

  /* ---------- docx: spacing before/after & line rule ---------- */
  if (!ctx.isPdf) {
    const offenders = doc.paras.filter((p) => !p.isEmpty && !p.inTable && ((p.spaceBefore ?? 0) > 0.5 || (p.spaceAfter ?? 0) > 0.5));
    if (offenders.length) {
      const bySection = new Map<string, number>();
      for (const p of offenders) {
        const l = ctx.labelOf(p.index) ?? "?";
        bySection.set(l, (bySection.get(l) ?? 0) + 1);
      }
      const first = offenders[0];
      c.error("SPACE-01", CAT, "Spasi sebelum/sesudah paragraf (Space Before/After) belum dihapus", `${offenders.length} paragraf masih memiliki Space Before/After > 0 pt (${[...bySection].map(([k, v]) => `${k}: ${v}`).join(", ")}). Panduan mewajibkan Add Space Before/After Paragraph dihapus (Remove).`, locOf(first, ctx.labelOf(first.index)), {
        expected: "Before 0 pt, After 0 pt",
        actual: `contoh: before ${first.spaceBefore ?? 0} pt, after ${first.spaceAfter ?? 0} pt`,
        fix: "Ctrl+A → Home → Line and Paragraph Spacing → Remove Space Before Paragraph dan Remove Space After Paragraph (atau Paragraph → Spacing Before/After = 0).",
        fold: true,
      });
      for (const p of offenders.slice(1, 30)) c.add({ id: "SPACE-01", severity: "error", category: CAT, title: "Spasi sebelum/sesudah paragraf (Space Before/After) belum dihapus", detail: "", location: locOf(p, ctx.labelOf(p.index)), foldKey: "SPACE-01::Spasi sebelum/sesudah paragraf (Space Before/After) belum dihapus" }, {});
    }
    const exact = doc.paras.filter((p) => !p.isEmpty && p.lineRule && p.lineRule !== "auto");
    if (exact.length)
      c.warn("SPACE-02", CAT, "Line spacing menggunakan Exactly/At least, bukan Multiple", `${exact.length} paragraf menggunakan lineRule "${exact[0].lineRule}". Gunakan pilihan 1.0 / 1.5 / 2.0 (Multiple) agar sesuai panduan.`, locOf(exact[0], ctx.labelOf(exact[0].index)), {
        fix: "Paragraph → Line spacing: Multiple / Single / 1.5 lines / Double.",
      });
  }

  /* ---------- heading paragraphs: centered, bold, 14pt, spacing 2.0 ---------- */
  for (const s of ctx.sections) {
    if (s.headingParaIndex === undefined) continue;
    if (s.kind === "bab" || s.kind === "lampiran") continue; // handled in body rules
    const p = doc.paras[s.headingParaIndex];
    const size = dominant(p);
    if (p.align !== "center") c.error("HEAD-01", CAT, `Judul bagian "${s.label}" tidak rata tengah`, `Judul halaman "${p.text}" harus diposisikan di tengah (Ctrl+E).`, locOf(p, s.label), { fold: true });
    if (size !== undefined && Math.abs(size - 14) > 0.6)
      c.warn("HEAD-02", CAT, `Ukuran font judul bagian bukan 14 pt`, `Judul "${p.text}" berukuran ${size} pt; pada template judul halaman (KATA PENGANTAR, DAFTAR ISI, dst.) berukuran 14 pt tebal.`, locOf(p, s.label), { expected: "14 pt", actual: `${size} pt`, fold: true });
    if (!p.runs.some((r) => r.bold)) c.warn("HEAD-03", CAT, `Judul bagian tidak tebal (bold)`, `Judul "${p.text}" tidak ditebalkan.`, locOf(p, s.label), { fold: true });
    if (!ctx.isPdf && p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 2) > 0.05)
      c.warn("HEAD-04", CAT, `Line spacing judul bagian bukan 2.0`, `Judul "${p.text}" menggunakan line spacing ${fmtSpacing(p.lineSpacing)}; panduan: 2.0.`, locOf(p, s.label), { expected: "2.0", actual: fmtSpacing(p.lineSpacing), fold: true });
  }
}

function dominant(p: { runs: { text: string; size?: number }[] }): number | undefined {
  const by = new Map<number, number>();
  for (const r of p.runs) {
    if (r.size === undefined) continue;
    const n = r.text.replace(/\s/g, "").length;
    if (n) by.set(r.size, (by.get(r.size) ?? 0) + n);
  }
  let best: number | undefined;
  let bn = -1;
  for (const [k, n] of by) if (n > bn) {
      best = k;
      bn = n;
    }
  return best;
}
function sideLabel(s: string): string {
  return s === "top" ? "atas" : s === "left" ? "kiri" : s === "right" ? "kanan" : "bawah";
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
