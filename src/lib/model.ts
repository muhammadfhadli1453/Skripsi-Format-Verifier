/**
 * Normalized document model shared by the DOCX and PDF parsers.
 * All lengths are in points (1 cm = 28.3465 pt) unless stated otherwise.
 */

export type Source = "docx" | "pdf";
export type DocType = "proposal" | "skripsi" | "kp" | "hasil" | "unknown";
export type Align = "left" | "center" | "right" | "both";

export const PT_PER_CM = 28.3465;
export const cmToPt = (cm: number) => cm * PT_PER_CM;
export const ptToCm = (pt: number) => pt / PT_PER_CM;
export const EMU_PER_CM = 360000;

export function toRoman(num: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (num >= v) (out += s), (num -= v);
  return out || String(num);
}

export function romanToInt(s: string): number | undefined {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(t)) return undefined;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = map[t[i]];
    const next = map[t[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

export interface Run {
  text: string;
  font?: string;
  size?: number; // pt
  bold?: boolean;
  italic?: boolean;
  caps?: boolean; // docx: w:caps rendered uppercase
}

export interface ImageInfo {
  widthCm: number;
  heightCm: number;
  /** pdf only: bounding box on page */
  bbox?: { x: number; y: number; w: number; h: number };
  /** docx only: anchored (floating) vs inline */
  anchored?: boolean;
  page?: number;
}

export interface Para {
  /** sequential index across the whole document (0-based) */
  index: number;
  text: string;
  /** visual lines (pdf) or manual line breaks (docx) */
  textLines: string[];
  runs: Run[];
  /** pdf: real page (1-based). docx: estimated from Word's last rendered layout */
  page?: number;
  /** docx: estimated page number printed in header/footer (from section numbering settings) */
  printedPage?: number;
  /** page number as printed on this paragraph's page ("1", "vii"); undefined when the page shows none */
  printedPageText?: string;
  align?: Align;
  /** docx: left-aligned paragraph visually centred with a centre tab stop */
  centeredByTab?: boolean;
  /** line spacing as multiple (1, 1.15, 1.5, 2). undefined if unknown */
  lineSpacing?: number;
  /** docx: lineRule other than "auto" */
  lineRule?: string;
  spaceBefore?: number; // pt (docx)
  spaceAfter?: number; // pt (docx)
  firstLineIndent?: number; // pt
  leftIndent?: number; // pt
  hangingIndent?: number; // pt
  /** pdf geometry of the paragraph (union of lines) */
  bbox?: { x0: number; x1: number; yTop: number; yBottom: number };
  /** pdf: x0 of first line and of subsequent lines */
  firstLineX?: number;
  bodyLineX?: number;
  /** pdf: number of visual lines */
  lineCount?: number;
  /** pdf: measured line pitch in pt (baseline to baseline) */
  linePitch?: number;
  /** pdf: baseline y of each visual line (top-down coordinates) */
  lineBaselines?: number[];
  /** pdf: whether lines are stretched to the right margin */
  justified?: boolean;
  images: ImageInfo[];
  inTable?: boolean;
  tableIndex?: number;
  /** docx: paragraph has numbering (w:numPr) */
  hasNumbering?: boolean;
  pageBreakBefore?: boolean;
  /** docx: index of the section (w:sectPr) this paragraph belongs to */
  sectionIndex: number;
  styleId?: string;
  isEmpty: boolean;
  /** pdf: position class of this paragraph when it sits in header / footer zone */
  zone?: "header" | "footer" | "body";
}

export interface TableInfo {
  index: number;
  /** index of the paragraph right before the table */
  prevParaIndex: number;
  /** index of the first paragraph after the table */
  nextParaIndex: number;
  cellParaIndexes: number[];
  page?: number;
}

export interface HeaderFooterInfo {
  kind: "header" | "footer";
  type: "default" | "first" | "even";
  text: string;
  hasPageField: boolean;
  align?: Align;
  fonts: string[];
  sizes: number[];
}

export interface SectionProps {
  index: number;
  pageWidth: number; // pt
  pageHeight: number; // pt
  margins?: { top: number; right: number; bottom: number; left: number }; // pt
  pgNumFmt?: string; // decimal | lowerRoman | upperRoman ...
  pgNumStart?: number;
  titlePg?: boolean;
  headersFooters: HeaderFooterInfo[];
  firstParaIndex: number;
  lastParaIndex: number;
}

export interface PageNumberInfo {
  text: string;
  value?: number;
  kind: "roman" | "arabic" | "other";
  position: "footer-center" | "footer-right" | "footer-left" | "header-center" | "header-right" | "header-left";
  font?: string;
  size?: number;
  /** docx: number typed as plain text in the header/footer instead of a PAGE field */
  manual?: boolean;
}

export interface PageInfo {
  number: number; // physical page, 1-based
  width: number;
  height: number;
  /** body text bounds excluding header/footer zones */
  textBounds?: { x0: number; x1: number; yTop: number; yBottom: number };
  pageNumber?: PageNumberInfo;
  firstParaIndex: number;
  lastParaIndex: number;
  images: ImageInfo[];
}

export interface NormalizedDoc {
  source: Source;
  fileName: string;
  paras: Para[];
  tables: TableInfo[];
  sections: SectionProps[];
  pages?: PageInfo[];
  /** docx: simulated page number per estimated physical page (index = page - 1); undefined = no number shown */
  docxPageNumbers?: (PageNumberInfo | undefined)[];
  /** font name -> number of characters */
  fontUsage: Record<string, number>;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Logical sections of a thesis                                        */
/* ------------------------------------------------------------------ */

export type SectionKind =
  | "cover"
  | "pengesahan"
  | "pernyataan"
  | "persembahan"
  | "kata-pengantar"
  | "daftar-isi"
  | "daftar-gambar"
  | "daftar-tabel"
  | "daftar-lampiran"
  | "abstrak"
  | "abstract"
  | "hak-cipta"
  | "tim-penguji"
  | "riwayat-hidup"
  | "bab"
  | "daftar-pustaka"
  | "lampiran"
  | "unknown";

export interface LogicalSection {
  kind: SectionKind;
  label: string;
  /** for bab: 1..n */
  chapter?: number;
  chapterTitle?: string;
  headingParaIndex?: number;
  firstParaIndex: number;
  lastParaIndex: number;
  firstPage?: number;
  lastPage?: number;
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

export type Severity = "error" | "warning" | "info";

export interface IssueLocation {
  page?: number;
  /** page number printed on that page ("1", "vii"), stable across viewers unlike the physical page */
  printedPage?: string;
  paraIndex?: number;
  section?: string;
  snippet?: string;
}

export interface Issue {
  id: string; // rule id, e.g. "COVER-03"
  severity: Severity;
  category: string; // human readable group, e.g. "Sampul"
  title: string;
  detail: string;
  expected?: string;
  actual?: string;
  fix?: string;
  location: IssueLocation;
  /** additional occurrences folded into this issue */
  occurrences?: IssueLocation[];
  source?: "rule" | "ai";
  /** which guideline the rule comes from (undefined = Prodi Informatika format) */
  basis?: "prodi" | "ppta" | "keduanya";
}

export interface VerifyReport {
  fileName: string;
  source: Source;
  docType: DocType;
  detectedDocType: DocType;
  pageCount?: number;
  paragraphCount: number;
  sections: { kind: SectionKind; label: string; firstPage?: number; lastPage?: number }[];
  summary: { errors: number; warnings: number; infos: number; score: number };
  issues: Issue[];
  capabilities: string[];
  limitations: string[];
  aiSummary?: string;
  ai?: { used: boolean; model?: string; error?: string; inputTokens?: number; outputTokens?: number };
  /** name/NPM read from the cover (used for the leaderboard) */
  student?: { name?: string; studentId?: string };
  /** present when the upload was kept in storage */
  submission?: {
    id?: string;
    /** includes the secret token; only the uploader receives it */
    downloadUrl?: string;
    /** same as summary.score */
    rankedScore: number;
    error?: string;
  };
  durationMs: number;
}
