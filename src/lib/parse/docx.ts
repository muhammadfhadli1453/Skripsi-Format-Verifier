import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { Align, HeaderFooterInfo, ImageInfo, NormalizedDoc, PageNumberInfo, Para, Run, SectionProps, TableInfo } from "../model";
import { EMU_PER_CM, romanToInt, toRoman } from "../model";
import { isArialNarrow, normalizeFontName } from "./fonts";

/* ------------------------------------------------------------------ */
/* XML helpers (fast-xml-parser with preserveOrder)                    */
/* ------------------------------------------------------------------ */

type XNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function nodeName(n: XNode): string {
  return Object.keys(n).find((k) => k !== ":@") ?? "";
}
function children(n: XNode): XNode[] {
  const name = nodeName(n);
  const c = n[name];
  return Array.isArray(c) ? (c as XNode[]) : [];
}
function attrs(n: XNode): Record<string, string> {
  return n[":@"] ?? {};
}
function attr(n: XNode | undefined, name: string): string | undefined {
  if (!n) return undefined;
  const a = attrs(n);
  if (name in a) return a[name];
  // attribute keys may carry namespace prefix, e.g. "w:val"
  for (const k of Object.keys(a)) if (k === name || k.endsWith(":" + name)) return a[k];
  return undefined;
}
function child(n: XNode | undefined, name: string): XNode | undefined {
  if (!n) return undefined;
  return children(n).find((c) => nodeName(c) === name);
}
function childrenNamed(n: XNode | undefined, name: string): XNode[] {
  if (!n) return [];
  return children(n).filter((c) => nodeName(c) === name);
}
function textOf(n: XNode): string {
  // text node: { "#text": "..." }
  if ("#text" in n) return String(n["#text"]);
  return children(n).map(textOf).join("");
}
function onOff(n: XNode | undefined): boolean | undefined {
  if (!n) return undefined;
  const v = attr(n, "val");
  if (v === undefined) return true;
  return !(v === "0" || v === "false" || v === "off");
}
function twipsToPt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n / 20 : undefined;
}

/* ------------------------------------------------------------------ */
/* Style model                                                         */
/* ------------------------------------------------------------------ */

interface RProps {
  font?: string;
  fontTheme?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  caps?: boolean;
}
interface PProps {
  align?: Align;
  line?: number; // raw w:line value
  lineRule?: string;
  before?: number; // pt
  after?: number; // pt
  beforeAuto?: boolean;
  afterAuto?: boolean;
  contextualSpacing?: boolean;
  left?: number;
  firstLine?: number;
  hanging?: number;
  pageBreakBefore?: boolean;
  numId?: string;
  ilvl?: number;
  tabs?: TabStop[];
}
interface TabStop {
  val: string; // left | center | right | decimal | bar | clear
  pos: number; // pt from the left text margin
}
interface Style {
  id: string;
  type: string;
  basedOn?: string;
  rPr: RProps;
  pPr: PProps;
  numId?: string;
  ilvl?: number;
}

function readRPr(rPr: XNode | undefined): RProps {
  const out: RProps = {};
  if (!rPr) return out;
  const fonts = child(rPr, "w:rFonts");
  if (fonts) {
    out.font = attr(fonts, "ascii") ?? attr(fonts, "hAnsi");
    out.fontTheme = attr(fonts, "asciiTheme") ?? attr(fonts, "hAnsiTheme");
  }
  const sz = child(rPr, "w:sz");
  if (sz) {
    const v = parseInt(attr(sz, "val") ?? "", 10);
    if (Number.isFinite(v)) out.size = v / 2;
  }
  const b = child(rPr, "w:b");
  if (b) out.bold = onOff(b);
  const i = child(rPr, "w:i");
  if (i) out.italic = onOff(i);
  const caps = child(rPr, "w:caps");
  if (caps) out.caps = onOff(caps);
  return out;
}

