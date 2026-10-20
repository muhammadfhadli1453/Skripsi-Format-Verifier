# Pemeriksa Format Skripsi — Prodi Informatika Universitas Khairun

Aplikasi web (Next.js) untuk memeriksa **format** naskah Kerja Praktik / Proposal / Skripsi
(`.docx` atau `.pdf`) terhadap dokumen *Format Penulisan* Prodi Informatika Unkhair
(`reference/FORMAT PENULISAN UPDATE 012424_202301.pdf`). Hasilnya adalah daftar masalah
dengan lokasi (halaman/bagian/kutipan teks), nilai yang diharapkan vs ditemukan, dan cara memperbaikinya.

Pemeriksaan utama **berbasis aturan** (deterministik, tanpa biaya). Pemeriksaan **AI opsional**
memakai **Claude Haiku 4.5** (`claude-haiku-4-5`) hanya untuk (1) istilah asing yang belum
italic dan (2) ringkasan prioritas perbaikan. Model lain tidak digunakan.

## Menjalankan

Memerlukan Node.js ≥ 20.9.

```bash
npm install
cp .env.example .env        # isi CLAUDE_API_KEY bila ingin memakai pemeriksaan AI
npm run dev                 # http://localhost:3000
npm run build && npm start  # produksi
```

CLI (tanpa browser):

```bash
npm run fixture                                            # buat testing-data/fixture-proposal.docx
npm run verify -- testing-data/fixture-proposal.docx       # ringkasan temuan di terminal
npm run verify -- testing-data/naskah.pdf --json           # laporan lengkap (JSON)
npm run dump   -- testing-data/naskah.pdf 1 2              # debug model dokumen halaman 1–2
npm run typecheck && npm run lint
```

## Arsitektur

```
src/lib/model.ts            model dokumen ternormalisasi (Para, Run, Section, Page, Issue, VerifyReport)
src/lib/parse/docx.ts       DOCX → model (JSZip + fast-xml-parser): style inheritance, numbering,
                            section/margin, header-footer (field PAGE), gambar (EMU), tabel
src/lib/parse/pdf.ts        PDF → model (mupdf wasm): font/ukuran/bold/italic per karakter,
                            rekonstruksi baris→paragraf, deteksi tabel, nomor halaman, margin, logo
src/lib/sections.ts         klasifikasi bagian logis (Sampul, Pengesahan, Kata Pengantar, Daftar …, BAB, Pustaka)
src/lib/rules/*.ts          aturan: layout, cover, frontmatter, body, pagenumbers, references
src/lib/ai/haiku.ts         pemeriksaan AI opsional (Claude Haiku 4.5)
src/app/api/verify/route.ts POST multipart (file, docType, ai) → VerifyReport JSON
src/components/*            UI unggah + laporan
```

## Cakupan aturan (ringkas)

