"use client";

import { useEffect, useState } from "react";
import type { DocType } from "@/lib/model";

interface Entry {
  id: string;
  rank: number;
  name?: string;
  studentId?: string;
  docType: DocType;
  fileName: string;
  score: number;
  createdAt: string;
}

const TABS: { value: DocType | "all"; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "proposal", label: "Proposal" },
  { value: "skripsi", label: "Skripsi" },
  { value: "hasil", label: "Hasil" },
  { value: "kp", label: "KP" },
];
const DOC_LABEL: Record<DocType, string> = { proposal: "Proposal", skripsi: "Skripsi", hasil: "Hasil", kp: "KP", unknown: "Lainnya" };

/** Top 5 opted-in scores; `refreshKey` changes after each new submission. */
export function Leaderboard({ refreshKey }: { refreshKey: number }) {
  const [tab, setTab] = useState<DocType | "all">("all");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/leaderboard${tab === "all" ? "" : `?docType=${tab}`}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ entries: Entry[]; error?: string }>)
      .then((d) => {
        setEntries(d.entries);
        setError(d.error ?? null);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Gagal memuat.");
      });
    return () => ctrl.abort();
  }, [tab, refreshKey]);

  return (
    <section className="no-print rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Papan Peringkat Format</h2>
        <div className="flex flex-wrap gap-1 text-xs" role="tablist">
          {TABS.map((t) => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)} className={`rounded-full px-3 py-1 transition ${tab === t.value ? "bg-accent text-white" : "border border-border hover:border-accent/60"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">5 skor format tertinggi (pemeriksaan berbasis aturan, tanpa AI). Nama dan NPM dibaca dari sampul; satu baris per NPM, diambil dari skor terbaiknya. Unduh naskahnya sebagai contoh.</p>
      {error && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
      {entries === null ? (
        <p className="mt-4 text-sm text-muted">Memuat…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Belum ada naskah yang diperiksa.</p>
      ) : (
        <ol className="mt-4 divide-y divide-border">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${e.rank === 1 ? "bg-accent text-white" : "bg-accent/10 text-accent"}`}>{e.rank}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${e.name ? "" : "italic text-muted"}`}>{e.name ?? "Tanpa nama"}</p>
                <p className="text-xs text-muted">
                  {e.studentId && <span className="font-mono">{e.studentId} · </span>}{DOC_LABEL[e.docType]} · {new Date(e.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <span className="text-lg font-bold tabular-nums">{e.score}</span>
              <a href={`/api/submissions/${e.id}/file`} title={e.fileName} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent/60">
                Unduh
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