function readPPr(pPr: XNode | undefined): PProps {
  const out: PProps = {};
  if (!pPr) return out;
  const jc = child(pPr, "w:jc");
  if (jc) {
    const v = attr(jc, "val");
    out.align = v === "center" ? "center" : v === "right" || v === "end" ? "right" : v === "both" || v === "distribute" ? "both" : "left";
  }
  const sp = child(pPr, "w:spacing");
  if (sp) {
    const line = attr(sp, "line");
    if (line !== undefined) out.line = parseInt(line, 10);
    out.lineRule = attr(sp, "lineRule");
    const before = twipsToPt(attr(sp, "before"));
    const after = twipsToPt(attr(sp, "after"));
    if (before !== undefined) out.before = before;
    if (after !== undefined) out.after = after;
    if (attr(sp, "beforeAutospacing") === "1") out.beforeAuto = true;
    if (attr(sp, "afterAutospacing") === "1") out.afterAuto = true;
  }
  const ind = child(pPr, "w:ind");
  if (ind) {
    out.left = twipsToPt(attr(ind, "left") ?? attr(ind, "start"));
    out.firstLine = twipsToPt(attr(ind, "firstLine"));
    out.hanging = twipsToPt(attr(ind, "hanging"));
  }
  const tabs = child(pPr, "w:tabs");
  if (tabs) {
    out.tabs = childrenNamed(tabs, "w:tab").map((t) => ({ val: attr(t, "val") ?? "left", pos: twipsToPt(attr(t, "pos")) ?? 0 }));
  }
  if (child(pPr, "w:contextualSpacing")) out.contextualSpacing = onOff(child(pPr, "w:contextualSpacing"));
  if (child(pPr, "w:pageBreakBefore")) out.pageBreakBefore = onOff(child(pPr, "w:pageBreakBefore"));
  const numPr = child(pPr, "w:numPr");
  if (numPr) {
    out.numId = attr(child(numPr, "w:numId"), "val");
    const il = attr(child(numPr, "w:ilvl"), "val");
    out.ilvl = il !== undefined ? parseInt(il, 10) : 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

interface NumLevel {
  fmt: string;
  text: string;
  start: number;
  isLgl?: boolean;
}
interface Numbering {
  /** numId -> levels */
  nums: Map<string, NumLevel[]>;
  /** numId -> counter key; num instances of one abstractNum share counters unless they restart */
  counterKey: Map<string, string>;
}

function fmtNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case "upperLetter":
      return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case "lowerRoman":
      return toRoman(n).toLowerCase();
    case "upperRoman":
      return toRoman(n);
    case "bullet":
      return "•";
    case "none":
      return "";
    default:
      return String(n);
  }
}
function parseNumbering(xml: string | undefined): Numbering {
  const nums = new Map<string, NumLevel[]>();
  const counterKey = new Map<string, string>();
  if (!xml) return { nums, counterKey };
  const root = parser.parse(xml) as XNode[];
  const numbering = root.find((n) => nodeName(n) === "w:numbering");
  if (!numbering) return { nums, counterKey };
  const abstracts = new Map<string, NumLevel[]>();
  for (const an of childrenNamed(numbering, "w:abstractNum")) {
    const id = attr(an, "abstractNumId") ?? "";
    const levels: NumLevel[] = [];
    for (const lvl of childrenNamed(an, "w:lvl")) {
      const i = parseInt(attr(lvl, "ilvl") ?? "0", 10);
      levels[i] = {
        fmt: attr(child(lvl, "w:numFmt"), "val") ?? "decimal",
        text: attr(child(lvl, "w:lvlText"), "val") ?? "%1.",
        start: parseInt(attr(child(lvl, "w:start"), "val") ?? "1", 10),
        isLgl: !!child(lvl, "w:isLgl"),
      };
    }
    abstracts.set(id, levels);
  }
  for (const num of childrenNamed(numbering, "w:num")) {
    const id = attr(num, "numId") ?? "";
    const aid = attr(child(num, "w:abstractNumId"), "val") ?? "";
    const base = abstracts.get(aid) ?? [];
    const levels = base.map((l) => ({ ...l }));
    let restarts = false;
    for (const ov of childrenNamed(num, "w:lvlOverride")) {
      const i = parseInt(attr(ov, "ilvl") ?? "0", 10);
      const so = attr(child(ov, "w:startOverride"), "val");
      if (levels[i] && so) {
        levels[i].start = parseInt(so, 10);
        restarts = true;
      }
    }
    nums.set(id, levels);
    counterKey.set(id, restarts ? `num:${id}` : `abs:${aid}`);
  }
  return { nums, counterKey };
}

/**
 * Mirrors Word's list counters: a level that has not been used yet displays its start value
 * (so "%1.%2." on level 2 of a list whose level 1 starts at 3 renders "3.1.") and from then on
 * counts as used (a later level-1 item after "3.2.1." renders "3.3."), deeper levels reset when
 * a shallower level advances, and isLgl forces decimal display of every level.
 */
class NumberingCounter {
  private counters = new Map<string, (number | undefined)[]>();
  constructor(private numbering: Numbering) {}
  next(numId: string, ilvl: number): string | undefined {
    const levels = this.numbering.nums.get(numId);
    if (!levels || !levels[ilvl]) return undefined;
    const key = this.numbering.counterKey.get(numId) ?? numId;
    let c = this.counters.get(key);
    if (!c) {
      c = [];
      this.counters.set(key, c);
    }
    for (let i = 0; i < ilvl; i++) if (c[i] === undefined) c[i] = levels[i]?.start ?? 1;
    c[ilvl] = c[ilvl] === undefined ? levels[ilvl].start : c[ilvl]! + 1;
    for (let i = ilvl + 1; i < 9; i++) c[i] = undefined;
    const lvl = levels[ilvl];
    if (lvl.fmt === "bullet") return "•";
    return lvl.text.replace(/%(\d)/g, (_, d) => {
      const li = parseInt(d, 10) - 1;
      const val = c![li] ?? levels[li]?.start ?? 1;
      return fmtNumber(val, lvl.isLgl ? "decimal" : levels[li]?.fmt ?? "decimal");
    });
  }
}

