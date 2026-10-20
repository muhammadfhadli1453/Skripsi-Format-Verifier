import type { DocType, Issue, LogicalSection, NormalizedDoc } from "../model";
import { createContext } from "./context";
import { layoutRules } from "./layout";
import { coverRules } from "./cover";
import { frontMatterRules } from "./frontmatter";
import { bodyRules } from "./body";
import { pageNumberRules } from "./pagenumbers";
import { referenceRules } from "./references";

const SEV_RANK = { error: 0, warning: 1, info: 2 };

export function runRules(doc: NormalizedDoc, docType: DocType, sections: LogicalSection[]): Issue[] {
  const ctx = createContext(doc, docType, sections);
  const steps: [string, (c: typeof ctx) => void][] = [
    ["layout", layoutRules],
    ["cover", coverRules],
    ["frontmatter", frontMatterRules],
    ["body", bodyRules],
    ["pagenumbers", pageNumberRules],
    ["references", referenceRules],
  ];
  for (const [name, fn] of steps) {
    try {
      fn(ctx);
    } catch (err) {
      ctx.c.info("SYS-01", "Sistem", `Pemeriksaan "${name}" gagal dijalankan`, `Terjadi kesalahan internal: ${(err as Error).message}`, {});
    }
  }
  const issues = ctx.c.issues.filter((i) => i.detail || i.title);
  issues.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.location.page ?? 0) - (b.location.page ?? 0) || (a.location.paraIndex ?? 0) - (b.location.paraIndex ?? 0));
  return issues;
}
