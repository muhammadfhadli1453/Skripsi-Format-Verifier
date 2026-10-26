"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import type { Issue, Severity, VerifyReport } from "@/lib/model";
import { ReportView } from "./ReportView";
import { Leaderboard } from "./Leaderboard";
import { MyUploads, loadUploads, rememberUpload, type SavedUpload } from "./MyUploads";

type DocTypeChoice = "auto" | "proposal" | "skripsi" | "kp" | "hasil";

interface ServerStatus {
  storage: boolean;
  ai: { available: boolean; label?: string };
}

const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

/** Blob pathnames: keep the name readable but drop characters that need escaping. */
const blobName = (name: string) => name.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/\.(docx|pdf)$/i, (m) => m.toLowerCase());

export function Verifier() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocTypeChoice>("auto");
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState<false | "upload" | "check">(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [uploads, setUploads] = useState<SavedUpload[]>([]);
  const [boardKey, setBoardKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json() as Promise<ServerStatus>)
      .then((s) => {
        setStatus(s);
        // saved download links only matter when uploads are kept
        if (s.storage) setUploads(loadUploads());
      })
      .catch(() => setStatus({ storage: false, ai: { available: false } }));
  }, []);

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

  const aiUsable = status?.ai.available ?? true;
  const storage = status?.storage ?? false;

  const submit = async () => {
    if (!file) return;
    setError(null);
    setReport(null);
    try {
      let res: Response;
      if (storage) {
        // straight to private Blob, so files over the 4.5 MB function body limit still work
        setBusy("upload");
        const ext = /\.pdf$/i.test(file.name) ? "pdf" : "docx";
        const blob = await uploadPresigned(`uploads/${blobName(file.name)}`, file, { access: "private", handleUploadUrl: "/api/upload", contentType: MIME[ext] });
        setBusy("check");
        res = await fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobPathname: blob.pathname, fileName: file.name, docType, ai: useAi && aiUsable }),
        });
      } else {
        setBusy("check");
        const fd = new FormData();
        fd.append("file", file);
        fd.append("docType", docType);
        fd.append("ai", useAi && aiUsable ? "1" : "0");
        res = await fetch("/api/verify", { method: "POST", body: fd });
      }
      const data = (await res.json()) as VerifyReport & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Gagal (${res.status})`);
      setReport(data);
      const sub = data.submission;
      if (sub?.id && sub.downloadUrl) {
        setUploads(rememberUpload({ id: sub.id, fileName: data.fileName, downloadUrl: sub.downloadUrl, score: sub.rankedScore, createdAt: new Date().toISOString() }));
        setBoardKey((k) => k + 1);
      }
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
          <label className={`flex items-center gap-2 text-sm select-none py-2 ${aiUsable ? "" : "opacity-60"}`}>
            <input type="checkbox" checked={useAi && aiUsable} disabled={!aiUsable} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            <span>
              Pemeriksaan AI <span className="text-muted">({aiUsable ? `${status?.ai.label ?? "…"}: istilah asing & ringkasan` : "kunci API belum diatur"})</span>
            </span>
          </label>
          <button type="button" onClick={submit} disabled={!file || !!busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 hover:brightness-110">
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> {busy === "upload" ? "Mengunggah…" : "Memeriksa…"}
              </>
            ) : (
              "Periksa Format"
            )}
          </button>
        </div>

        {storage && <p className="mt-4 text-xs text-muted">Setiap naskah yang diperiksa masuk papan peringkat dengan nama dan NPM yang dibaca dari sampul. Berkas disimpan secara privat; hanya pemegang tautan unduhan yang dapat mengunduhnya.</p>}
        {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      </section>

      {storage && (
        <div className={`grid gap-8 ${uploads.length ? "lg:grid-cols-2" : ""}`}>
          <Leaderboard refreshKey={boardKey} />
          <MyUploads uploads={uploads} />
        </div>
      )}

      {report?.submission && (
        <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          {report.submission.error ? (
            <span className="text-amber-700 dark:text-amber-300">{report.submission.error}</span>
          ) : (
            <>
              <span>
                Berkas tersimpan dan masuk papan peringkat sebagai <span className="font-semibold">{report.student?.name ?? "Tanpa nama"}</span>
                {report.student?.studentId ? <span className="font-mono text-muted"> ({report.student.studentId})</span> : null}
                {!report.student?.name || !report.student?.studentId ? <span className="text-amber-700 dark:text-amber-300"> · nama/NPM tidak terbaca dari sampul (baris setelah OLEH)</span> : null}
              </span>
              {report.submission.downloadUrl && (
                <a href={report.submission.downloadUrl} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent/60">
                  Unduh berkas
                </a>
              )}
            </>
          )}
        </div>
      )}

      {report && <ReportView report={report} />}
    </div>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = { error: "Kesalahan", warning: "Peringatan", info: "Info" };
export type { Issue };