/* ------------------------------------------------------------------ */
/* Main parser                                                         */
/* ------------------------------------------------------------------ */

export async function parseDocx(buffer: Buffer, fileName: string): Promise<NormalizedDoc> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p: string) => {
    const f = zip.file(p);
    return f ? f.async("string") : undefined;
  };
  const documentXml = await read("word/document.xml");
  if (!documentXml) throw new Error("Berkas .docx tidak valid (word/document.xml tidak ditemukan).");
  const stylesXml = await read("word/styles.xml");
  const numberingXml = await read("word/numbering.xml");
  const themeXml = await read("word/theme/theme1.xml");
  const relsXml = await read("word/_rels/document.xml.rels");

  // theme fonts
  const themeFonts: Record<string, string> = {};
  if (themeXml) {
    const minor = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]*)"/);
    const major = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]*)"/);
    if (minor) themeFonts.minor = minor[1];
    if (major) themeFonts.major = major[1];
  }
  const resolveThemeFont = (t: string | undefined) => (t ? (t.startsWith("major") ? themeFonts.major : themeFonts.minor) : undefined);

  // styles
  const styles = new Map<string, Style>();
  let defaultRPr: RProps = {};
  let defaultPPr: PProps = {};
  let defaultParaStyle: string | undefined;
  let defaultTableStyle: string | undefined;
  const settingsXml = await read("word/settings.xml");
  const defaultTabStop = twipsToPt(settingsXml?.match(/<w:defaultTabStop w:val="(\d+)"/)?.[1]) ?? 36;
  if (stylesXml) {
    const root = parser.parse(stylesXml) as XNode[];
    const st = root.find((n) => nodeName(n) === "w:styles");
    const dd = child(st, "w:docDefaults");
    defaultRPr = readRPr(child(child(dd, "w:rPrDefault"), "w:rPr"));
    defaultPPr = readPPr(child(child(dd, "w:pPrDefault"), "w:pPr"));
    for (const s of childrenNamed(st, "w:style")) {
      const id = attr(s, "styleId") ?? "";
      const pPr = readPPr(child(s, "w:pPr"));
      const style: Style = {
        id,
        type: attr(s, "type") ?? "paragraph",
        basedOn: attr(child(s, "w:basedOn"), "val"),
        rPr: readRPr(child(s, "w:rPr")),
        pPr,
        numId: pPr.numId,
        ilvl: pPr.ilvl,
      };
      styles.set(id, style);
      if (style.type === "paragraph" && attr(s, "default") === "1") defaultParaStyle = id;
      if (style.type === "table" && attr(s, "default") === "1") defaultTableStyle = id;
    }
  }
  const styleChain = (id: string | undefined): Style[] => {
    const chain: Style[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const s = styles.get(cur);
      if (!s) break;
      chain.push(s);
      cur = s.basedOn;
    }
    return chain;
  };
  // precedence (ECMA-376 17.7.2): doc defaults → table style → paragraph style chain → direct formatting
  const resolvePPr = (direct: PProps, styleId: string | undefined, tableStyleId?: string): PProps => {
    const chain = styleChain(styleId ?? defaultParaStyle);
    const out: PProps = { ...defaultPPr };
    if (tableStyleId) {
      const tchain = styleChain(tableStyleId);
      for (let i = tchain.length - 1; i >= 0; i--) Object.assign(out, strip(tchain[i].pPr));
    }
    const tabLayers: TabStop[][] = [];
    for (let i = chain.length - 1; i >= 0; i--) {
      Object.assign(out, strip(chain[i].pPr));
      if (chain[i].pPr.tabs) tabLayers.push(chain[i].pPr.tabs!);
    }
    Object.assign(out, strip(direct));
    if (direct.tabs) tabLayers.push(direct.tabs);
    // merge tab stops: later layers add stops or clear inherited ones at the same position
    const merged = new Map<number, TabStop>();
    for (const layer of tabLayers) for (const t of layer) {
      const key = Math.round(t.pos);
      if (t.val === "clear") merged.delete(key);
      else merged.set(key, t);
    }
    out.tabs = [...merged.values()].sort((a, b) => a.pos - b.pos);
    return out;
  };
  const resolveRPr = (direct: RProps, runStyleId: string | undefined, paraStyleId: string | undefined): RProps => {
    const out: RProps = { ...defaultRPr };
    const pchain = styleChain(paraStyleId ?? defaultParaStyle);
    for (let i = pchain.length - 1; i >= 0; i--) Object.assign(out, strip(pchain[i].rPr));
    const rchain = styleChain(runStyleId);
    for (let i = rchain.length - 1; i >= 0; i--) Object.assign(out, strip(rchain[i].rPr));
    Object.assign(out, strip(direct));
    if (!out.font && out.fontTheme) out.font = resolveThemeFont(out.fontTheme);
    if (!out.font && defaultRPr.fontTheme) out.font = resolveThemeFont(defaultRPr.fontTheme);
    return out;
  };

  // relationships (for headers/footers)
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = m[0].match(/\bId="([^"]*)"/)?.[1];
      const target = m[0].match(/\bTarget="([^"]*)"/)?.[1];
      if (id && target) rels.set(id, target.replace(/^\/?word\//, "").replace(/^\//, ""));
    }
  }

  const numbering = parseNumbering(numberingXml);
  const counter = new NumberingCounter(numbering);

  const paras: Para[] = [];
  const tables: TableInfo[] = [];
  const sections: SectionProps[] = [];
  const fontUsage: Record<string, number> = {};
  const warnings: string[] = [];
  let sectionIndex = 0;
  let sectionFirstPara = 0;
  let estimatedPage = 1;
  let pendingPageBreak = false;
  // Word stores <w:lastRenderedPageBreak/> where its layout engine broke pages on last save.
  // When present it is far more accurate than counting explicit page/section breaks.
  const renderedMode = documentXml.includes("lastRenderedPageBreak");
  // how each section starts: w:type lives in the sectPr that closes that section (absent = next page)
  const sectionContinuous = [...documentXml.matchAll(/<w:sectPr\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:sectPr>)/g)].map((m) => /<w:type w:val="continuous"/.test(m[1] ?? ""));
  // Word marks no lastRenderedPageBreak when the first paragraph after a section break is empty (e.g. an empty table cell)
  let pendingSectionPage = false;

  const readSectPr = async (sectPr: XNode, firstParaIndex: number, lastParaIndex: number): Promise<SectionProps> => {
    const pgSz = child(sectPr, "w:pgSz");
    const pgMar = child(sectPr, "w:pgMar");
    const pgNum = child(sectPr, "w:pgNumType");
    const hf: HeaderFooterInfo[] = [];
    for (const kind of ["header", "footer"] as const) {
      for (const ref of childrenNamed(sectPr, `w:${kind}Reference`)) {
        const type = (attr(ref, "type") ?? "default") as HeaderFooterInfo["type"];
        const rid = attr(ref, "id");
        const target = rid ? rels.get(rid) : undefined;
        const xml = target ? await read("word/" + target) : undefined;
        if (!xml) continue;
        const info = parseHeaderFooter(xml, kind, type, resolveRPr, resolvePPr);
        hf.push(info);
      }
    }
    const w = twipsToPt(attr(pgSz, "w")) ?? 595.3;
    const h = twipsToPt(attr(pgSz, "h")) ?? 841.9;
    const start = attr(pgNum, "start");
    return {
      index: sectionIndex,
      pageWidth: w,
      pageHeight: h,
      margins: pgMar
        ? {
            top: twipsToPt(attr(pgMar, "top")) ?? 0,
            right: twipsToPt(attr(pgMar, "right")) ?? 0,
            bottom: twipsToPt(attr(pgMar, "bottom")) ?? 0,
            left: twipsToPt(attr(pgMar, "left")) ?? 0,
          }
        : undefined,
      pgNumFmt: attr(pgNum, "fmt") ?? "decimal",
      pgNumStart: start !== undefined ? parseInt(start, 10) : undefined,
      titlePg: !!child(sectPr, "w:titlePg"),
      headersFooters: hf,
      firstParaIndex,
      lastParaIndex,
    };
  };

  const collectRuns = (node: XNode, paraStyleId: string | undefined, out: Run[], images: ImageInfo[], flags: RunFlags) => {
    for (const c of children(node)) {
      const name = nodeName(c);
      switch (name) {
        case "w:r": {
          const rPrNode = child(c, "w:rPr");
          const rStyle = attr(child(rPrNode, "w:rStyle"), "val");
          const rp = resolveRPr(readRPr(rPrNode), rStyle, paraStyleId);
          let text = "";
          for (const rc of children(c)) {
            const rn = nodeName(rc);
            if (rn === "w:t") {
              const t = textOf(rc);
              text += t;
              if (t.trim()) flags.textSeen = true;
            }
            else if (rn === "w:tab") text += "\t";
            else if (rn === "w:br") {
              if (attr(rc, "type") === "page") flags.pageBreak = true;
              else text += "\n";
            } else if (rn === "w:noBreakHyphen") text += "-";
            else if (rn === "w:lastRenderedPageBreak") {
              flags.renderedBreaks++;
              if (!flags.textSeen) flags.leadingRendered = true;
            } else if (rn === "w:drawing" || rn === "mc:AlternateContent" || rn === "w:pict" || rn === "w:object") {
              collectImages(rc, images);
              if (images.length) flags.textSeen = true;
            } else if (rn === "w:sym") text += "□";
            else if (rn === "w:fldChar" || rn === "w:instrText") {
              /* ignore field codes */
            }
          }
          if (rp.caps) text = text.toUpperCase();
          if (text.length) {
            const fam = rp.font ? normalizeFontName(rp.font).family : "?";
            out.push({ text, font: fam, size: rp.size, bold: !!rp.bold, italic: !!rp.italic, caps: rp.caps });
            const n = text.replace(/\s/g, "").length;
            if (n) fontUsage[fam] = (fontUsage[fam] ?? 0) + n;
          }
          break;
        }
        case "w:hyperlink":
        case "w:ins":
        case "w:smartTag":
        case "w:fldSimple":
        case "w:sdt":
        case "w:sdtContent":
        case "w:customXml":
        case "w:moveTo":
          collectRuns(c, paraStyleId, out, images, flags);
          break;
        case "m:oMath":
        case "m:oMathPara": {
          // equations: keep their text so surrounding punctuation reads correctly
          const mathText = mathPlainText(c);
          if (mathText) out.push({ text: mathText, font: "Cambria Math", size: undefined, bold: false, italic: false });
          flags.textSeen = true;
          break;
        }
        case "w:del":
        case "w:moveFrom":
          break;
        default:
          break;
      }
    }
  };

  const processParagraph = async (p: XNode, ctx: BlockCtx) => {
    const pPrNode = child(p, "w:pPr");
    const styleId = attr(child(pPrNode, "w:pStyle"), "val");
    const direct = readPPr(pPrNode);
    const pp = resolvePPr(direct, styleId, ctx.tableStyleId);
    const runs: Run[] = [];
    const images: ImageInfo[] = [];
    const flags: RunFlags = { pageBreak: false, renderedBreaks: 0, textSeen: false, leadingRendered: false };
    collectRuns(p, styleId, runs, images, flags);

    // numbering text
    let numId = direct.numId;
    let ilvl = direct.ilvl ?? 0;
    if (numId === undefined) {
      for (const s of styleChain(styleId)) if (s.numId !== undefined) ((numId = s.numId), (ilvl = s.ilvl ?? 0)), (void 0);
    }
    let numText: string | undefined;
    // an empty paragraph that only carries a section break shows no list number and does not advance the list
    const sectionBreakOnly = !!child(pPrNode, "w:sectPr") && !runs.some((r) => r.text.trim()) && !images.length;
    if (numId !== undefined && numId !== "0" && !sectionBreakOnly) {
      numText = counter.next(numId, ilvl);
    }
    const rawText = runs.map((r) => r.text).join("");
    let text = rawText.replace(/[\t\n]+/g, " ").replace(/\s+/g, " ").trim();
    const textLines = rawText
      .split("\n")
      .map((l) => l.replace(/\t+/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => l.length);
    if (numText && text) text = `${numText} ${text}`;
    else if (numText && !text) text = numText;

    let pageBreakBefore = !!(pp.pageBreakBefore || pendingPageBreak);
    let paraPage: number;
    if (renderedMode) {
      if (flags.leadingRendered || pendingSectionPage) estimatedPage++;
      paraPage = estimatedPage;
      estimatedPage += flags.renderedBreaks - (flags.leadingRendered ? 1 : 0);
      if (flags.leadingRendered || pendingSectionPage) pageBreakBefore = true;
      pendingSectionPage = false;
    } else {
      if (pageBreakBefore) estimatedPage++;
      paraPage = estimatedPage;
      estimatedPage += flags.renderedBreaks;
    }
    pendingPageBreak = flags.pageBreak;

    // effective first-line indent when the paragraph starts with Tab characters
    const leftPt = pp.left ?? 0;
    let firstLine = pp.firstLine ?? (pp.hanging ? -pp.hanging : undefined);
    let centeredByTab = false;
    const leadingTabs = rawText.match(/^\t+/)?.[0].length ?? 0;
    if (leadingTabs && rawText.slice(leadingTabs).trim()) {
      let pos = leftPt + (firstLine ?? 0);
      const stops = pp.tabs ?? [];
      for (let k = 0; k < leadingTabs; k++) {
        const next = stops.find((t) => t.pos > pos + 0.5 && t.val !== "bar");
        const implicit = pp.hanging && leftPt > pos + 0.5 ? leftPt : undefined; // hanging indent acts as a tab stop
        const dflt = (Math.floor(pos / defaultTabStop) + 1) * defaultTabStop;
        const candidates = [next?.pos, implicit, next ? undefined : dflt].filter((x): x is number => x !== undefined);
        const target = Math.min(...candidates);
        if (k === leadingTabs - 1 && next && next.pos === target && next.val === "center") centeredByTab = true;
        pos = target;
      }
      firstLine = pos - leftPt;
    }

    const lineRule = pp.lineRule ?? "auto";
    let lineSpacing: number | undefined;
    if (pp.line !== undefined) {
      if (lineRule === "auto") lineSpacing = Math.round((pp.line / 240) * 100) / 100;
      else lineSpacing = undefined; // exact/atLeast in twips -> handled via lineRule
    } else lineSpacing = 1;

    const para: Para = {
      index: paras.length,
      text,
      textLines: numText && textLines.length ? [`${numText} ${textLines[0]}`, ...textLines.slice(1)] : textLines,
      runs,
      page: paraPage,
      align: pp.align ?? "left",
      centeredByTab: centeredByTab || undefined,
      lineSpacing,
      lineRule: lineRule !== "auto" ? lineRule : undefined,
      spaceBefore: pp.beforeAuto ? 14 : pp.before ?? 0,
      spaceAfter: pp.afterAuto ? 14 : pp.after ?? 0,
      firstLineIndent: firstLine,
      leftIndent: pp.left,
      hangingIndent: pp.hanging,
      images,
      inTable: ctx.inTable,
      tableIndex: ctx.tableIndex,
      hasNumbering: numText !== undefined,
      pageBreakBefore,
      sectionIndex,
      styleId,
      isEmpty: text.length === 0 && images.length === 0,
    };
    if (pp.contextualSpacing) {
      para.spaceBefore = 0;
      para.spaceAfter = 0;
    }
    paras.push(para);

    const sectPr = child(pPrNode, "w:sectPr");
    if (sectPr) {
      sections.push(await readSectPr(sectPr, sectionFirstPara, paras.length - 1));
      sectionIndex++;
      sectionFirstPara = paras.length;
      if (!sectionContinuous[sectionIndex]) {
        if (renderedMode) pendingSectionPage = true;
        else estimatedPage++;
      }
      pendingPageBreak = false;
    }
  };

  const processTable = async (tbl: XNode) => {
    const tIndex = tables.length;
    const tableStyleId = attr(child(child(tbl, "w:tblPr"), "w:tblStyle"), "val") ?? defaultTableStyle;
    const info: TableInfo = { index: tIndex, prevParaIndex: paras.length - 1, nextParaIndex: -1, cellParaIndexes: [], page: estimatedPage };
    tables.push(info);
    for (const tr of childrenNamed(tbl, "w:tr")) {
      // the cells of a row sit side by side: a row split across a page carries a page-break marker in
      // every cell, so each cell starts from the row's page and the row ends on the furthest one
      const rowStart = estimatedPage;
      const rowPendingSection = pendingSectionPage;
      let rowEnd = rowStart;
      for (const tc of children(tr)) {
        if (nodeName(tc) !== "w:tc" && nodeName(tc) !== "w:sdt") continue;
        estimatedPage = rowStart;
        pendingSectionPage = rowPendingSection;
        await processBlocks(tc, { inTable: true, tableIndex: tIndex, tableStyleId });
        rowEnd = Math.max(rowEnd, estimatedPage);
      }
      estimatedPage = rowEnd;
    }
    info.nextParaIndex = paras.length;
  };

  const processBlocks = async (container: XNode, ctx: BlockCtx) => {
    for (const c of children(container)) {
      const name = nodeName(c);
      if (name === "w:p") {
        await processParagraph(c, ctx);
        if (ctx.inTable) tables[ctx.tableIndex!].cellParaIndexes.push(paras.length - 1);
      } else if (name === "w:tbl") await processTable(c);
      else if (name === "w:sdt" || name === "w:sdtContent" || name === "w:customXml" || name === "w:ins") await processBlocks(c, ctx);
      else if (name === "w:sectPr") {
        sections.push(await readSectPr(c, sectionFirstPara, paras.length - 1));
        sectionIndex++;
        sectionFirstPara = paras.length;
      }
    }
  };

  const root = parser.parse(documentXml) as XNode[];
  const document = root.find((n) => nodeName(n) === "w:document");
  const body = child(document, "w:body");
  if (!body) throw new Error("Berkas .docx tidak valid (w:body tidak ditemukan).");
  await processBlocks(body, { inTable: false });

  if (!sections.length) {
    sections.push({ index: 0, pageWidth: 595.3, pageHeight: 841.9, headersFooters: [], firstParaIndex: 0, lastParaIndex: paras.length - 1 });
    warnings.push("Dokumen tidak memiliki properti section (w:sectPr).");
  }
  // trailing paragraphs after the last sectPr belong to the last section
  const last = sections[sections.length - 1];
  if (last.lastParaIndex < paras.length - 1) last.lastParaIndex = paras.length - 1;
  for (const p of paras) if (p.sectionIndex >= sections.length) p.sectionIndex = sections.length - 1;

  // estimated printed page numbers: each section restarts at pgNumStart or continues from the previous one
  let lastPrinted = 0;
  let lastPage = 0;
  const secStart = new Map<number, { firstPage: number; start: number }>();
  for (const sec of sections) {
    const own = paras.slice(sec.firstParaIndex, sec.lastParaIndex + 1);
    const first = own.find((x) => x.page !== undefined);
    if (!first) continue;
    const firstPage = first.page!;
    const startsNewPage = firstPage > lastPage;
    const start = sec.pgNumStart ?? (startsNewPage ? lastPrinted + 1 : lastPrinted);
    secStart.set(sec.index, { firstPage, start });
    for (const x of own) if (x.page !== undefined) x.printedPage = start + (x.page - firstPage);
    const lastOwn = [...own].reverse().find((x) => x.printedPage !== undefined);
    if (lastOwn) {
      lastPrinted = lastOwn.printedPage!;
      lastPage = lastOwn.page!;
    }
  }
  const docxPageNumbers = simulatePageNumbers(paras, sections, secStart);
  for (const p of paras) {
    const shown = p.page !== undefined ? docxPageNumbers[p.page - 1] : undefined;
    if (!shown) continue;
    p.printedPageText = shown.text;
    if (shown.value !== undefined) p.printedPage = shown.value; // a typed number wins over the section counter
  }

  return { source: "docx", fileName, paras, tables, sections, docxPageNumbers, fontUsage, warnings };
}

