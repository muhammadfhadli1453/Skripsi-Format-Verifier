"use client";

import { useMemo, useState } from "react";
import type { Issue, Severity, VerifyReport } from "@/lib/model";

const SEV: Record<Severity, { label: string; badge: string; dot: string }> = {
  error: { label: "Kesalahan", badge: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300", dot: "bg-red-500" },
  warning: { label: "Peringatan", badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300", dot: "bg-amber-500" },
  info: { label: "Info", badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300", dot: "bg-sky-500" },
};
const DOC_LABEL: Record<string, string> = { proposal: "Proposal", skripsi: "Skripsi", kp: "Laporan Kerja Praktik", hasil: "Laporan Hasil", unknown: "Tidak terdeteksi" };

export function ReportView({ report }: { report: VerifyReport }) {
  const [sevFilter, setSevFilter] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: true });
  const [catFilter, setCatFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of report.issues) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [report.issues]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return report.issues.filter((i) => sevFilter[i.severity] && (catFilter === "all" || i.category === catFilter) && (!q || `${i.title} ${i.detail} ${i.location.snippet ?? ""}`.toLowerCase().includes(q)));
  }, [report.issues, sevFilter, catFilter, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of visible) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [visible]);

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `laporan-format-${report.fileName.replace(/\.[^.]+$/, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const score = report.summary.score;
  const scoreColor = score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <section className="space-y-6">
      {/* summary */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold break-all">{report.fileName}</h2>
            <p className="mt-1 text-sm text-muted">
              {report.source.toUpperCase()} · {DOC_LABEL[report.docType]}
              {report.detectedDocType !== report.docType && <> (terdeteksi: {DOC_LABEL[report.detectedDocType]})</>}
              {report.pageCount ? ` · ${report.pageCount} halaman` : ""} · {report.paragraphCount} paragraf · {report.durationMs} ms
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {report.sections.map((s, i) => (
                <span key={i} className={`rounded-full border border-border px-2 py-0.5 text-xs ${s.kind === "unknown" ? "text-muted" : ""}`} title={s.firstPage ? `hal. ${s.firstPage}${s.lastPage && s.lastPage !== s.firstPage ? `–${s.lastPage}` : ""}` : undefined}>
                  {s.label}
                  {s.firstPage ? <span className="text-muted"> · {s.firstPage}</span> : null}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-center">
              <div className={`text-4xl font-bold tabular-nums ${scoreColor}`}>{score}</div>
              <div className="text-xs text-muted">skor format</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["error", "warning", "info"] as Severity[]).map((s) => (
                <button key={s} type="button" onClick={() => setSevFilter((f) => ({ ...f, [s]: !f[s] }))} className={`rounded-xl border px-3 py-2 transition ${sevFilter[s] ? "border-border bg-background" : "border-transparent opacity-40"}`}>
                  <div className="text-xl font-semibold tabular-nums">{s === "error" ? report.summary.errors : s === "warning" ? report.summary.warnings : report.summary.infos}</div>
                  <div className="flex items-center justify-center gap-1 text-[11px] text-muted">
                    <span className={`inline-block h-2 w-2 rounded-full ${SEV[s].dot}`} /> {SEV[s].label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {report.aiSummary && (
          <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm leading-relaxed whitespace-pre-line">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">Ringkasan AI · {report.ai?.model}</p>
            {report.aiSummary}
          </div>
        )}
        {report.ai?.error && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Catatan AI: {report.ai.error}</p>}

        <div className="no-print mt-5 flex flex-wrap items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari temuan…" className="min-w-[12rem] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
            <option value="all">Semua kategori ({report.issues.length})</option>
            {categories.map(([c, n]) => (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            ))}
          </select>
          <button type="button" onClick={download} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background">
            Unduh JSON
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-background">
            Cetak
          </button>
        </div>
      </div>

      {/* issues */}
      {report.issues.length === 0 ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">Tidak ada masalah format yang terdeteksi. 🎉</div>
      ) : (
        grouped.map(([cat, list]) => (
          <div key={cat} className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="font-semibold">{cat}</h3>
              <span className="text-xs text-muted">{list.length} temuan</span>
            </div>
            <ul className="divide-y divide-border">
              {list.map((i, idx) => (
                <IssueItem key={`${i.id}-${idx}`} issue={i} />
              ))}
            </ul>
          </div>
        ))
      )}
      {visible.length === 0 && report.issues.length > 0 && <p className="text-sm text-muted">Tidak ada temuan yang cocok dengan filter.</p>}

      {/* capabilities */}
      <details className="rounded-2xl border border-border bg-card p-5 text-sm">
        <summary className="cursor-pointer font-medium">Cakupan & keterbatasan pemeriksaan ({report.source.toUpperCase()})</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Dapat diperiksa</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {report.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Keterbatasan</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {report.limitations.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
        {report.ai?.used && (
          <p className="mt-3 text-xs text-muted">
            AI: {report.ai.model} · {report.ai.inputTokens ?? 0} token masuk · {report.ai.outputTokens ?? 0} token keluar
          </p>
        )}
      </details>
    </section>
  );
}

function IssueItem({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  const more = issue.occurrences?.length ?? 0;
  const loc = formatLoc(issue.location);
  return (
    <li className="px-5 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left">
        <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${SEV[issue.severity].badge}`}>{SEV[issue.severity].label}</span>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{issue.title}</span>
          {issue.source === "ai" && <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">AI</span>}
          <span className="block text-xs text-muted">
            <span className="font-mono">{issue.id}</span>
            {loc && <> · {loc}</>}
            {more > 0 && <> · +{more} lokasi lain</>}
          </span>
        </span>
        <span className="shrink-0 text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 pl-0 sm:pl-[4.5rem] text-sm">
          {issue.detail && <p className="leading-relaxed">{issue.detail}</p>}
          {(issue.expected || issue.actual) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {issue.expected && (
                <div className="rounded-lg border border-border bg-background p-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Seharusnya</p>
                  <p>{issue.expected}</p>
                </div>
              )}
              {issue.actual && (
                <div className="rounded-lg border border-border bg-background p-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted">Ditemukan</p>
                  <p>{issue.actual}</p>
                </div>
              )}
            </div>
          )}
          {issue.fix && (
            <p className="rounded-lg border border-accent/30 bg-accent/5 p-2">
              <span className="font-semibold text-accent">Cara memperbaiki: </span>
              {issue.fix}
            </p>
          )}
          {issue.location.snippet && (
            <p className="text-xs text-muted">
              Teks: <span className="font-mono">“{issue.location.snippet}”</span>
            </p>
          )}
          {more > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">Lokasi lain ({more})</summary>
              <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto pl-4">
                {issue.occurrences!.map((o, k) => (
                  <li key={k} className="list-disc">
                    {formatLoc(o) || "—"}
                    {o.snippet && <span className="text-muted"> — “{o.snippet.slice(0, 80)}”</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

function formatLoc(l: Issue["location"]): string {
  const parts: string[] = [];
  if (l.page) parts.push(`hal. ${l.page}`);
  if (l.section) parts.push(l.section);
  else if (l.paraIndex !== undefined) parts.push(`paragraf #${l.paraIndex + 1}`);
  return parts.join(" · ");
}
