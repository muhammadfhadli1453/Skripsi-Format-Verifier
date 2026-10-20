"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Issue, Severity, VerifyReport } from "@/lib/model";
import { ReportView } from "./ReportView";

type DocTypeChoice = "auto" | "proposal" | "skripsi" | "kp" | "hasil";

export function Verifier() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocTypeChoice>("auto");
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = useCallback((f: File | undefined) => {
    if (!f) return;
    if (!/\.(docx|pdf)$/i.test(f.name)) {
      setError("Hanya berkas .docx atau .pdf yang didukung.");
      return;
    }
    setError(null);
    setFile(f);
    setReport(null);
  }, []);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      fd.append("ai", useAi ? "1" : "0");
      const res = await fetch("/api/verify", { method: "POST", body: fd });
      const data = (await res.json()) as VerifyReport & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Gagal (${res.status})`);
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    } finally {
      setBusy(false);
    }
  };

  const sizeLabel = useMemo(() => (file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ""), [file]);

  return (
    <div className="space-y-8">
      <section className="no-print rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"}`}
        >
          <input ref={inputRef} type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => accept(e.target.files?.[0])} />
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 16V4" />
              <path d="m6 10 6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </div>
          {file ? (
            <>
              <p className="font-medium break-all">{file.name}</p>
              <p className="text-xs text-muted mt-1">{sizeLabel} · klik untuk mengganti berkas</p>
            </>
          ) : (
            <>
              <p className="font-medium">Tarik & lepas berkas di sini, atau klik untuk memilih</p>
              <p className="text-xs text-muted mt-1">.docx (disarankan — pemeriksaan paling lengkap) atau .pdf · maks. 40 MB</p>
            </>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block text-sm">
            <span className="text-muted">Jenis naskah</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocTypeChoice)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="auto">Deteksi otomatis dari sampul</option>
              <option value="proposal">Proposal</option>
              <option value="skripsi">Skripsi</option>
              <option value="hasil">Laporan Hasil</option>
              <option value="kp">Laporan Kerja Praktik</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm select-none py-2">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            <span>
              Pemeriksaan AI <span className="text-muted">(Claude Haiku 4.5: istilah asing & ringkasan)</span>
            </span>
          </label>
          <button type="button" onClick={submit} disabled={!file || busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 hover:brightness-110">
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Memeriksa…
              </>
            ) : (
              "Periksa Format"
            )}
          </button>
        </div>
        {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      </section>

      {report && <ReportView report={report} />}
    </div>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Kesalahan", warning: "Peringatan", info: "Info" };
export type { Issue };