| Kelompok | Contoh pemeriksaan |
|---|---|
| Tata letak | A4; margin sampul 2,54 cm (Normal); margin isi atas/kiri 4 cm, kanan/bawah 3 cm; font Arial Narrow di seluruh naskah; Space Before/After = 0 (docx); line rule Multiple |
| Sampul | jenis laporan (SKRIPSI/PROPOSAL/…), judul kapital, kata penghubung di akhir baris, ≤15 kata, `(Studi Kasus: …)` Capitalize Each Word, istilah asing italic, OLEH/nama/NPM 14 pt, blok institusi 16 pt & urutan, logo 4,15 × 4 cm di tengah & In Line With Text, rata tengah, spasi 2.0/1.0, simetri jarak & rata margin bawah (pdf) |
| Struktur | kelengkapan & urutan bagian per jenis naskah, BAB I–III (proposal) / I–V (skripsi) |
| Pengesahan / Pernyataan | komponen wajib, jenis naskah konsisten dengan sampul, judul konsisten dengan sampul, bold/spasi |
| Kata Pengantar | larangan SWT/SAW, judul tidak kapital/italic & sama dengan sampul, urutan ucapan terima kasih (Rektor → Dekan → Koordinator → Pembimbing → Penguji → …), spasi 1,5, justify, penutup Ternate/Penulis |
| Daftar Isi/Gambar/Tabel | label Halaman, entri wajib, format `1.1.`, sinkron dengan sub bab & keterangan di naskah, nomor halaman vs nomor tercetak (pdf), penomoran berurutan, huruf awal kapital |
| Abstrak | judul kapital/bold/12 pt/≤15 kata, isi 11 pt justify 1.0, 150–250 kata, kata kunci ≤6 huruf kecil |
| BAB & Sub BAB | BAB romawi berurutan, judul kapital 14 pt bold tengah, halaman baru, sub bab `1.1.` bold 12 pt berurutan sesuai BAB, minimal dua sub/anak sub bab, sistematika penulisan sesuai jenis naskah |
| Paragraf isi | 12 pt, spasi 2.0, justify, indentasi konsisten (±1 cm), akhir kalimat bertitik, spasi sebelum tanda baca, spasi setelah koma, format sitasi `(Nama, Tahun)` & posisi titik, poin bertitik & sejajar (hanging indent) |
| Gambar & Tabel | keterangan rata tengah, nomor sesuai BAB & berurutan, dirujuk dalam teks, keterangan tabel di atas tabel / gambar di bawah gambar, lebar gambar ≤ 14 cm, isi tabel 1.0, tabel jadwal penelitian (proposal ada / skripsi dihapus) |
| Nomor halaman | romawi kecil footer tengah sebelum BAB I; BAB I mulai dari 1; halaman pertama BAB footer tengah, lanjutan header kanan; berurutan; Arial Narrow 12 (pdf: terbaca; docx: section break, Different First Page, field PAGE, format) |
| Daftar Pustaka | urut alfabet, hanging indent, spasi 1,5, tahun ada, bukan kapital semua, sitasi ↔ referensi saling ada |

Keterbatasan: PDF tidak menyimpan Space Before/After dan struktur tabel (hanya diestimasi); DOCX tidak
mengetahui posisi vertikal sehingga simetri sampul dan nomor halaman hanya diperkirakan. Lihat panel
"Cakupan & keterbatasan" pada laporan.

## Data uji

Folder `testing-data/` **tidak ikut repo** karena berisi naskah mahasiswa (nama dan NPM). Letakkan berkas
`.docx`/`.pdf` Anda di sana lalu jalankan `npm run verify -- testing-data/<berkas>`. Berkas sintetis dengan
kesalahan yang disengaja dapat dibuat kapan saja dengan `npm run fixture` (menulis `testing-data/fixture-proposal.docx`).

Catatan parser DOCX: properti paragraf diwariskan dengan urutan doc defaults → style tabel → style paragraf →
format langsung; indentasi dengan Tab dihitung dari tab stop (atau default tab stop di settings.xml); nomor
halaman diperkirakan dari `w:lastRenderedPageBreak` lalu dipetakan ke nomor tercetak per section (`pgNumType`);
penomoran otomatis meniru Word (level induk yang belum dipakai menampilkan nilai `start`, `isLgl`, counter dibagi
antar `w:num` dengan `abstractNum` yang sama kecuali ada `startOverride`); teks persamaan (`m:oMath`) ikut dibaca
tetapi dikecualikan dari pemeriksaan tanda baca.

## Lisensi pihak ketiga

Parser PDF memakai [mupdf](https://www.npmjs.com/package/mupdf) (WebAssembly), berlisensi **AGPL-3.0**.
Jika aplikasi ini di-deploy sebagai layanan publik, kode sumbernya harus tersedia bagi pengguna (atau gunakan
lisensi komersial Artifex). Dokumen panduan di `reference/` adalah milik Prodi Informatika Universitas Khairun.
