import type { LogicalSection, NormalizedDoc } from "./model";

export interface StudentInfo {
  name?: string;
  studentId?: string;
}

const NPM_RE = /^(?:NPM|NIM)?\s*[:.]?\s*(\d[\d\s]{6,18}\d)$/i;

const toTitle = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

/**
 * "Haerani Ramli 07352211013" → name + NPM. Some covers put both in one
 * paragraph and rely on wide indents to wrap the NPM onto its own line.
 */
export function splitNameNpm(text: string): { name: string; npm: string } | undefined {
  const m = text.trim().match(/^(\D*\p{L}\D*?)\s+(\d{8,16})$/u);
  return m ? { name: m[1].trim(), npm: m[2] } : undefined;
}

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
    const joined = splitNameNpm(lines[oleh + 1] ?? "");
    if (joined) return { name: cleanName(joined.name), studentId: cleanNpm(joined.npm) };
    const name = cleanName(lines[oleh + 1]);
    const studentId = cleanNpm(lines[oleh + 2]) ?? cleanNpm(lines[oleh + 1]);
    if (name || studentId) return { name, studentId };
  }
  const npmAt = lines.findIndex((l) => cleanNpm(l));
  if (npmAt < 0) {
    const joined = lines.map(splitNameNpm).find(Boolean);
    return joined ? { name: cleanName(joined.name), studentId: cleanNpm(joined.npm) } : {};
  }
  return { name: npmAt > 0 ? cleanName(lines[npmAt - 1]) : undefined, studentId: cleanNpm(lines[npmAt]) };
}
