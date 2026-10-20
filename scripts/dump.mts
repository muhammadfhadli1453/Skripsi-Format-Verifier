import fs from "node:fs";
import { parseDocument } from "../src/lib/parse";
const file = process.argv[2];
const pagesWanted = process.argv.slice(3).map(Number);
const buf = fs.readFileSync(file);
const doc = await parseDocument(buf, file);
console.log("source", doc.source, "paras", doc.paras.length, "pages", doc.pages?.length, "sections", doc.sections.length);
console.log("fonts", doc.fontUsage);
for (const s of doc.sections) console.log("section", s.index, s.margins && Object.fromEntries(Object.entries(s.margins).map(([k, v]) => [k, (v / 28.3465).toFixed(2)])), s.pgNumFmt, s.pgNumStart, s.titlePg, s.headersFooters.map((h) => `${h.kind}/${h.type}:${h.text}|${h.hasPageField}|${h.align}|${h.fonts}|${h.sizes}`));
for (const pg of doc.pages ?? []) if (pagesWanted.includes(pg.number)) console.log("PAGE", pg.number, pg.textBounds, pg.pageNumber, pg.images.map((i) => `${i.widthCm.toFixed(2)}x${i.heightCm.toFixed(2)}`));
for (const p of doc.paras) {
  if (pagesWanted.length && (!p.page || !pagesWanted.includes(p.page))) continue;
  const fonts = [...new Set(p.runs.map((r) => `${r.font}${r.bold ? "/B" : ""}${r.italic ? "/I" : ""}@${r.size}`))].join(",");
  console.log(`#${p.index} p${p.page ?? "?"} s${p.sectionIndex} ${p.align ?? "-"} ls=${p.lineSpacing ?? "-"} sb=${p.spaceBefore ?? "-"} sa=${p.spaceAfter ?? "-"} ind=${p.firstLineIndent?.toFixed(0) ?? "-"}/${p.leftIndent?.toFixed(0) ?? "-"} ln=${p.lineCount ?? "-"} ${p.inTable ? "[T]" : ""}${p.images.length ? "[IMG " + p.images.map((i) => i.widthCm.toFixed(1) + "x" + i.heightCm.toFixed(1)).join(" ") + "]" : ""} {${fonts}} :: ${p.text.slice(0, 80)}`);
}
