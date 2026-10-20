import Anthropic from "@anthropic-ai/sdk";
import type { Issue, LogicalSection, NormalizedDoc, VerifyReport } from "../model";

/** The only model this app is allowed to use (per project requirement). */
export const AI_MODEL = "claude-haiku-4-5";

export function aiAvailable(): boolean {
  return !!(process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY tidak ditemukan di .env");
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
}

export interface AiResult {
  issues: Issue[];
  summary?: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

interface ForeignHit {
  paraIndex: number;
  term: string;
  context?: string;
}

/**
 * Renders body paragraphs with italic spans marked as _..._ so the model can
 * tell which foreign terms are already italicised.
 */
function renderParagraph(p: NormalizedDoc["paras"][number]): string {
  let out = "";
  for (const r of p.runs) {
    const t = r.text.replace(/\s+/g, " ");
    out += r.italic && t.trim() ? `_${t.trim()}_ ` : t;
  }
  return out.replace(/\s+/g, " ").trim();
}

function extractJson<T>(text: string): T | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

const FOREIGN_SYSTEM = `Anda adalah asisten pemeriksa format skripsi Program Studi Informatika Universitas Khairun.
Aturan panduan: "Hanya istilah asing (bahasa Inggris / bahasa lain yang belum diserap ke bahasa Indonesia) yang ditulis miring (italic)."
Anda menerima paragraf naskah. Teks yang sudah italic ditandai dengan garis bawah: _seperti ini_.
Tugas: temukan istilah/frasa BERBAHASA INGGRIS (atau bahasa asing lain) yang BELUM italic. Jangan pernah melaporkan kata atau frasa bahasa Indonesia (misalnya "jaringan saraf tiruan", "pra-pemrosesan", "pembelajaran mesin"). Abaikan: nama orang, nama produk/merek/organisasi, singkatan/akronim (CNN, YOLO, API), kata serapan baku KBBI (data, sistem, komputer, internet, komputasi, digital, analisis, algoritma, aplikasi, informasi, teknologi, metode, model, dataset bila sudah lazim), URL, kode program, dan istilah di dalam sitasi/judul referensi.
Keluarkan HANYA JSON valid dengan bentuk {"hits":[{"paraIndex":number,"term":"istilah persis seperti di teks","context":"maks 8 kata di sekitarnya"}]}. Jika tidak ada, {"hits":[]}.`;

const ID_WORDS = new Set(["dan", "atau", "yang", "pada", "untuk", "dengan", "dari", "ke", "di", "jaringan", "saraf", "tiruan", "pembelajaran", "mesin", "pengolahan", "citra", "data", "sistem", "informasi", "pemrosesan", "pra", "pasca", "metode", "model", "analisis", "klasifikasi", "deteksi", "objek", "basis", "pengguna", "antarmuka", "perangkat", "lunak", "keras", "jaringan", "komputer", "kecerdasan", "buatan", "pohon", "keputusan", "hutan", "acak", "pengujian", "pelatihan", "latih", "uji"]);
function looksIndonesian(term: string): boolean {
  const ws = term.replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  if (!ws.length) return true;
  const idCount = ws.filter((w) => ID_WORDS.has(w) || /(kan|nya|lah|kah)$/.test(w) && w.length > 5).length;
  return idCount === ws.length;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function runAiChecks(doc: NormalizedDoc, sections: LogicalSection[], ruleIssues: Issue[], report: VerifyReport): Promise<AiResult> {
  const result: AiResult = { issues: [], inputTokens: 0, outputTokens: 0 };
  let anthropic: Anthropic;
  try {
    anthropic = client();
  } catch (e) {
    result.error = (e as Error).message;
    return result;
  }

  // ---- 1. foreign terms (chunked) ----
  const alreadyFlagged = new Set(ruleIssues.filter((i) => i.id === "LANG-01").flatMap((i) => [i.location.paraIndex, ...(i.occurrences ?? []).map((o) => o.paraIndex)]));
  const bodyParas = sections
    .filter((s) => s.kind === "bab")
    .flatMap((s) => doc.paras.slice(s.firstParaIndex, s.lastParaIndex + 1))
    .filter((p) => !p.isEmpty && !p.inTable && p.text.length >= 40 && !/https?:|www\./i.test(p.text));
  const chunks: typeof bodyParas[] = [];
  let cur: typeof bodyParas = [];
  let curLen = 0;
  for (const p of bodyParas) {
    cur.push(p);
    curLen += p.text.length;
    if (curLen > 6000 || cur.length >= 25) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
  }
  if (cur.length) chunks.push(cur);
  const MAX_CHUNKS = 24; // cost guard (~150k chars)
  const used = chunks.slice(0, MAX_CHUNKS);
  const hits: ForeignHit[] = [];
  const runChunk = async (chunk: typeof bodyParas) => {
    const payload = chunk.map((p) => `[${p.index}] ${renderParagraph(p)}`).join("\n\n");
    const res = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: FOREIGN_SYSTEM,
      messages: [{ role: "user", content: payload }],
    });
    result.inputTokens += res.usage.input_tokens;
    result.outputTokens += res.usage.output_tokens;
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const parsed = extractJson<{ hits: ForeignHit[] }>(text);
    for (const h of parsed?.hits ?? []) if (typeof h.paraIndex === "number" && typeof h.term === "string" && h.term.trim()) hits.push(h);
  };
  try {
    const CONCURRENCY = 4;
    for (let i = 0; i < used.length; i += CONCURRENCY) await Promise.all(used.slice(i, i + CONCURRENCY).map(runChunk));
  } catch (e) {
    result.error = `Pemeriksaan istilah asing AI gagal: ${(e as Error).message}`;
  }
  // verify hits: the term must really appear non-italic in that paragraph
  const byTerm = new Map<string, Issue>();
  for (const h of hits) {
    const p = doc.paras[h.paraIndex];
    if (!p) continue;
    const term = h.term.trim();
    const lower = term.toLowerCase();
    const inNonItalic = p.runs.some((r) => !r.italic && r.text.toLowerCase().includes(lower));
    if (!inNonItalic) continue;
    if (looksIndonesian(lower)) continue;
    if (alreadyFlagged.has(p.index)) continue;
    const sec = sections.find((s) => s.firstParaIndex <= p.index && p.index <= s.lastParaIndex);
    const loc = { page: p.page, paraIndex: p.index, section: sec?.label, snippet: (h.context || p.text).slice(0, 90) };
    const key = lower;
    const existing = byTerm.get(key);
    if (existing) {
      existing.occurrences = existing.occurrences ?? [];
      if (existing.occurrences.length < 30) existing.occurrences.push(loc);
      continue;
    }
    const issue: Issue = {
      id: "AI-LANG-01",
      severity: "warning",
      category: "Istilah Asing (AI)",
      title: `Istilah asing "${term}" tidak dimiringkan`,
      detail: `Ditemukan oleh Claude Haiku 4.5: "${term}" ditulis tanpa italic pada "${(h.context || p.text).slice(0, 80)}". Istilah asing harus italic (Ctrl+I). Verifikasi manual tetap dianjurkan.`,
      fix: "Blok istilah → Ctrl+I.",
      location: loc,
      occurrences: [],
      source: "ai",
    };
    byTerm.set(key, issue);
    result.issues.push(issue);
  }
  if (chunks.length > MAX_CHUNKS) result.issues.push({ id: "AI-INFO", severity: "info", category: "Istilah Asing (AI)", title: "Pemeriksaan AI dibatasi", detail: `Hanya ${MAX_CHUNKS} dari ${chunks.length} bagian teks yang diperiksa AI untuk membatasi biaya.`, location: {}, source: "ai" });

  // ---- 2. summary ----
  try {
    const all = [...ruleIssues, ...result.issues];
    const list = all
      .filter((i) => i.severity !== "info")
      .slice(0, 60)
      .map((i) => `- [${i.severity}] ${i.id} ${i.title}${i.occurrences?.length ? ` (${i.occurrences.length + 1} kejadian)` : ""}${i.location.page ? ` hal. ${i.location.page}` : ""}`)
      .join("\n");
    const res = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system: "Anda asisten asistensi penulisan skripsi Prodi Informatika Universitas Khairun. Jawab dalam bahasa Indonesia yang ringkas, ramah, dan konkret, dalam teks biasa (plain text): JANGAN gunakan markdown sama sekali (tanpa #, tanpa **, tanpa tabel). Satu paragraf pembuka, lalu maksimal 6 poin prioritas bernomor (1., 2., …), lalu satu kalimat penutup.",
      messages: [
        {
          role: "user",
          content: `Naskah: ${report.docType.toUpperCase()}, ${report.pageCount ?? "?"} halaman, ${report.summary.errors} kesalahan, ${report.summary.warnings} peringatan.\nTemuan pemeriksaan format:\n${list || "(tidak ada temuan)"}\n\nBuat ringkasan singkat untuk mahasiswa: kondisi umum naskah dan urutan prioritas perbaikan (mulai dari yang paling sering ditolak saat asistensi: sampul, nomor halaman, spasi, font).`,
        },
      ],
    });
    result.inputTokens += res.usage.input_tokens;
    result.outputTokens += res.usage.output_tokens;
    result.summary = stripMarkdown(res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n"));
  } catch (e) {
    result.error = (result.error ? result.error + " | " : "") + `Ringkasan AI gagal: ${(e as Error).message}`;
  }
  return result;
}
