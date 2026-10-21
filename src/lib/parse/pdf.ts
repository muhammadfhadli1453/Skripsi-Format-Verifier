import * as mupdf from "mupdf";
import type { ImageInfo, NormalizedDoc, PageInfo, PageNumberInfo, Para, Run, SectionProps } from "../model";
import { ptToCm, romanToInt } from "../model";
import { normalizeFontName } from "./fonts";

/** Arial / Arial Narrow single line height ≈ 1.15 × font size in Word. */
const LINE_FACTOR = 1.15;
const HEADER_ZONE = 95; // pt from top edge
const FOOTER_ZONE = 95; // pt from bottom edge

interface Span {
  text: string;
  font: string;
  family: string;
  bold: boolean;
  italic: boolean;
  size: number;
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
  baseline: number;
}

interface Line {
  spans: Span[];
  text: string;
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
  baseline: number;
  size: number; // dominant size
  align: "left" | "center" | "right";
  zone: "header" | "footer" | "body";
  table: boolean;
}


function dominantSize(spans: Span[]): number {
  const byChars = new Map<number, number>();
  for (const s of spans) {
    const n = s.text.replace(/\s/g, "").length;
    if (!n) continue;
    const k = Math.round(s.size * 2) / 2;
    byChars.set(k, (byChars.get(k) ?? 0) + n);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of byChars) if (n > bestN) {
      best = k;
      bestN = n;
    }
  return best || (spans[0]?.size ?? 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function roundSpacing(ratio: number): number | undefined {
  const candidates = [1, 1.15, 1.5, 2, 2.5, 3];
  let best: number | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.abs(ratio - c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= 0.14 ? best : Math.round(ratio * 100) / 100;
}

export async function parsePdf(buffer: Buffer, fileName: string): Promise<NormalizedDoc> {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  const paras: Para[] = [];
  const pages: PageInfo[] = [];
  const fontUsage: Record<string, number> = {};
  const warnings: string[] = [];
  const sections: SectionProps[] = [];

  for (let p = 0; p < pageCount; p++) {
    const page = doc.loadPage(p);
    const [bx0, by0, bx1, by1] = page.getBounds();
    const pageW = bx1 - bx0;
    const pageH = by1 - by0;
    const st = page.toStructuredText("preserve-whitespace,preserve-images");
    const images: ImageInfo[] = [];
    const spans: Span[] = [];
    // char-level walk: the JSON export truncates font sizes to integers, the walk API does not
    let curSpan: (Span & { chars: number }) | undefined;
    const flush = () => {
      if (!curSpan) return;
      const text = curSpan.text.replace(/\u00a0/g, " ");
      if (text.length) {
        const trailing = text.length - text.trimEnd().length;
        if (trailing && curSpan.chars > trailing) {
          // x1 was accumulated from all glyphs; trim the trailing spaces' advance
          const avg = (curSpan.x1 - curSpan.x0) / curSpan.chars;
          curSpan.x1 -= avg * trailing;
        }
        const { chars: _chars, ...span } = curSpan;
        void _chars;
        span.text = text;
        spans.push(span);
        const n = text.replace(/\s/g, "").length;
        if (n) fontUsage[span.family] = (fontUsage[span.family] ?? 0) + n;
      }
      curSpan = undefined;
    };
    st.walk({
      onImageBlock(bbox: number[]) {
        const [x0, y0, x1, y1] = bbox;
        const w = x1 - x0, h = y1 - y0;
        if (w < 4 || h < 4) return;
        images.push({ widthCm: ptToCm(w), heightCm: ptToCm(h), bbox: { x: x0, y: y0, w, h }, page: p + 1 });
      },
      beginLine() {
        flush();
      },
      endLine() {
        flush();
      },
      onChar(c: string, origin: number[], font: { getName(): string; isBold(): boolean; isItalic(): boolean }, size: number, quad: number[]) {
        const rawName = font.getName();
        const sz = Math.round(size * 10) / 10;
        const [ulx, uly, urx, , , lly] = quad;
        const x0 = Math.min(ulx, quad[4]);
        const x1 = Math.max(urx, quad[6]);
        const yTop = Math.min(uly, quad[3]);
        const yBottom = Math.max(lly, quad[7]);
        if (curSpan && curSpan.font === rawName.replace(/^[A-Z]{6}\+/, "") && curSpan.size === sz && Math.abs(curSpan.baseline - origin[1]) < 0.5) {
          curSpan.text += c;
          curSpan.chars++;
          curSpan.x1 = Math.max(curSpan.x1, x1);
          curSpan.x0 = Math.min(curSpan.x0, x0);
          curSpan.yTop = Math.min(curSpan.yTop, yTop);
          curSpan.yBottom = Math.max(curSpan.yBottom, yBottom);
          return;
        }
        flush();
        const fs = normalizeFontName(rawName);
        curSpan = {
          text: c,
          chars: 1,
          font: rawName.replace(/^[A-Z]{6}\+/, ""),
          family: fs.family,
          bold: fs.bold || font.isBold(),
          italic: fs.italic || font.isItalic(),
          size: sz,
          x0,
          x1,
          yTop,
          yBottom,
          baseline: origin[1],
        };
      },
    });
    flush();

    // ---- group spans into visual lines by baseline ----
    spans.sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
    const rawLines: Span[][] = [];
    for (const s of spans) {
      const last = rawLines[rawLines.length - 1];
      if (last && Math.abs(last[0].baseline - s.baseline) <= Math.max(2, s.size * 0.25)) last.push(s);
      else rawLines.push([s]);
    }
    const lines: Line[] = [];
    const segments: Span[][] = [];
    for (const group of rawLines) {
      group.sort((a, b) => a.x0 - b.x0);
      let cur: Span[] = [];
      let lastX1: number | undefined;
      for (const sp of group) {
        if (lastX1 !== undefined && sp.x0 - lastX1 > Math.max(20, sp.size * 1.6) && cur.some((c) => c.text.trim())) {
          segments.push(cur);
          cur = [];
        }
        cur.push(sp);
        if (sp.text.trim()) lastX1 = Math.max(lastX1 ?? -Infinity, sp.x1);
        else if (lastX1 === undefined) lastX1 = undefined;
      }
      if (cur.length) segments.push(cur);
      // "1." + tab + text (list) or "entry …… 12" (table of contents) are not table columns
      const n = segments.length;
      if (n >= 2) {
        const joined = (segs: Span[]) => segs.map((x) => x.text).join("").trim();
        const firstIdx = segments.length - (group.length ? 0 : 0);
        void firstIdx;
        const lastTwo = [segments[n - 2], segments[n - 1]];
        const bothFromThisRow = lastTwo.every((seg) => seg.some((sp) => group.includes(sp)));
        if (bothFromThisRow) {
          const a = joined(lastTwo[0]);
          const b = joined(lastTwo[1]);
          const rowSegs = segments.filter((seg) => seg.some((sp) => group.includes(sp))).length;
          if (rowSegs === 2 && (/^(\d{1,2}[.)]|[a-zA-Z][.)]|[-•–])$/.test(a) || /^([ivxlc]{1,6}|\d{1,3})$/i.test(b))) {
            segments.splice(n - 2, 2, [...lastTwo[0], ...lastTwo[1]]);
          }
        }
      }
    }
    for (const group of segments) {
      // merge text; insert a space when there is a visible gap between spans
      let text = "";
      let prevX1: number | undefined;
      for (const s of group) {
        if (prevX1 !== undefined && s.x0 - prevX1 > Math.max(0.8, s.size * 0.09) && !text.endsWith(" ") && !s.text.startsWith(" ")) text += " ";
        text += s.text;
        prevX1 = s.x1;
      }
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (!trimmed) continue;
      const nonEmpty = group.filter((s) => s.text.trim());
      const x0 = Math.min(...nonEmpty.map((s) => s.x0));
      const x1 = Math.max(...nonEmpty.map((s) => s.x1));
      const yTop = Math.min(...nonEmpty.map((s) => s.yTop));
      const yBottom = Math.max(...nonEmpty.map((s) => s.yBottom));
      const size = dominantSize(nonEmpty);
      const zone: Line["zone"] = yBottom < HEADER_ZONE ? "header" : yTop > pageH - FOOTER_ZONE ? "footer" : "body";
      lines.push({ spans: group, text: trimmed, x0, x1, yTop, yBottom, baseline: group[0].baseline, size, align: "left", zone, table: false });
    }

    // ---- page number detection (not on the cover) ----
    let pageNumber: PageNumberInfo | undefined;
    if (p > 0) {
      for (const ln of lines) {
        if (ln.zone === "body") continue;
        const t = ln.text.replace(/[\s.\-–]/g, "");
        if (!t) continue;
        let kind: PageNumberInfo["kind"] = "other";
        let value: number | undefined;
        if (ln.size > 14) continue;
        if (/^\d{1,3}$/.test(t)) (kind = "arabic"), (value = parseInt(t, 10));
        else if (/^[ivxlc]{1,7}$/i.test(t)) (kind = "roman"), (value = romanToInt(t));
        else continue;
        const cx = (ln.x0 + ln.x1) / 2;
        const horiz = Math.abs(cx - pageW / 2) < 20 ? "center" : cx > pageW / 2 ? "right" : "left";
        const vert = ln.zone === "header" ? "header" : "footer";
        pageNumber = {
          text: t,
          value,
          kind,
          position: `${vert}-${horiz}` as PageNumberInfo["position"],
          font: ln.spans[0]?.family,
          size: ln.size,
        };
        ln.zone = vert; // keep it out of body
        break;
      }
    }

    // anything that is not the page number is treated as body (e.g. the cover year sits in the footer zone)
    const bodyLines = lines.filter((l) => !(pageNumber && l.zone !== "body" && l.text.replace(/[\s.\-–]/g, "") === pageNumber.text));
    for (const l of bodyLines) l.zone = "body";

    // ---- table lines: several segments sharing one baseline ----
    {
      const rows = new Map<number, Line[]>();
      for (const l of bodyLines) {
        const k = Math.round(l.baseline);
        rows.set(k, [...(rows.get(k) ?? []), l]);
      }
      for (const segs of rows.values()) if (segs.length >= 2) for (const l of segs) l.table = true;
      const tableLines = bodyLines.filter((l) => l.table);
      if (tableLines.length) {
        const colXs = [...new Set(tableLines.map((l) => Math.round(l.x0)))];
        const widthAll = Math.max(...bodyLines.map((l) => l.x1)) - Math.min(...bodyLines.map((l) => l.x0));
        for (const l of bodyLines) {
          if (l.table) continue;
          if (l.x1 - l.x0 > widthAll * 0.8) continue;
          if (!colXs.some((x) => Math.abs(x - l.x0) <= 3)) continue;
          const near = tableLines.some((t) => Math.abs(t.baseline - l.baseline) < Math.max(t.size, l.size) * 1.15 * 1.7);
          if (near) l.table = true;
        }
      }
    }

    // ---- text bounds & alignment classes ----
    let textBounds: PageInfo["textBounds"];
    const modeOf = (vals: number[], fallback: number): { value: number; count: number } => {
      const freq = new Map<number, number>();
      for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
      let best = fallback;
      let bestN = 0;
      for (const [v, n] of freq) if (n > bestN) {
      best = v;
      bestN = n;
    }
      return { value: best, count: bestN };
    };
    const x0Freq = new Map<number, number>();
    if (bodyLines.length) {
      const xs0 = bodyLines.map((l) => Math.round(l.x0));
      const xs1 = bodyLines.map((l) => Math.round(l.x1));
      for (const x of xs0) x0Freq.set(x, (x0Freq.get(x) ?? 0) + 1);
      const minX = Math.min(...xs0);
      const maxX = Math.max(...xs1);
      const leftMode = modeOf(xs0, minX);
      const rightMode = modeOf(xs1, maxX);
      textBounds = {
        x0: leftMode.count >= 3 ? Math.min(leftMode.value, minX + 1) : minX,
        x1: rightMode.count >= 3 ? rightMode.value : maxX,
        yTop: Math.min(...bodyLines.map((l) => l.yTop)),
        yBottom: Math.max(...bodyLines.map((l) => l.yBottom)),
      };
      // the left mode may be an indented first line; prefer the smaller frequent edge
      if (leftMode.count >= 3) {
        for (const [x, n] of x0Freq) if (n >= 2 && x < textBounds.x0 && textBounds.x0 - x < 60) textBounds.x0 = x;
      }
      const pageCenter = pageW / 2;
      const textCenter = (textBounds.x0 + textBounds.x1) / 2;
      for (const l of bodyLines) {
        const c = (l.x0 + l.x1) / 2;
        const width = l.x1 - l.x0;
        const leftGap = l.x0 - textBounds.x0;
        const rightGap = textBounds.x1 - l.x1;
        const sharesLeft = (x0Freq.get(Math.round(l.x0)) ?? 0) >= 2 && leftGap < 50;
        const nearCenter = Math.abs(c - pageCenter) < 7 || Math.abs(c - textCenter) < 7;
        const strictCenter = Math.abs(c - pageCenter) < 5 || Math.abs(c - textCenter) < 5;
        if (nearCenter && (!sharesLeft || (strictCenter && leftGap > 40 && rightGap > 40))) l.align = "center";
        else if (rightGap < 6 && leftGap > 40 && width < (textBounds.x1 - textBounds.x0) * 0.75) l.align = "right";
        else l.align = "left";
      }
    }

    // ---- group lines into paragraphs ----
    bodyLines.sort((a, b) => a.yTop - b.yTop || a.x0 - b.x0);
    const pitches: number[] = [];
    for (let i = 1; i < bodyLines.length; i++) {
      const d = bodyLines[i].baseline - bodyLines[i - 1].baseline;
      if (d > 2 && d < 60) pitches.push(d);
    }
    const typicalPitch = median(pitches) || 14;
    const rightEdge = textBounds?.x1 ?? pageW;

    const groups: Line[][] = [];
    const isCover = p === 0;
    for (let i = 0; i < bodyLines.length; i++) {
      const ln = bodyLines[i];
      const prev = i > 0 ? bodyLines[i - 1] : undefined;
      const cur = groups[groups.length - 1];
      let newPara = !prev || !cur;
      if (prev && cur) {
        const delta = ln.baseline - prev.baseline;
        const expected = Math.max(prev.size, ln.size) * LINE_FACTOR;
        const curPitch = cur.length >= 2 ? median(cur.slice(1).map((l, k) => l.baseline - cur[k].baseline)) : undefined;
        const sizeChange = Math.abs(ln.size - prev.size) > 0.6;
        const alignChange = ln.align !== prev.align;
        let gapThreshold: number;
        if (isCover) gapThreshold = expected * 1.35;
        else if (curPitch) gapThreshold = curPitch * 1.35;
        else gapThreshold = Math.max(expected * 2.25, typicalPitch * 1.35);
        const bigGap = delta > gapThreshold;
        const prevShort = prev.x1 < rightEdge - 25 && prev.align !== "center";
        const indented = ln.x0 > prev.x0 + 6 && prev.align !== "center";
        const sameRow = Math.abs(delta) < 2; // side by side (table cells)
        if (ln.table || prev.table) {
          newPara = !(ln.table && prev.table && Math.abs(ln.x0 - prev.x0) < 3 && delta < expected * 1.6 && !sameRow);
          if (newPara) groups.push([ln]);
          else cur.push(ln);
          continue;
        }
        const continuation = cur.length >= 2 && Math.abs(ln.x0 - cur[1].x0) < 2.5 && !bigGap && !sizeChange;
        if (sameRow) newPara = true;
        else if (continuation) newPara = false;
        else if (sizeChange || alignChange || bigGap) newPara = true;
        else if (prev.align === "center") newPara = false;
        else if (prevShort) newPara = true;
        else if (indented && ln.x0 > (textBounds?.x0 ?? 0) + 6) newPara = true;
        // hanging indent continuation (references / list items): first line at margin, next line indented
        const prevGroup = groups.length >= 2 ? groups[groups.length - 2] : undefined;
        const prevGroupHanging = !!prevGroup && prevGroup.length >= 2 && Math.min(...prevGroup.slice(1).map((l) => l.x0)) > prevGroup[0].x0 + 6;
        const hangingRange = ln.x0 - prev.x0 > 6 && ln.x0 - prev.x0 < 45;
        const prevEndsSentence = /[.!?:]["”’)]?$/.test(prev.text);
        if (!sameRow && indented && cur.length === 1 && hangingRange && !sizeChange && !bigGap && (!prevEndsSentence || /^[a-z0-9(&]/.test(ln.text) || prevGroupHanging)) newPara = false;
        // a line ending with ":" followed by a capitalised line is a new paragraph (lists, "sebagai berikut:")
        if (prev.text.endsWith(":") && /^[A-Z0-9]/.test(ln.text) && !indented) newPara = true;
        if (/^BAB\s+[IVX]+\b/.test(ln.text)) newPara = true;
        // a caption line ends its paragraph unless the next line is a centered continuation
        if (/^(Gambar|Tabel)\s+\d+[.,]\d+/.test(prev.text) && cur.length === 1 && (ln.align !== "center" || ln.x0 < prev.x0 - 20)) newPara = true;
        // list items / numbered headings: a line starting with a marker at the left margin is a new paragraph
        if (/^(\d{1,2}[.)]|[a-z][.)]|[-•–]|\d+(\.\d+)+\.?)\s/.test(ln.text) && Math.abs(ln.x0 - (textBounds?.x0 ?? 0)) < 8) newPara = true;
        // bold ↔ regular change (heading vs body)
        const boldOf = (l: Line) => {
          let b = 0, t = 0;
          for (const sp of l.spans) { const n = sp.text.replace(/\s/g, "").length; t += n; if (sp.bold) b += n; }
          return t ? b / t : 0;
        };
        if (!sameRow && Math.abs(boldOf(ln) - boldOf(prev)) > 0.7) newPara = true;
      }
      if (newPara) groups.push([ln]);
      else cur.push(ln);
    }

    const firstParaIndex = paras.length;
    for (const g of groups) {
      const runs: Run[] = [];
      for (let li = 0; li < g.length; li++) {
        const ln = g[li];
        let prevX1: number | undefined;
        for (const s of ln.spans) {
          const last = runs[runs.length - 1];
          let txt = s.text;
          if (prevX1 !== undefined && s.x0 - prevX1 > Math.max(0.8, s.size * 0.09) && last && !last.text.endsWith(" ") && !txt.startsWith(" ")) txt = " " + txt;
          prevX1 = s.x1;
          if (!txt.trim()) {
            if (last && !last.text.endsWith(" ")) last.text += " ";
            continue;
          }
          if (last && last.font === s.family && last.size === s.size && last.bold === s.bold && last.italic === s.italic) last.text += txt;
          else runs.push({ text: txt, font: s.family, size: s.size, bold: s.bold, italic: s.italic });
        }
        if (li < g.length - 1) {
          const last = runs[runs.length - 1];
          if (last && !last.text.endsWith(" ")) last.text += " ";
        }
      }
      const text = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
      const x0 = Math.min(...g.map((l) => l.x0));
      const x1 = Math.max(...g.map((l) => l.x1));
      const yTop = Math.min(...g.map((l) => l.yTop));
      const yBottom = Math.max(...g.map((l) => l.yBottom));
      const size = dominantSize(g.flatMap((l) => l.spans.filter((sp) => sp.text.trim())));
      let linePitch: number | undefined;
      let lineSpacing: number | undefined;
      if (g.length >= 2) {
        linePitch = median(g.slice(1).map((l, k) => l.baseline - g[k].baseline));
        lineSpacing = roundSpacing(linePitch / (size * LINE_FACTOR));
      }
      const centered = g.every((l) => l.align === "center");
      const right = g.every((l) => l.align === "right");
      let justified: boolean | undefined;
      if (g.length >= 2 && !centered) {
        const full = g.slice(0, -1).filter((l) => l.x1 >= rightEdge - 6).length;
        justified = full >= Math.max(1, Math.ceil((g.length - 1) * 0.7));
      }
      const bodyX = g.length >= 2 ? median(g.slice(1).map((l) => l.x0)) : g[0].x0;
      const para: Para = {
        index: paras.length,
        text,
        textLines: g.map((l) => l.text),
        runs,
        page: p + 1,
        align: centered ? "center" : right ? "right" : justified ? "both" : "left",
        lineSpacing,
        linePitch,
        bbox: { x0, x1, yTop, yBottom },
        firstLineX: g[0].x0,
        bodyLineX: bodyX,
        lineCount: g.length,
        lineBaselines: g.map((l) => l.baseline),
        justified,
        images: [],
        inTable: g[0].table,
        sectionIndex: 0,
        isEmpty: text.length === 0,
        zone: "body",
      };
      if (textBounds) {
        para.firstLineIndent = g[0].x0 - textBounds.x0;
        para.leftIndent = bodyX - textBounds.x0;
        if (g.length >= 2 && bodyX > g[0].x0 + 4) para.hangingIndent = bodyX - g[0].x0;
      }
      paras.push(para);
    }
    // attach images to the nearest paragraph below them (caption candidates)
    for (const img of images) {
      const bb = img.bbox!;
      let best: Para | undefined;
      let bestD = Infinity;
      for (let i = firstParaIndex; i < paras.length; i++) {
        const pr = paras[i];
        const d = pr.bbox!.yTop - (bb.y + bb.h);
        if (d >= -6 && d < bestD) {
      bestD = d;
      best = pr;
    }
      }
      if (best && bestD < 70) best.images.push(img);
    }

    pages.push({
      number: p + 1,
      width: pageW,
      height: pageH,
      textBounds,
      pageNumber,
      firstParaIndex,
      lastParaIndex: paras.length - 1,
      images,
    });
    if (pageNumber) for (let i = firstParaIndex; i < paras.length; i++) paras[i].printedPageText = pageNumber.text;
    sections.push({
      index: p,
      pageWidth: pageW,
      pageHeight: pageH,
      headersFooters: [],
      firstParaIndex,
      lastParaIndex: paras.length - 1,
    });
    for (let i = firstParaIndex; i < paras.length; i++) paras[i].sectionIndex = p;
  }

  if (!paras.length) warnings.push("Tidak ada teks yang dapat diekstrak dari PDF (kemungkinan hasil scan/gambar).");

  return { source: "pdf", fileName, paras, tables: [], sections, pages, fontUsage, warnings };
}
