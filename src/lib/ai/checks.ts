import type { Issue, LogicalSection, NormalizedDoc, VerifyReport } from "../model";
import { aiConfig, createCompleter, missingKeyMessage, type AiConfig, type Complete } from "./provider";

export interface AiResult {
  /** provider/model that produced the result */
  model?: string;
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

interface TypoHit {
  paraIndex: number;
  word: string;
  suggestion: string;
  /** "typo" = mistyped Indonesian word; "baku" = English spelling inside an Indonesian sentence */
  kind?: "typo" | "baku";
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

// one call per chunk does both tasks, so typo detection costs no extra requests
const CHUNK_SYSTEM = `Anda adalah asisten pemeriksa format skripsi Program Studi Informatika Universitas Khairun.
Aturan panduan: "Hanya istilah asing (bahasa Inggris / bahasa lain yang belum diserap ke bahasa Indonesia) yang ditulis miring (italic)."
Anda menerima paragraf naskah. Teks yang sudah italic ditandai dengan garis bawah: _seperti ini_.
Tugas 1 (hits): temukan istilah/frasa BERBAHASA INGGRIS (atau bahasa asing lain) yang BELUM italic. Jangan pernah melaporkan kata atau frasa bahasa Indonesia (misalnya "jaringan saraf tiruan", "pra-pemrosesan", "pembelajaran mesin"). Abaikan: nama orang, nama produk/merek/organisasi, singkatan/akronim (CNN, YOLO, API), kata serapan baku KBBI (data, sistem, komputer, internet, komputasi, digital, analisis, algoritma, aplikasi, informasi, teknologi, metode, model, dataset bila sudah lazim), URL, kode program, dan istilah di dalam sitasi/judul referensi.
Tugas 2 (typos): baca konteks kalimatnya, lalu laporkan dua jenis kata:
- kind "typo": SALAH KETIK yang jelas pada kata bahasa Indonesia, yaitu huruf tertukar, kurang, lebih, atau dobel (misalnya "pengguanan" → "penggunaan", "sitem" → "sistem", "dengna" → "dengan", "yangg" → "yang"). Laporkan hanya bila Anda yakin itu salah ketik dan perbaikannya jelas.
- kind "baku": kata berejaan Inggris di dalam kalimat berbahasa Indonesia, padahal kata itu punya bentuk serapan baku bahasa Indonesia yang lazim (misalnya "sentiment" → "sentimen", "negative" → "negatif", "positive" → "positif", "analysis" → "analisis", "method" → "metode"). Hanya bila kata itu dipakai sebagai kata biasa dalam kalimat Indonesia, bukan bagian dari frasa istilah Inggris yang utuh (misalnya "sentiment analysis", "support vector machine" tetap istilah asing di Tugas 1).
Jangan laporkan di Tugas 2: nama orang/tempat/produk, singkatan, kode/rumus, kata yang hanya berbeda gaya bahasa.
Satu kata TIDAK BOLEH muncul di hits dan typos sekaligus: kata Indonesia yang salah ketik (misalnya "statisk", "frekunsi") bukan istilah asing, dan kata berkategori "baku" tidak perlu dimiringkan.
Keluarkan HANYA JSON valid dengan bentuk {"hits":[{"paraIndex":number,"term":"istilah persis seperti di teks","context":"maks 8 kata di sekitarnya"}],"typos":[{"paraIndex":number,"word":"kata persis seperti di teks","suggestion":"kata yang benar","kind":"typo"|"baku"}]}. Jika tidak ada, gunakan array kosong.`;

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

/** 0–1 through the whole AI step, with a label for the UI */
export type AiProgress = (fraction: number, label: string) => void;

/** Levenshtein distance, for telling a typo (1–2 letters off) from a different word. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Keeps only typos that really occur as a whole word in that paragraph, are
 * not acronyms, and were not already reported by the spelling rule (SPELL-01).
 */
function verifyTypos(doc: NormalizedDoc, sections: LogicalSection[], typos: TypoHit[], ruleIssues: Issue[]): Issue[] {
  const ruleWords = new Set(ruleIssues.filter((i) => i.id === "SPELL-01" && i.actual).map((i) => i.actual!.toLowerCase()));
  const byWord = new Map<string, Issue>();
  for (const t of typos) {
    const p = doc.paras[t.paraIndex];
    const word = t.word.trim();
    const suggestion = t.suggestion.trim();
    // one plain word only: multi-word "typos" from the model are phrasing, and dots/digits are punctuation or formulas
    if (!p || word.length < 3 || !suggestion || !/^\p{L}[\p{L}'-]*$/u.test(word) || word === word.toUpperCase()) continue;
    const lower = word.toLowerCase();
    if (lower === suggestion.toLowerCase() || ruleWords.has(lower)) continue;
    // a suggestion with a space may only split the word ("kategoriyang" → "kategori yang"), not add words
    if (/\s/.test(suggestion) && suggestion.replace(/\s+/g, "").toLowerCase() !== lower) continue;
    // typos are a letter or two off; a bigger change ("memberi" → "memberikan") is a word choice.
    // English→baku forms can differ a little more ("method" → "metode")
    if (editDistance(lower, suggestion.toLowerCase()) > (t.kind === "baku" ? 3 : 2)) continue;
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu").exec(p.text);
    if (!m) continue;
    const sec = sections.find((s) => s.firstParaIndex <= p.index && p.index <= s.lastParaIndex);
    const loc = { page: p.page, paraIndex: p.index, section: sec?.label, snippet: p.text.slice(Math.max(0, m.index - 40), m.index + word.length + 40).replace(/\s+/g, " ").trim() };
    const key = `${lower}→${suggestion.toLowerCase()}`;
    const existing = byWord.get(key);
    if (existing) {
      existing.occurrences = existing.occurrences ?? [];
      if (existing.occurrences.length < 30) existing.occurrences.push(loc);
      continue;
    }
    const baku = t.kind === "baku";
    const issue: Issue = {
      id: baku ? "AI-BAKU-01" : "AI-TYPO-01",
      severity: "warning",
      category: baku ? "Ejaan Baku (AI)" : "Salah Ketik (AI)",
      title: baku ? `Gunakan bentuk baku: "${word}" → "${suggestion}"` : `Salah ketik: "${word}" → "${suggestion}"`,
      detail: baku
        ? `Ditemukan oleh AI: "${word}" berejaan Inggris di dalam kalimat berbahasa Indonesia; bentuk bakunya "${suggestion}" (tidak perlu dimiringkan). Verifikasi manual tetap dianjurkan.`
        : `Ditemukan oleh AI: "${word}" kemungkinan salah ketik dari "${suggestion}". Verifikasi manual tetap dianjurkan.`,
      expected: suggestion,
      actual: word,
      fix: `Ganti "${word}" menjadi "${suggestion}" (Ctrl+H untuk mengganti semua).`,
      location: loc,
      occurrences: [],
      source: "ai",
    };
    byWord.set(key, issue);
  }
  return [...byWord.values()];
}

export async function runAiChecks(doc: NormalizedDoc, sections: LogicalSection[], ruleIssues: Issue[], report: VerifyReport, onProgress: AiProgress = () => {}): Promise<AiResult> {
  const result: AiResult = { issues: [], inputTokens: 0, outputTokens: 0 };
  const cfg: AiConfig | undefined = aiConfig();
  if (!cfg) {
    result.error = missingKeyMessage();
    return result;
  }
  result.model = cfg.label;
  const complete: Complete = createCompleter(cfg);

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
  const typos: TypoHit[] = [];
  // the foreign-term chunks are most of the AI time; the summary is one short call
  const CHUNK_SHARE = 0.85;
  let done = 0;
  const chunkLabel = () => `AI memeriksa istilah asing & salah ketik (${done}/${used.length} bagian)…`;
  onProgress(0, chunkLabel());
  const runChunk = async (chunk: typeof bodyParas) => {
    const payload = chunk.map((p) => `[${p.index}] ${renderParagraph(p)}`).join("\n\n");
    const res = await complete({ system: CHUNK_SYSTEM, user: payload, maxTokens: 3072, temperature: 0 });
    result.inputTokens += res.inputTokens;
    result.outputTokens += res.outputTokens;
    const parsed = extractJson<{ hits?: ForeignHit[]; typos?: TypoHit[] }>(res.text);
    for (const h of parsed?.hits ?? []) if (typeof h.paraIndex === "number" && typeof h.term === "string" && h.term.trim()) hits.push(h);
    for (const t of parsed?.typos ?? []) if (typeof t.paraIndex === "number" && typeof t.word === "string" && typeof t.suggestion === "string") typos.push(t);
    done++;
    onProgress((done / used.length) * CHUNK_SHARE, chunkLabel());
  };
  // a failed chunk only loses its own paragraphs
  const CONCURRENCY = 4;
  let failed = 0;
  let lastError = "";
  for (let i = 0; i < used.length; i += CONCURRENCY) {
    const settled = await Promise.allSettled(used.slice(i, i + CONCURRENCY).map(runChunk));
    for (const s of settled)
      if (s.status === "rejected") {
        failed++;
        lastError = (s.reason as Error)?.message ?? String(s.reason);
        done++;
        onProgress((done / used.length) * CHUNK_SHARE, chunkLabel());
      }
  }
  if (failed) result.error = `Pemeriksaan istilah asing & salah ketik AI gagal pada ${failed} dari ${used.length} bagian teks: ${lastError}`;
  // typos first: a word reported as a typo or baku form in a paragraph is not also a foreign term there
  const typoIssues = verifyTypos(doc, sections, typos, ruleIssues);
  const typoAt = new Set(typoIssues.flatMap((i) => [i.location, ...(i.occurrences ?? [])].map((l) => `${l.paraIndex}|${i.actual!.toLowerCase()}`)));
  // the corrected forms ("sentimen", "statistik") are Indonesian and never need italics
  const corrections = new Set(typoIssues.map((i) => i.expected!.toLowerCase()));
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
    if (alreadyFlagged.has(p.index) || typoAt.has(`${p.index}|${lower}`) || corrections.has(lower)) continue;
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
      detail: `Ditemukan oleh AI: "${term}" ditulis tanpa italic pada "${(h.context || p.text).slice(0, 80)}". Istilah asing harus italic (Ctrl+I). Verifikasi manual tetap dianjurkan.`,
      fix: "Blok istilah → Ctrl+I.",
      location: loc,
      occurrences: [],
      source: "ai",
    };
    byTerm.set(key, issue);
    result.issues.push(issue);
  }
  result.issues.push(...typoIssues);
  if (chunks.length > MAX_CHUNKS) result.issues.push({ id: "AI-INFO", severity: "info", category: "Istilah Asing (AI)", title: "Pemeriksaan AI dibatasi", detail: `Hanya ${MAX_CHUNKS} dari ${chunks.length} bagian teks yang diperiksa AI untuk membatasi biaya.`, location: {}, source: "ai" });

  // ---- 2. summary ----
  onProgress(CHUNK_SHARE, "AI menyusun ringkasan…");
  try {
    const all = [...ruleIssues, ...result.issues];
    const list = all
      .filter((i) => i.severity !== "info")
      .slice(0, 60)
      .map((i) => `- [${i.severity}] ${i.id} ${i.title}${i.occurrences?.length ? ` (${i.occurrences.length + 1} kejadian)` : ""}${i.location.page ? ` hal. ${i.location.page}` : ""}`)
      .join("\n");
    const res = await complete({
      maxTokens: 700,
      temperature: 0.2,
      system: "Anda asisten asistensi penulisan skripsi Prodi Informatika Universitas Khairun. Jawab dalam bahasa Indonesia yang ringkas, ramah, dan konkret, dalam teks biasa (plain text): JANGAN gunakan markdown sama sekali (tanpa #, tanpa **, tanpa tabel). Satu paragraf pembuka, lalu maksimal 6 poin prioritas bernomor (1., 2., …), lalu satu kalimat penutup.",
      // DOCX has no page count; "? halaman" made the model report the page count as unreadable
      user: `Naskah: ${report.docType.toUpperCase()}, ${report.pageCount ? `${report.pageCount} halaman, ` : ""}${report.summary.errors} kesalahan, ${report.summary.warnings} peringatan.\nTemuan pemeriksaan format:\n${list || "(tidak ada temuan)"}\n\nBuat ringkasan singkat untuk mahasiswa: kondisi umum naskah dan urutan prioritas perbaikan (mulai dari yang paling sering ditolak saat asistensi: sampul, nomor halaman, spasi, font).`,
    });
    result.inputTokens += res.inputTokens;
    result.outputTokens += res.outputTokens;
    result.summary = stripMarkdown(res.text);
  } catch (e) {
    result.error = (result.error ? result.error + " | " : "") + `Ringkasan AI gagal: ${(e as Error).message}`;
  }
  return result;
}
