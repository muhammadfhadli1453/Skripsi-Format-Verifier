"use client";

export interface SavedUpload {
  id: string;
  fileName: string;
  downloadUrl: string;
  score: number;
  createdAt: string;
}

const KEY = "skripsi-verifier:uploads";
const MAX_KEPT = 20;

// the download link carries the secret token, so it lives only in this browser
export function loadUploads(): SavedUpload[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedUpload[]) : [];
  } catch {
    return [];
  }
}

export function rememberUpload(u: SavedUpload): SavedUpload[] {
  const next = [u, ...loadUploads().filter((x) => x.id !== u.id)].slice(0, MAX_KEPT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / storage blocked: the link is still shown for this session
  }
  return next;
}

export function MyUploads({ uploads }: { uploads: SavedUpload[] }) {
  if (!uploads.length) return null;
  return (
    <section className="no-print rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Unggahan Saya</h2>
      <p className="mt-1 text-xs text-muted">Tautan unduhan hanya tersimpan di peramban ini. Simpan tautannya bila ingin membuka dari perangkat lain.</p>
      <ul className="mt-3 divide-y divide-border">
        {uploads.map((u) => (
          <li key={u.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{u.fileName}</p>
              <p className="text-xs text-muted">
                Skor {u.score} · {new Date(u.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            <a href={u.downloadUrl} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-accent/60">
              Unduh
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
