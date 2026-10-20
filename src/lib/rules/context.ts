import type { DocType, LogicalSection, NormalizedDoc, Para, SectionKind } from "../model";
import { Collector } from "./util";

export interface RuleContext {
  doc: NormalizedDoc;
  docType: DocType;
  sections: LogicalSection[];
  c: Collector;
  isPdf: boolean;
  /** logical section of a paragraph */
  sectionOf(paraIndex: number): LogicalSection | undefined;
  /** non-empty paragraphs of a logical section (heading excluded) */
  parasOf(section: LogicalSection): Para[];
  /** non-empty paragraphs for all sections of a kind */
  parasOfKind(kind: SectionKind): Para[];
  /** all paragraphs of the cover (including empties) */
  coverParas(): Para[];
  /** cover title (uppercase, joined) if detectable */
  coverTitle?: string;
  /** label for an issue location */
  labelOf(paraIndex: number): string | undefined;
}

export function createContext(doc: NormalizedDoc, docType: DocType, sections: LogicalSection[]): RuleContext {
  const byPara = new Array<LogicalSection | undefined>(doc.paras.length);
  for (const s of sections) for (let i = s.firstParaIndex; i <= s.lastParaIndex; i++) byPara[i] = s;
  const ctx: RuleContext = {
    doc,
    docType,
    sections,
    c: new Collector(),
    isPdf: doc.source === "pdf",
    sectionOf: (i) => byPara[i],
    parasOf: (s) => doc.paras.slice(s.firstParaIndex, s.lastParaIndex + 1).filter((p) => !p.isEmpty && p.index !== s.headingParaIndex),
    parasOfKind: (kind) => sections.filter((s) => s.kind === kind).flatMap((s) => ctx.parasOf(s)),
    coverParas: () => {
      const cov = sections.find((s) => s.kind === "cover");
      return cov ? doc.paras.slice(cov.firstParaIndex, cov.lastParaIndex + 1) : [];
    },
    labelOf: (i) => byPara[i]?.label,
  };
  return ctx;
}