/**
 * What each (estimated) page shows as its page number, the way Word renders it: the page takes the
 * header/footer of the section it starts in, "first" variants apply to a section's first page when
 * Different First Page is on, and a section without a reference of some type inherits it from the
 * previous section. A PAGE field prints the section counter; a typed number prints as-is.
 */
function simulatePageNumbers(paras: Para[], sections: SectionProps[], secStart: Map<number, { firstPage: number; start: number }>): (PageNumberInfo | undefined)[] {
  const pageCount = paras.reduce((m, p) => Math.max(m, p.page ?? 0), 0);
  const ownerOf: (number | undefined)[] = [];
  for (const p of paras) if (p.page !== undefined && ownerOf[p.page - 1] === undefined) ownerOf[p.page - 1] = p.sectionIndex;
  const resolve = (secIndex: number, kind: HeaderFooterInfo["kind"], type: HeaderFooterInfo["type"]) => {
    for (let i = secIndex; i >= 0; i--) {
      const hf = sections[i]?.headersFooters.find((h) => h.kind === kind && h.type === type);
      if (hf) return hf;
    }
    return undefined;
  };
  const out: (PageNumberInfo | undefined)[] = [];
  let owner = 0;
  for (let page = 1; page <= pageCount; page++) {
    owner = ownerOf[page - 1] ?? owner; // a page with no paragraph start continues the previous page's section
    const sec = sections[owner];
    const st = secStart.get(owner);
    if (!sec || !st) continue;
    const type = sec.titlePg && page === st.firstPage ? "first" : "default";
    // header first, as a reader (and the pdf parser) meets it first when both show a number
    const candidates = [resolve(owner, "header", type), resolve(owner, "footer", type)].filter((h): h is HeaderFooterInfo => !!h);
    const field = candidates.find((h) => h.hasPageField);
    const typed = candidates.find((h) => /^(\d{1,3}|[ivxlc]{1,7})$/i.test(h.text.replace(/[\s.\-–]/g, "")));
    const hf = field ?? typed;
    if (!hf) continue;
    let text: string;
    let value: number | undefined;
    if (field) {
      value = st.start + (page - st.firstPage);
      text = sec.pgNumFmt === "lowerRoman" ? toRoman(value).toLowerCase() : sec.pgNumFmt === "upperRoman" ? toRoman(value) : String(value);
    } else {
      text = hf.text.replace(/[\s.\-–]/g, "");
      value = /^\d+$/.test(text) ? parseInt(text, 10) : romanToInt(text);
    }
    const kind: PageNumberInfo["kind"] = /^\d+$/.test(text) ? "arabic" : /^[ivxlc]+$/i.test(text) ? "roman" : "other";
    const horiz = hf.align === "center" ? "center" : hf.align === "right" ? "right" : "left";
    out[page - 1] = {
      text,
      value,
      kind,
      position: `${hf.kind}-${horiz}`,
      font: hf.fonts.find((f) => !isArialNarrow(f)) ?? hf.fonts[0],
      size: hf.sizes.find((s) => Math.abs(s - 12) > 0.6) ?? hf.sizes[0],
      manual: !field || undefined,
    };
  }
  return out;
}

