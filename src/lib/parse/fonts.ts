/** Normalize raw PDF/DOCX font names to a family + style. */
export interface FontStyle {
  family: string;
  bold: boolean;
  italic: boolean;
}

const FAMILY_MAP: Record<string, string> = {
  arialnarrow: "Arial Narrow",
  arial: "Arial",
  arialmt: "Arial",
  timesnewroman: "Times New Roman",
  timesnewromanps: "Times New Roman",
  timesnewromanpsmt: "Times New Roman",
  times: "Times New Roman",
  calibri: "Calibri",
  calibrilight: "Calibri Light",
  cambria: "Cambria",
  cambriamath: "Cambria Math",
  symbol: "Symbol",
  symbolmt: "Symbol",
  wingdings: "Wingdings",
  couriernew: "Courier New",
  couriernewpsmt: "Courier New",
  segoeui: "Segoe UI",
  helvetica: "Helvetica",
  verdana: "Verdana",
  tahoma: "Tahoma",
  georgia: "Georgia",
  consolas: "Consolas",
};

/** Fonts that are legitimately used inside equations / symbols. */
export const MATH_FONT_FAMILIES = new Set(["Cambria Math", "Symbol", "Wingdings", "MT Extra"]);

export function normalizeFontName(raw: string | undefined): FontStyle {
  if (!raw) return { family: "?", bold: false, italic: false };
  let name = raw.replace(/^[A-Z]{6}\+/, ""); // subset prefix ABCDEF+
  name = name.replace(/\s+/g, " ").trim();
  const lower = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold/.test(lower) || /[,-]b(d)?$/.test(lower);
  const italic = /italic|oblique/.test(lower) || /[,-](bi|i)$/.test(lower);
  // strip style decorations
  let base = name
    .replace(/[-,_ ]?(Bold|Italic|BoldItalic|Oblique|Regular|Black|Light|SemiBold|DemiBold|Medium)+(MT)?$/i, "")
    .replace(/[-,_ ]?(Bold|Italic|Oblique|Regular)+/gi, "")
    .replace(/(PSMT|PS|MT)$/, "")
    .replace(/[-,_]/g, " ")
    .trim();
  const key = base.replace(/\s+/g, "").toLowerCase();
  const mapped = FAMILY_MAP[key] ?? FAMILY_MAP[key.replace(/mt$/, "")];
  if (!mapped) {
    // insert spaces before capitals: "ArialNarrow" -> "Arial Narrow"
    base = base.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return { family: mapped ?? base, bold, italic };
}

export function isArialNarrow(family: string | undefined): boolean {
  if (!family) return false;
  return family.replace(/\s+/g, "").toLowerCase() === "arialnarrow";
}
