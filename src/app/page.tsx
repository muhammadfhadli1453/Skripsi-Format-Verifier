import { Verifier } from "@/components/Verifier";

export default function Home() {
  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 sm:px-6">
      <header className="mb-8 print:hidden">
        <p className="text-xs font-semibold tracking-wider uppercase text-accent">Program Studi Informatika · Universitas Khairun</p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">Pemeriksa Format Skripsi</h1>
        <p className="mt-2 text-sm text-muted max-w-3xl">
          Unggah naskah Kerja Praktik, Proposal, atau Skripsi (<span className="font-mono">.docx</span> atau <span className="font-mono">.pdf</span>). Sistem memeriksa sampul, margin, font, spasi, nomor halaman, daftar isi, keterangan gambar/tabel, sitasi, dan daftar pustaka sesuai <em>Format Penulisan</em> Prodi Informatika, lalu menampilkan letak dan cara memperbaiki setiap masalah.
        </p>
      </header>
      <Verifier />
      <footer className="mt-12 text-xs text-muted print:hidden">
        Pemeriksaan berbasis aturan (rule-based). Pemeriksaan AI hanya dipakai untuk istilah asing dan ringkasan, dan tidak memengaruhi skor papan peringkat. Hasil otomatis tidak menggantikan asistensi pembimbing.
      </footer>
    </main>
  );
}