interface RunFlags {
  pageBreak: boolean;
  renderedBreaks: number;
  textSeen: boolean;
  leadingRendered: boolean;
}
interface BlockCtx {
  inTable: boolean;
  tableIndex?: number;
  tableStyleId?: string;
}

function strip<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function collectImages(node: XNode, images: ImageInfo[]) {
  const name = nodeName(node);
  if (name === "mc:AlternateContent") {
    const choice = child(node, "mc:Choice");
    if (choice) collectImages(choice, images);
    return;
  }
  if (name === "w:drawing") {
    for (const c of children(node)) {
      const n = nodeName(c);
      if (n === "wp:inline" || n === "wp:anchor") {
        const extent = child(c, "wp:extent");
        const cx = parseInt(attr(extent, "cx") ?? "0", 10);
        const cy = parseInt(attr(extent, "cy") ?? "0", 10);
        // only count pictures (pic:pic) and graphic frames that contain images; skip pure shapes/textboxes
        const graphic = child(c, "a:graphic");
        const gd = child(graphic, "a:graphicData");
        const uri = attr(gd, "uri") ?? "";
        const isPicture = uri.includes("/picture") || JSON.stringify(gd ?? {}).includes("pic:pic") || JSON.stringify(gd ?? {}).includes("a:blip");
        if (!isPicture) continue;
        images.push({ widthCm: cx / EMU_PER_CM, heightCm: cy / EMU_PER_CM, anchored: n === "wp:anchor" });
      }
    }
    return;
  }
  if (name === "w:pict" || name === "w:object") {
    const json = JSON.stringify(node);
    const m = json.match(/width:([\d.]+)(pt|cm|in);height:([\d.]+)(pt|cm|in)/);
    if (m && json.includes("v:imagedata")) {
      const conv = (v: number, u: string) => (u === "pt" ? v / 28.3465 : u === "in" ? v * 2.54 : v);
      images.push({ widthCm: conv(parseFloat(m[1]), m[2]), heightCm: conv(parseFloat(m[3]), m[4]), anchored: false });
    }
    return;
  }
  for (const c of children(node)) collectImages(c, images);
}

