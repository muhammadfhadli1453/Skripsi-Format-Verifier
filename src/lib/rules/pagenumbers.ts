import type { RuleContext } from "./context";
import type { PageInfo, SectionKind } from "../model";
import { isArialNarrow } from "../parse/fonts";
import { toRoman } from "./frontmatter";
import { locOf } from "./util";

const CAT = "Nomor Halaman";

export function pageNumberRules(ctx: RuleContext) {
  if (ctx.isPdf) pdfPageNumbers(ctx);
  else docxPageNumbers(ctx);
}

const ROMAN_KINDS = new Set<SectionKind>(["pengesahan", "pernyataan", "persembahan", "kata-pengantar", "daftar-isi", "daftar-gambar", "daftar-tabel", "daftar-lampiran", "abstrak", "abstract"]);

function pdfPageNumbers(ctx: RuleContext) {
  const { c, doc } = ctx;
  const pages = doc.pages ?? [];
  let lastArabic: number | undefined;
  let lastRoman: number | undefined;
  let babStarted = false;
  const missing: { kind: string; pages: number[] }[] = [];
  const pushMissing = (kind: string, n: number) => {
    const e = missing.find((m) => m.kind === kind);
    if (e) e.pages.push(n);
    else missing.push({ kind, pages: [n] });
  };
  for (const pg of pages) {
    if (pg.number === 1) {
      if (pg.pageNumber) c.warn("PAGE-01", CAT, "Halaman sampul tidak boleh bernomor", `Sampul memuat nomor halaman "${pg.pageNumber.text}".`, { page: 1 });
      continue;
    }
    const first = doc.paras[pg.firstParaIndex];
    const sec = first ? ctx.sectionOf(first.index) : undefined;
    const kind = sec?.kind ?? "unknown";
    const isHeadingPage = sec?.headingParaIndex !== undefined && doc.paras[sec.headingParaIndex].page === pg.number && pg.firstParaIndex <= sec.headingParaIndex;
    const pn = pg.pageNumber;
    if (kind === "bab" || kind === "daftar-pustaka" || kind === "lampiran") babStarted = true;
    if (kind === "unknown" && !babStarted) continue; // e.g. second cover-like page

    if (!pn) {
      if (kind === "lampiran") continue;
      if ((kind === "abstrak" || kind === "abstract") && ctx.docType === "skripsi") continue; // PPTA 3.1.4: not printed
      if (kind === "pengesahan") {
        c.info("PAGE-12", CAT, "Lembar pengesahan tidak bernomor halaman", "Lembar pengesahan dihitung sebagai halaman ii. Bila template Anda menampilkan nomor, gunakan Romawi kecil di footer tengah.", { page: pg.number, section: sec?.label });
        continue;
      }
      pushMissing(sec?.label ?? kind, pg.number);
      continue;
    }
    const loc = { page: pg.number, section: sec?.label, snippet: `nomor halaman "${pn.text}"` };
    // font
    if (pn.font && !isArialNarrow(pn.font)) c.error("PAGE-02", CAT, `Font nomor halaman bukan Arial Narrow (${pn.font})`, `Nomor halaman "${pn.text}" pada hal. ${pg.number} menggunakan font ${pn.font} ${pn.size ?? ""} pt. Panduan: Arial Narrow 12 pt.`, loc, { expected: "Arial Narrow 12 pt", actual: `${pn.font} ${pn.size ?? ""} pt`, fold: true, fix: "Double-click area footer/header → blok nomor → font Arial Narrow 12." });
    if (pn.size !== undefined && Math.abs(pn.size - 12) > 0.6) c.error("PAGE-03", CAT, "Ukuran font nomor halaman bukan 12 pt", `Nomor halaman "${pn.text}" pada hal. ${pg.number} berukuran ${pn.size} pt.`, loc, { expected: "12 pt", actual: `${pn.size} pt`, fold: true });
    // PPTA 3.1.4: the skripsi abstract page is counted as i but its number is not printed
    if ((kind === "abstrak" || kind === "abstract") && ctx.docType === "skripsi") {
      c.warn("PAGE-15", CAT, "Nomor halaman abstrak tidak perlu dicetak", `Hal. ${pg.number} (${sec?.label}) mencetak nomor "${pn.text}". PPTA 3.1.4: halaman abstrak diberi nomor halaman i, dihitung sebagai halaman isi, tetapi tidak dicetak.`, loc, { fold: true, basis: "ppta" });
      continue;
    }
    if (ROMAN_KINDS.has(kind)) {
      if (pn.kind !== "roman") c.error("PAGE-04", CAT, "Halaman awal (sebelum BAB I) harus bernomor Romawi kecil", `Hal. ${pg.number} (${sec?.label}) bernomor "${pn.text}"; seharusnya romawi (ii, iii, iv, …).`, loc, { fold: true });
      else {
        if (pn.text !== pn.text.toLowerCase()) c.error("PAGE-05", CAT, "Nomor Romawi harus huruf kecil", `Hal. ${pg.number} bernomor "${pn.text}"; gunakan "${pn.text.toLowerCase()}".`, loc, { fold: true });
        if (lastRoman !== undefined && pn.value !== undefined && pn.value !== lastRoman + 1) c.warn("PAGE-06", CAT, "Urutan nomor Romawi melompat", `Hal. ${pg.number} bernomor "${pn.text}" setelah "${toRoman(lastRoman).toLowerCase()}".`, loc, { fold: true });
        if (lastRoman === undefined && pn.value !== undefined && pn.value !== 2 && kind === "pengesahan") c.info("PAGE-06", CAT, "Lembar pengesahan biasanya bernomor ii", `Halaman judul dihitung sebagai i sehingga lembar pengesahan bernomor ii; ditemukan "${pn.text}".`, loc);
        lastRoman = pn.value;
      }
      if (pn.position !== "footer-center") c.error("PAGE-07", CAT, "Posisi nomor halaman awal harus di footer tengah", `Hal. ${pg.number} (${sec?.label}): nomor "${pn.text}" berada di ${posLabel(pn.position)}.`, loc, { fold: true });
    } else if (kind === "bab" || kind === "daftar-pustaka" || kind === "lampiran") {
      if (pn.kind !== "arabic") {
        c.error("PAGE-08", CAT, "Halaman BAB harus bernomor angka (1, 2, 3, …)", `Hal. ${pg.number} (${sec?.label}) bernomor "${pn.text}".`, loc, { fold: true });
        continue;
      }
      if (sec?.kind === "bab" && sec.chapter === 1 && isHeadingPage && pn.value !== 1) c.error("PAGE-09", CAT, `Penomoran BAB I harus dimulai dari 1 (ditemukan ${pn.value})`, `Halaman pertama BAB I bernomor "${pn.text}". Atur Page Number Format → Start at: 1 pada section BAB I.`, loc, { expected: "1", actual: pn.text, fix: "Insert → Page Number → Format Page Numbers → Start at 1 (pada section BAB I)." });
      if (lastArabic !== undefined && pn.value !== undefined && pn.value !== lastArabic + 1) c.error("PAGE-10", CAT, "Urutan nomor halaman tidak berlanjut", `Hal. ${pg.number} bernomor ${pn.value} setelah ${lastArabic}; seharusnya ${lastArabic + 1}.`, loc, { fold: true, fix: "Pada Format Page Numbers pilih 'Continue from previous section' untuk section lanjutan." });
      lastArabic = pn.value;
      const expectedPos = isHeadingPage ? "footer-center" : "header-right";
      if (kind !== "lampiran" && pn.position !== expectedPos) {
        c.error("PAGE-11", CAT, isHeadingPage ? "Nomor halaman awal BAB harus di footer tengah" : "Nomor halaman lanjutan BAB harus di header kanan atas", `Hal. ${pg.number} (${sec?.label}${isHeadingPage ? ", halaman pertama BAB" : ""}): nomor "${pn.text}" berada di ${posLabel(pn.position)}; seharusnya ${posLabel(expectedPos)}.`, loc, { fold: true, fix: "Gunakan Section Break per BAB dan centang Different First Page: footer tengah untuk halaman pertama, header kanan untuk halaman berikutnya." });
      }
    }
  }
  for (const m of missing) {
    c.error("PAGE-12", CAT, `Nomor halaman tidak ditemukan pada ${m.kind}`, `Halaman ${m.pages.slice(0, 15).join(", ")}${m.pages.length > 15 ? ", …" : ""} tidak memiliki nomor halaman yang terbaca (footer tengah/header kanan, Arial Narrow 12).`, { page: m.pages[0], section: m.kind }, { fold: true });
  }
}

