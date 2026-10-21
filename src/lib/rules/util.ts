import type { Issue, IssueLocation, Para, Run, Severity } from "../model";
import { ptToCm } from "../model";

export const CONJUNCTIONS = new Set([
  "dan", "pada", "di", "ke", "dari", "untuk", "dengan", "terhadap", "dalam", "atau", "yang", "sebagai", "berbasis", "menggunakan", "melalui", "oleh", "bagi", "antara", "serta", "guna", "secara", "atas", "akan", "tentang", "bagi", "hingga", "sampai", "maupun", "versus",
]);

/** True connecting words/prepositions that stay lowercase inside titles (PPTA 4.2.1.2, e.g. "Alat dan Bahan"). */
export const TITLE_LOWERCASE = new Set(["dan", "atau", "di", "ke", "dari", "pada", "untuk", "dengan", "terhadap", "dalam", "yang", "sebagai", "oleh", "bagi", "antara", "serta", "tentang", "hingga", "sampai", "maupun", "tetapi", "namun", "agar", "supaya", "karena", "akan", "atas", "per", "secara"]);

export function words(s: string): string[] {
  return s.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

export function hasLetters(s: string): boolean {
  return /[A-Za-zÀ-ÿ]/.test(s);
}

export function isUpperCase(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

export function isLowerCase(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters.length > 0 && letters === letters.toLowerCase();
}

/** Capitalize Each Word check. Returns offending words. */
export function titleCaseViolations(s: string, opts: { allowLowerConjunctions?: boolean; allowAcronyms?: boolean } = {}): string[] {
  const bad: string[] = [];
  const ws = words(s);
  ws.forEach((raw, idx) => {
    const w = raw.replace(/^[("'“‘\[]+|[)"'”’\]:;,.]+$/g, "");
    if (!hasLetters(w)) return;
    if (/^\d/.test(w)) return;
    const lower = w.toLowerCase();
    if (opts.allowLowerConjunctions && idx > 0 && CONJUNCTIONS.has(lower)) return;
    if (/^[A-Z0-9][A-Za-z0-9\-/.]*$/.test(w)) return; // starts uppercase
    bad.push(raw);
  });
  return bad;
}

export function dominantSize(p: Para): number | undefined {
  const byChars = new Map<number, number>();
  for (const r of p.runs) {
    if (r.size === undefined) continue;
    const n = r.text.replace(/\s/g, "").length;
    if (!n) continue;
    byChars.set(r.size, (byChars.get(r.size) ?? 0) + n);
  }
  let best: number | undefined;
  let bestN = -1;
  for (const [k, n] of byChars) if (n > bestN) {
      best = k;
      bestN = n;
    }
  return best;
}

export function dominantFont(p: Para): string | undefined {
  const byChars = new Map<string, number>();
  for (const r of p.runs) {
    if (!r.font) continue;
    const n = r.text.replace(/\s/g, "").length;
    if (!n) continue;
    byChars.set(r.font, (byChars.get(r.font) ?? 0) + n);
  }
  let best: string | undefined;
  let bestN = -1;
  for (const [k, n] of byChars) if (n > bestN) {
      best = k;
      bestN = n;
    }
  return best;
}

export function charCount(r: Run): number {
  return r.text.replace(/\s/g, "").length;
}

export function isMostlyBold(p: Para, ratio = 0.8): boolean {
  let bold = 0;
  let total = 0;
  for (const r of p.runs) {
    const n = charCount(r);
    total += n;
    if (r.bold) bold += n;
  }
  return total > 0 && bold / total >= ratio;
}

export function isMostlyItalic(p: Para, ratio = 0.8): boolean {
  let it = 0;
  let total = 0;
  for (const r of p.runs) {
    const n = charCount(r);
    total += n;
    if (r.italic) it += n;
  }
  return total > 0 && it / total >= ratio;
}

export function fmtCm(pt: number | undefined, digits = 2): string {
  if (pt === undefined) return "?";
  return `${ptToCm(pt).toFixed(digits)} cm`;
}

export function fmtSpacing(v: number | undefined): string {
  if (v === undefined) return "tidak diketahui";
  return v.toFixed(v % 1 === 0 ? 1 : 2).replace(".", ",");
}

export function snippet(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function locOf(p: Para, sectionLabel?: string, snip?: string): IssueLocation {
  return { page: p.page, printedPage: p.printedPageText, paraIndex: p.index, section: sectionLabel, snippet: snip ?? snippet(p.text) };
}

type Extra = Partial<Omit<Issue, "id" | "severity" | "category" | "title" | "detail" | "location">> & { fold?: boolean; foldKey?: string };

/**
 * Collects issues and folds repeated occurrences of the same rule+title
 * into a single issue with an occurrences list.
 */
export class Collector {
  readonly issues: Issue[] = [];
  private byKey = new Map<string, Issue>();

  add(issue: Omit<Issue, "occurrences" | "source"> & { foldKey?: string }, opts: { fold?: boolean } = {}): void {
    const { foldKey, ...rest } = issue;
    const key = foldKey ?? (opts.fold ? `${rest.id}::${rest.title}` : undefined);
    if (key) {
      const existing = this.byKey.get(key);
      if (existing) {
        existing.occurrences = existing.occurrences ?? [];
        if (existing.occurrences.length < 40) existing.occurrences.push(rest.location);
        return;
      }
      const created: Issue = { ...rest, source: "rule", occurrences: [] };
      this.byKey.set(key, created);
      this.issues.push(created);
      return;
    }
    this.issues.push({ ...rest, source: "rule" });
  }

  error(id: string, category: string, title: string, detail: string, location: IssueLocation, extra: Extra = {}) {
    this.push("error", id, category, title, detail, location, extra);
  }
  warn(id: string, category: string, title: string, detail: string, location: IssueLocation, extra: Extra = {}) {
    this.push("warning", id, category, title, detail, location, extra);
  }
  info(id: string, category: string, title: string, detail: string, location: IssueLocation, extra: Extra = {}) {
    this.push("info", id, category, title, detail, location, extra);
  }
  private push(severity: Severity, id: string, category: string, title: string, detail: string, location: IssueLocation, extra: Extra) {
    const { fold, foldKey, ...rest } = extra;
    this.add({ id, severity, category, title, detail, location, ...rest, foldKey }, { fold: fold || !!foldKey });
  }
}

export function approxEq(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
