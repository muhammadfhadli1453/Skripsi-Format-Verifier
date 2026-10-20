import type { DocType, LogicalSection, NormalizedDoc, Para, SectionKind } from "./model";
import { dominantSize, isMostlyBold } from "./rules/util";

export function romanToInt(s: string): number | undefined {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const t = s.toUpperCase();
  if (!/^[IVXLC]+$/.test(t)) return undefined;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = map[t[i]];
    const next = map[t[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

export function parseChapterNumber(s: string): number | undefined {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return romanToInt(s);
}

const HEADINGS: { kind: SectionKind; re: RegExp; label: string }[] = [
  { kind: "pengesahan", re: /^(HALAMAN |LEMBAR )?PENGESAHAN(\s+(SKRIPSI|PROPOSAL|HASIL|KERJA PRAKTIK|LAPORAN.*|TUGAS AKHIR))?$/, label: "Lembar Pengesahan" },
  { kind: "pernyataan", re: /^(HALAMAN |LEMBAR |SURAT )?PERNYATAAN( KEASLIAN.*| ORISINALITAS.*)?$/, label: "Pernyataan Keaslian" },
  { kind: "persembahan", re: /^((HALAMAN |LEMBAR )?PERSEMBAHAN|MOTTO( DAN PERSEMBAHAN)?)$/, label: "Halaman Persembahan" },
  { kind: "kata-pengantar", re: /^KATA PENGANTAR$/, label: "Kata Pengantar" },
  { kind: "daftar-isi", re: /^DAFTAR ISI$/, label: "Daftar Isi" },
  { kind: "daftar-gambar", re: /^DAFTAR GAMBAR$/, label: "Daftar Gambar" },
  { kind: "daftar-tabel", re: /^DAFTAR TABEL$/, label: "Daftar Tabel" },
  { kind: "daftar-lampiran", re: /^DAFTAR LAMPIRAN$/, label: "Daftar Lampiran" },
  { kind: "abstrak", re: /^ABSTRAK$/, label: "Abstrak" },
  { kind: "abstract", re: /^ABSTRACT$/, label: "Abstract" },
  { kind: "daftar-pustaka", re: /^DAFTAR (PUSTAKA|REFERENSI)$/, label: "Daftar Pustaka" },
  { kind: "lampiran", re: /^LAMPIRAN(\s+.*)?$/, label: "Lampiran" },
];
const BAB_RE = /^BAB\s+([IVXLC]+|\d+)\b\s*[.:\-–]?\s*(.*)$/;

export function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.:]+$/, "").trim().toUpperCase();
}

function looksLikeHeading(p: Para, doc: NormalizedDoc): boolean {
  if (p.inTable) return false;
  if (p.text.length > 80) return false;
  if (/\.{4,}/.test(p.text)) return false; // table of contents entry
  const centered = p.align === "center";
  const size = dominantSize(p) ?? 12;
  if (doc.source === "pdf") return centered || size >= 13;
  return centered || size >= 13 || isMostlyBold(p);
}

