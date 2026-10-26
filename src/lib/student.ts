import type { LogicalSection, NormalizedDoc } from "./model";

export interface StudentInfo {
  name?: string;
  studentId?: string;
}

const NPM_RE = /^(?:NPM|NIM)?\s*[:.]?\s*(\d[\d\s]{6,18}\d)$/i;

const toTitle = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

function cleanName(raw: string | undefined): string | undefined {
  const s = raw?.replace(/^(nama|oleh)\s*[:.]?\s*/i, "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 2 || s.length > 60 || /\d/.test(s) || !/\p{L}/u.test(s)) return undefined;
  // covers often write the name in capitals even though the guideline asks for Capitalize Each Word
  return s === s.toUpperCase() ? toTitle(s) : s;
}

function cleanNpm(raw: string | undefined): string | undefined {
  const m = raw?.trim().match(NPM_RE);
  const digits = m?.[1].replace(/\s/g, "");
  return digits && digits.length >= 8 && digits.length <= 16 ? digits : undefined;
}

/**
 * Reads the student's name and NPM from the cover, using the layout the cover
 * rules expect: OLEH, then the name, then the NPM. Falls back to the first
 * NPM-like line on the cover (name = the line above it) when OLEH is missing.
 */
export function extractStudent(doc: NormalizedDoc, sections: LogicalSection[]): StudentInfo {
  const cover = sections.find((s) => s.kind === "cover");
  if (!cover) return {};
  const lines = doc.paras
    .slice(cover.firstParaIndex, cover.lastParaIndex + 1)
    .filter((p) => !p.isEmpty)
    .flatMap((p) => p.textLines.map((l) => l.trim()).filter(Boolean));
  const oleh = lines.findIndex((l, i) => i > 0 && /^OLEH$/i.test(l));
  if (oleh > 0) {
    const name = cleanName(lines[oleh + 1]);
    const studentId = cleanNpm(lines[oleh + 2]) ?? cleanNpm(lines[oleh + 1]);
    if (name || studentId) return { name, studentId };
  }
  const npmAt = lines.findIndex((l) => cleanNpm(l));
  if (npmAt < 0) return {};
  return { name: npmAt > 0 ? cleanName(lines[npmAt - 1]) : undefined, studentId: cleanNpm(lines[npmAt]) };
}