function parseHeaderFooter(
  xml: string,
  kind: "header" | "footer",
  type: HeaderFooterInfo["type"],
  resolveRPr: (direct: RProps, runStyleId: string | undefined, paraStyleId: string | undefined) => RProps,
  resolvePPr: (direct: PProps, styleId: string | undefined) => PProps,
): HeaderFooterInfo {
  const root = parser.parse(xml) as XNode[];
  const hf = root.find((n) => nodeName(n) === `w:${kind === "header" ? "hdr" : "ftr"}`);
  const texts: string[] = [];
  const fonts = new Set<string>();
  const sizes = new Set<number>();
  let hasPageField = false;
  let align: Align | undefined;
  const walk = (n: XNode, paraStyle: string | undefined) => {
    for (const c of children(n)) {
      const name = nodeName(c);
      if (name === "w:p") {
        const pPr = child(c, "w:pPr");
        const sid = attr(child(pPr, "w:pStyle"), "val");
        const pp = resolvePPr(readPPr(pPr), sid);
        const pText = paragraphPlainText(c);
        if (pText.trim() && align === undefined) align = pp.align ?? "left";
        if (pText.trim() || hasFieldPage(c)) align = pp.align ?? align ?? "left";
        walk(c, sid);
      } else if (name === "w:r") {
        const rPr = child(c, "w:rPr");
        const rp = resolveRPr(readRPr(rPr), attr(child(rPr, "w:rStyle"), "val"), paraStyle);
        let t = "";
        for (const rc of children(c)) {
          const rn = nodeName(rc);
          if (rn === "w:t") t += textOf(rc);
          else if (rn === "w:instrText" && /\bPAGE\b/.test(textOf(rc))) hasPageField = true;
        }
        if (t.trim()) {
          texts.push(t);
          if (rp.font) fonts.add(normalizeFontName(rp.font).family);
          if (rp.size) sizes.add(rp.size);
        }
      } else if (name === "w:fldSimple") {
        if (/\bPAGE\b/.test(attr(c, "instr") ?? "")) hasPageField = true;
        walk(c, paraStyle);
      } else if (name === "w:sdt" || name === "w:sdtContent" || name === "w:tbl" || name === "w:tr" || name === "w:tc" || name === "w:hyperlink") walk(c, paraStyle);
    }
  };
  if (hf) walk(hf, undefined);
  return { kind, type, text: texts.join("").replace(/\s+/g, " ").trim(), hasPageField, align, fonts: [...fonts], sizes: [...sizes] };
}

function mathPlainText(n: XNode): string {
  let t = "";
  const walk = (x: XNode) => {
    for (const c of children(x)) {
      const name = nodeName(c);
      if (name === "m:t" || name === "w:t") t += textOf(c);
      else if (name !== "w:rPr" && name !== "m:rPr" && name !== "m:ctrlPr") walk(c);
    }
  };
  walk(n);
  return t.trim();
}

function paragraphPlainText(p: XNode): string {
  let t = "";
  const walk = (n: XNode) => {
    for (const c of children(n)) {
      const name = nodeName(c);
      if (name === "w:t") t += textOf(c);
      else if (name !== "w:rPr" && name !== "w:pPr") walk(c);
    }
  };
  walk(p);
  return t;
}
function hasFieldPage(p: XNode): boolean {
  return /\bPAGE\b/.test(JSON.stringify(p).replace(/\\"/g, '"'));
}
