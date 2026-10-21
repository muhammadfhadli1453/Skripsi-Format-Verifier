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

type PageView = Pick<PageInfo, "number" | "firstParaIndex" | "pageNumber">;

function pdfPageNumbers(ctx: RuleContext) {
  checkPages(ctx, ctx.doc.pages ?? []);
}

/** Walks the pages in order and checks what number each one prints (pdf: read from the page; docx: simulated from section settings). */
function checkPages(ctx: RuleContext, pages: PageView[]) {
  const { c, doc } = ctx;
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
    const loc = { page: pg.number, printedPage: pn.text, section: sec?.label, snippet: `nomor halaman "${pn.text}"` };
    if (pn.manual) c.warn("PAGE-16", CAT, "Nomor halaman diketik manual, bukan field PAGE", `Hal. ${pg.number} (${sec?.label}): nomor "${pn.text}" diketik sebagai teks biasa di ${posLabel(pn.position)}. Nomor seperti ini tidak ikut berubah bila halaman bergeser.`, loc, { fold: true, fix: "Hapus angka tersebut lalu Insert → Page Number → Current Position → Plain Number, dan atur Start at/Continue lewat Format Page Numbers." });
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
  // page-level checks on the numbers Word would print (simulated by the parser from the section settings)
  const pageCount = doc.paras.reduce((m, p) => Math.max(m, p.page ?? 0), 0);
  const pages: PageView[] = [];
  let carry = 0;
  for (let n = 1; n <= pageCount; n++) {
    const onPage = doc.paras.filter((p) => p.page === n);
    const first = onPage.find((p) => !p.isEmpty) ?? onPage[0];
    if (first) carry = first.index;
    pages.push({ number: n, firstParaIndex: carry, pageNumber: doc.docxPageNumbers?.[n - 1] });
    if (onPage.length) carry = onPage[onPage.length - 1].index; // a page with no paragraph start continues the previous one
  }
  checkPages(ctx, pages);

  // section-level advice that only a .docx can give
  const secOfPara = (i: number) => doc.sections.find((s) => s.firstParaIndex <= i && i <= s.lastParaIndex);
  const checkedSections = new Set<number>();
  for (const ls of ctx.sections) {
    if (ls.kind !== "bab" || ls.headingParaIndex === undefined) continue;
    const sec = secOfPara(ls.headingParaIndex);
    if (!sec) continue;
    const loc = locOf(doc.paras[ls.headingParaIndex], ls.label);
    if (ls.chapter !== 1 && sec.pgNumStart !== undefined && !checkedSections.has(sec.index)) {
      c.info("PAGE-10", CAT, `Section ${ls.label} mengatur Start at ${sec.pgNumStart}`, "Pastikan nomor halaman berlanjut dari BAB sebelumnya (Continue from previous section) agar tidak terjadi lompatan/duplikasi.", loc, { fold: true });
    }
    const startsSection = doc.paras.slice(sec.firstParaIndex, ls.headingParaIndex).every((p) => p.isEmpty);
    if (!startsSection) c.warn("PAGE-14", CAT, `${ls.label} tidak berada di awal section`, "Setiap BAB harus diawali Section Break (Next Page) agar posisi nomor halaman (footer tengah di halaman pertama, header kanan di halaman berikutnya) dapat diatur.", loc, { fold: true });
    checkedSections.add(sec.index);
  }
}
