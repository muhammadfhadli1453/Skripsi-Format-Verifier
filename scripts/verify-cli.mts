import fs from "node:fs";
import { analyze } from "../src/lib/verify";
const file = process.argv[2];
const json = process.argv.includes("--json");
const { report } = await analyze(fs.readFileSync(file), file, { docType: "auto" });
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.fileName} [${report.source}] type=${report.docType} (detected ${report.detectedDocType}) pages=${report.pageCount} paras=${report.paragraphCount} ${report.durationMs}ms`);
  console.log("sections:", report.sections.map((s) => `${s.label}${s.firstPage ? `@${s.firstPage}` : ""}`).join(" | "));
  console.log(`errors=${report.summary.errors} warnings=${report.summary.warnings} infos=${report.summary.infos} score=${report.summary.score}`);
  for (const i of report.issues) {
    const loc = [i.location.page ? `p${i.location.page}` : "", i.location.section ?? ""].filter(Boolean).join(" ");
    console.log(`\n[${i.severity.toUpperCase()}] ${i.id} ${i.title}  (${loc})${i.occurrences?.length ? ` +${i.occurrences.length}` : ""}`);
    console.log(`   ${i.detail.slice(0, 300)}`);
    if (i.location.snippet) console.log(`   ↳ "${i.location.snippet.slice(0, 100)}"`);
  }
}
