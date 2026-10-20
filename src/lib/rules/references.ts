import type { RuleContext } from "./context";
import { fmtSpacing, isUpperCase, locOf, snippet } from "./util";

const CAT = "Daftar Pustaka";

export function referenceRules(ctx: RuleContext) {
  const { c, doc } = ctx;
  const sec = ctx.sections.find((s) => s.kind === "daftar-pustaka");
  if (!sec) return;
  const entries = ctx.parasOf(sec).filter((p) => p.text.length > 20 && !p.inTable);
  const loc = entries[0] ? locOf(entries[0], sec.label) : {};
  if (!entries.length) {
    c.error("REF-01", CAT, "Daftar pustaka kosong", "Tidak ada entri referensi yang terbaca.", loc);
    return;
  }
  // alphabetical order
  const keys = entries.map((p) => p.text.toLowerCase().replace(/^[^a-z]+/, "").slice(0, 3));
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] < keys[i - 1] && keys[i][0] !== keys[i - 1][0]) {
      c.warn("REF-02", CAT, "Daftar pustaka tidak urut alfabet", `"${snippet(entries[i].text, 50)}" muncul setelah "${snippet(entries[i - 1].text, 50)}".`, locOf(entries[i], sec.label), { fold: true });
    }
  }
  // formatting
  for (const p of entries) {
    if (isUpperCase(p.text) && p.text.length > 30) c.warn("REF-03", CAT, "Entri daftar pustaka ditulis kapital seluruhnya", `"${snippet(p.text, 60)}" — jangan gunakan huruf besar semua; hanya huruf awal yang kapital.`, locOf(p, sec.label), { fold: true });
    if (!/\b(19|20)\d{2}[a-z]?\b/.test(p.text)) c.warn("REF-04", CAT, "Tahun terbit tidak ditemukan pada entri", `"${snippet(p.text, 60)}".`, locOf(p, sec.label), { fold: true });
    const multi = ctx.isPdf ? (p.lineCount ?? 1) >= 2 : true;
    if (multi && !(p.hangingIndent && p.hangingIndent > 8)) c.warn("REF-05", CAT, "Entri daftar pustaka tanpa hanging indent", `"${snippet(p.text, 50)}" — baris lanjutan entri harus menjorok (Paragraph → Special: Hanging ± 1 cm) seperti contoh panduan.`, locOf(p, sec.label), { fold: true });
    if (multi && p.lineSpacing !== undefined && Math.abs(p.lineSpacing - 1.5) > 0.12) c.warn("REF-06", CAT, "Line spacing daftar pustaka bukan 1,5", `"${snippet(p.text, 50)}" menggunakan ${fmtSpacing(p.lineSpacing)}; panduan jarak 1,5 line.`, locOf(p, sec.label), { fold: true });
  }
  // citation ↔ reference cross-check
  const refText = entries.map((p) => p.text).join("\n").toLowerCase();
  const bodyText = ctx.sections.filter((s) => s.kind === "bab").flatMap((s) => ctx.parasOf(s)).map((p) => p.text).join(" \n ");
  const cited = new Map<string, { author: string; year: string; sample: string }>();
  for (const m of bodyText.matchAll(/\(([^()]{2,80}?),?\s*((?:19|20)\d{2})[a-z]?\)/g)) {
    const inner = m[1].replace(/\b(dkk|et al)\.?/gi, "").replace(/[.,;]+$/g, "").trim();
    // multiple citations "(A, 2020; B, 2021)" – take last token group before year
    const author = inner.split(/[;]/).pop()?.split(/,|&|\bdan\b/).map((x) => x.trim()).filter(Boolean)[0] ?? "";
    const surname = author.split(/\s+/).pop() ?? "";
    if (surname.length < 3 || /^\d/.test(surname)) continue;
    cited.set(`${surname.toLowerCase()}|${m[2]}`, { author: surname, year: m[2], sample: m[0] });
  }
  const notFound = [...cited.values()].filter((x) => !(refText.includes(x.author.toLowerCase()) && refText.includes(x.year)));
  if (notFound.length) c.warn("REF-07", CAT, `${notFound.length} sitasi tidak ditemukan di daftar pustaka`, `Contoh: ${notFound.slice(0, 8).map((x) => x.sample).join(", ")}${notFound.length > 8 ? ", …" : ""}. Pastikan setiap sumber yang dikutip tercantum di Daftar Pustaka (nama penulis dan tahun sama).`, loc);
  // references never cited
  const bodyLower = bodyText.toLowerCase();
  const uncited = entries.filter((p) => {
    const m = p.text.match(/^([A-Za-zÀ-ÿ'’\-]+)/);
    const year = p.text.match(/\b((?:19|20)\d{2})[a-z]?\b/)?.[1];
    if (!m || !year) return false;
    const surname = m[1].toLowerCase();
    return !(bodyLower.includes(surname) && new RegExp(`${surname}[^()]{0,60}${year}`).test(bodyLower));
  });
  if (uncited.length) c.info("REF-08", CAT, `${uncited.length} entri daftar pustaka tidak dikutip dalam teks`, `Contoh: ${uncited.slice(0, 5).map((p) => `"${snippet(p.text, 45)}"`).join(", ")}. Hapus referensi yang tidak dirujuk atau tambahkan sitasinya.`, locOf(uncited[0], sec.label));
  void doc;
}