export function detectSections(doc: NormalizedDoc): LogicalSection[] {
  const paras = doc.paras;
  const sections: LogicalSection[] = [];
  if (!paras.length) return sections;

  let current: LogicalSection = { kind: "cover", label: "Sampul", firstParaIndex: 0, lastParaIndex: 0, firstPage: paras[0].page };
  sections.push(current);
  let lastChapter = 0;
  let seenBab = false;

  const close = (i: number) => {
    current.lastParaIndex = i - 1;
    current.lastPage = paras[i - 1]?.page;
  };
  const open = (s: LogicalSection) => {
    sections.push(s);
    current = s;
  };

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (p.isEmpty) continue;
    const text = normalizeHeading(p.text);
    // cover ends at first page break / new page / heading
    let matched: LogicalSection | undefined;
    const inList = current.kind === "daftar-isi" || current.kind === "daftar-gambar" || current.kind === "daftar-tabel" || current.kind === "daftar-lampiran";
    const prevPage = paras.slice(0, i).reverse().find((x) => !x.isEmpty)?.page;
    const newPage = p.page !== undefined && prevPage !== undefined && p.page > prevPage;
    // entries inside a table of contents/list look like headings (bold, capitals) but are not
    const listEntry = inList && p.align !== "center" && (dominantSize(p) ?? 12) < 13 && !newPage;
    if (!listEntry && looksLikeHeading(p, doc)) {
      const bab = text.match(BAB_RE);
      if (bab) {
        const num = parseChapterNumber(bab[1]);
        // a real chapter heading is centred or large; table-of-contents entries are left-aligned body text
        if (num !== undefined && (p.align === "center" || (dominantSize(p) ?? 0) >= 13)) {
          let title = bab[2]?.trim();
          if (!title) {
            // title on the next non-empty paragraph
            for (let j = i + 1; j < Math.min(paras.length, i + 4); j++) {
              if (!paras[j].isEmpty) {
                title = normalizeHeading(paras[j].text);
                break;
              }
            }
          }
          matched = { kind: "bab", label: `BAB ${bab[1]}${title ? " " + title : ""}`, chapter: num, chapterTitle: title, headingParaIndex: i, firstParaIndex: i, lastParaIndex: i, firstPage: p.page };
          lastChapter = num;
          seenBab = true;
        }
      } else {
        for (const h of HEADINGS) {
          if (!h.re.test(text)) continue;
          if (h.kind === "lampiran" && !seenBab) continue;
          if (h.kind === "lampiran" && current.kind === "lampiran") continue; // "Lampiran 2" etc.
          if (h.kind === "pengesahan" && current.kind === "pengesahan" && i - current.firstParaIndex < 3) continue;
          // the same heading repeated right after (e.g. docx line break duplicates) is ignored
          if (current.kind === h.kind && i - current.firstParaIndex < 3) continue;
          matched = { kind: h.kind, label: h.label, headingParaIndex: i, firstParaIndex: i, lastParaIndex: i, firstPage: p.page };
          break;
        }
      }
    }
    if (matched) {
      close(i);
      open(matched);
      continue;
    }
    // cover ends at the first new page (pdf) or page break (docx)
    if (current.kind === "cover" && i > 0 && (p.page ?? 1) > (paras[current.firstParaIndex].page ?? 1)) {
      close(i);
      open({ kind: "unknown", label: "Bagian tanpa judul", firstParaIndex: i, lastParaIndex: i, firstPage: p.page });
    }
  }
  close(paras.length);
  void lastChapter;
  return sections;
}

export function detectDocType(doc: NormalizedDoc, sections: LogicalSection[]): DocType {
  const cover = sections.find((s) => s.kind === "cover");
  const firstLines: string[] = [];
  if (cover) {
    for (let i = cover.firstParaIndex; i <= cover.lastParaIndex && firstLines.length < 3; i++) {
      const p = doc.paras[i];
      if (!p.isEmpty) firstLines.push(...p.textLines.map((l) => l.toUpperCase()));
    }
  }
  const first = firstLines[0] ?? "";
  if (/\bSKRIPSI\b/.test(first)) return "skripsi";
  if (/\bPROPOSAL\b/.test(first)) return "proposal";
  if (/KERJA PRAKTIK|KERJA PRAKTEK|\bKP\b/.test(first)) return "kp";
  if (/\bHASIL\b/.test(first)) return "hasil";
  const pengesahan = sections.find((s) => s.kind === "pengesahan");
  if (pengesahan) {
    const txt = doc.paras.slice(pengesahan.firstParaIndex, pengesahan.lastParaIndex + 1).map((p) => p.text).join(" ").toLowerCase();
    if (/skripsi ini telah disahkan/.test(txt)) return "skripsi";
    if (/proposal ini telah disahkan/.test(txt)) return "proposal";
    if (/kerja praktik ini telah disahkan/.test(txt)) return "kp";
  }
  const chapters = sections.filter((s) => s.kind === "bab").length;
  if (chapters >= 4) return "skripsi";
  if (chapters >= 1) return "proposal";
  return "unknown";
}

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  proposal: "Proposal",
  skripsi: "Skripsi",
  kp: "Laporan Kerja Praktik",
  hasil: "Laporan Hasil",
  unknown: "Tidak diketahui",
};