function posLabel(p: PageInfo["pageNumber"] extends infer T ? (T extends { position: infer P } ? P : never) : never): string {
  const map: Record<string, string> = { "footer-center": "footer tengah", "footer-right": "footer kanan", "footer-left": "footer kiri", "header-center": "header tengah", "header-right": "header kanan", "header-left": "header kiri" };
  return map[p as string] ?? String(p);
}

function docxPageNumbers(ctx: RuleContext) {
  const { c, doc } = ctx;
  if (doc.sections.length <= 1) {
    c.error("PAGE-13", CAT, "Dokumen hanya memiliki satu section", "Penomoran romawi (halaman awal), angka mulai 1 (BAB I), dan posisi nomor yang berbeda (footer tengah pada halaman pertama BAB, header kanan pada halaman lanjutan) memerlukan Section Break (Layout → Breaks → Next Page) untuk setiap bagian/BAB.", {});
  }
  const secOfPara = (i: number) => doc.sections.find((s) => s.firstParaIndex <= i && i <= s.lastParaIndex);
  const checkedSections = new Set<number>();
  for (const ls of ctx.sections) {
    if (ls.headingParaIndex === undefined) continue;
    const sec = secOfPara(ls.headingParaIndex);
    if (!sec) continue;
    const h = doc.paras[ls.headingParaIndex];
    const loc = locOf(h, ls.label);
    if (ls.kind === "pengesahan") continue; // usually unnumbered (counted as ii)
    if ((ls.kind === "abstrak" || ls.kind === "abstract") && ctx.docType === "skripsi") continue; // PPTA 3.1.4: number not printed
    if (ROMAN_KINDS.has(ls.kind)) {
      if (!checkedSections.has(sec.index) && sec.pgNumFmt !== "lowerRoman") c.error("PAGE-04", CAT, "Halaman awal (sebelum BAB I) harus bernomor Romawi kecil", `Section yang memuat "${ls.label}" menggunakan format nomor "${sec.pgNumFmt ?? "decimal"}". Insert → Page Number → Format Page Numbers → Number format: i, ii, iii.`, loc, { fold: true });
      const footer = sec.headersFooters.find((hf) => hf.kind === "footer" && hf.type === "default");
      const anyPage = sec.headersFooters.some((hf) => hf.hasPageField);
      if (!checkedSections.has(sec.index)) {
        if (!anyPage) c.error("PAGE-12", CAT, `Nomor halaman tidak ditemukan pada ${ls.label}`, `Section yang memuat "${ls.label}" tidak memiliki field PAGE di header/footer.`, loc, { fold: true });
        else if (footer && footer.hasPageField && footer.align !== "center") c.error("PAGE-07", CAT, "Posisi nomor halaman awal harus di footer tengah", `Footer pada section "${ls.label}" rata ${footer.align}.`, loc, { fold: true });
        checkFont(ctx, sec, loc);
      }
      checkedSections.add(sec.index);
    } else if (ls.kind === "bab") {
      if (ls.chapter === 1) {
        if (sec.pgNumStart !== 1) c.error("PAGE-09", CAT, "Penomoran BAB I harus dimulai dari 1", `Section BAB I tidak mengatur "Start at: 1" (pgNumType start=${sec.pgNumStart ?? "tidak diatur"}).`, loc, { fix: "Insert → Page Number → Format Page Numbers → Start at: 1." });
        if (sec.pgNumFmt && sec.pgNumFmt !== "decimal") c.error("PAGE-08", CAT, "Halaman BAB harus bernomor angka", `Section BAB I memakai format "${sec.pgNumFmt}".`, loc);
      } else if (sec.pgNumStart !== undefined && !checkedSections.has(sec.index)) {
        c.info("PAGE-10", CAT, `Section ${ls.label} mengatur Start at ${sec.pgNumStart}`, "Pastikan nomor halaman berlanjut dari BAB sebelumnya (Continue from previous section) agar tidak terjadi lompatan/duplikasi.", loc, { fold: true });
      }
      const startsSection = doc.paras.slice(sec.firstParaIndex, ls.headingParaIndex).every((p) => p.isEmpty);
      if (!startsSection) c.warn("PAGE-14", CAT, `${ls.label} tidak berada di awal section`, "Setiap BAB harus diawali Section Break (Next Page) agar posisi nomor halaman (footer tengah di halaman pertama, header kanan di halaman berikutnya) dapat diatur.", loc, { fold: true });
      if (!checkedSections.has(sec.index)) {
        if (!sec.titlePg) c.error("PAGE-11", CAT, `Section ${ls.label} tidak mengaktifkan "Different First Page"`, "Halaman pertama BAB bernomor di footer tengah, halaman berikutnya di header kanan atas: aktifkan Header & Footer → Different First Page.", loc, { fold: true });
        const firstFooter = sec.headersFooters.find((hf) => hf.kind === "footer" && hf.type === "first");
        const defHeader = sec.headersFooters.find((hf) => hf.kind === "header" && hf.type === "default");
        if (sec.titlePg && !(firstFooter?.hasPageField)) c.error("PAGE-11", CAT, `Footer halaman pertama ${ls.label} tidak memuat nomor halaman`, "First Page Footer harus berisi nomor halaman rata tengah.", loc, { fold: true });
        else if (firstFooter?.hasPageField && firstFooter.align !== "center") c.error("PAGE-11", CAT, `Nomor halaman pertama ${ls.label} tidak rata tengah`, `First Page Footer rata ${firstFooter.align}.`, loc, { fold: true });
        if (!(defHeader?.hasPageField)) c.error("PAGE-11", CAT, `Header ${ls.label} tidak memuat nomor halaman`, "Header halaman lanjutan BAB harus berisi nomor halaman rata kanan.", loc, { fold: true });
        else if (defHeader.align !== "right") c.error("PAGE-11", CAT, `Nomor halaman lanjutan ${ls.label} tidak rata kanan`, `Header rata ${defHeader.align}.`, loc, { fold: true });
        checkFont(ctx, sec, loc);
      }
      checkedSections.add(sec.index);
    }
  }
}

function checkFont(ctx: RuleContext, sec: { headersFooters: { fonts: string[]; sizes: number[]; hasPageField: boolean }[] }, loc: ReturnType<typeof locOf>) {
  for (const hf of sec.headersFooters) {
    if (!hf.hasPageField) continue;
    const bad = hf.fonts.filter((f) => !isArialNarrow(f));
    if (bad.length) ctx.c.error("PAGE-02", CAT, `Font nomor halaman bukan Arial Narrow (${bad.join(", ")})`, "Nomor halaman harus Arial Narrow 12 pt.", loc, { fold: true });
    const badSize = hf.sizes.filter((s) => Math.abs(s - 12) > 0.6);
    if (badSize.length) ctx.c.error("PAGE-03", CAT, "Ukuran font nomor halaman bukan 12 pt", `Ditemukan ${badSize.join(", ")} pt.`, loc, { fold: true });
  }
}
