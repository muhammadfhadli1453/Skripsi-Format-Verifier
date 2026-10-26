# Pemeriksa Format Skripsi — Prodi Informatika Universitas Khairun

Aplikasi web (Next.js) untuk memeriksa **format** naskah Kerja Praktik / Proposal / Skripsi
(`.docx` atau `.pdf`) terhadap dokumen *Format Penulisan* Prodi Informatika Unkhair
(`reference/FORMAT PENULISAN UPDATE 012424_202301.pdf`). Hasilnya adalah daftar masalah
dengan lokasi (halaman/bagian/kutipan teks), nilai yang diharapkan vs ditemukan, dan cara memperbaikinya.

Pemeriksaan utama **berbasis aturan** (deterministik, tanpa biaya). Pemeriksaan **AI** (aktif secara
bawaan, dapat dimatikan) hanya untuk (1) istilah asing yang belum italic, (2) salah ketik, dan (3) ringkasan
prioritas perbaikan. Penyedia AI dapat dipilih: **OpenRouter** (model dari `OPENROUTER_MODEL`) atau **Anthropic**
langsung (bawaan `claude-haiku-4-5`). Lihat `.env.example`.

Bila penyimpanan dikonfigurasi (Vercel Blob privat + Neon Postgres), berkas yang diunggah disimpan agar
tersedia **papan peringkat** 5 skor format tertinggi yang naskahnya dapat diunduh sebagai contoh.

## Menjalankan

Memerlukan Node.js ≥ 20.9.

```bash
npm install
cp .env.example .env        # isi OPENROUTER_API_KEY atau CLAUDE_API_KEY untuk pemeriksaan AI
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
src/lib/ai/provider.ts      pemilihan penyedia AI (AI_PROVIDER: openrouter | anthropic) + pemanggilan model
src/lib/ai/checks.ts        pemeriksaan AI: istilah asing, salah ketik & ringkasan
src/lib/storage/db.ts       Neon (lazy) + skema tabel submissions; deteksi konfigurasi Blob/DB
src/lib/storage/submissions.ts  simpan unggahan, papan peringkat, izin unduh 5 besar
src/app/api/verify/route.ts POST JSON {blobPathname, docType, ai, leaderboard} (dengan penyimpanan)
                            atau multipart (file, docType, ai) tanpa penyimpanan → VerifyReport JSON
src/app/api/upload/route.ts presigned PUT ke Blob privat (unggah langsung dari browser, maks. 40 MB)
src/app/api/leaderboard     GET ?docType= → 5 teratas;  src/app/api/status → fitur yang aktif
src/app/api/submissions/[id]/file  GET → unduh berkas (hanya naskah yang sedang masuk 5 besar)
src/components/*            UI unggah, laporan, papan peringkat
```

## Penyimpanan & papan peringkat

1. Di Vercel, hubungkan **Blob store privat** (`vercel blob create-store <nama> --access private`) dan
   **Neon** (Marketplace: `vercel integration add neon`) ke proyek. Variabel `BLOB_STORE_ID` dan
   `DATABASE_URL` terisi otomatis.
2. Lokal: `vercel env pull .env.local`. Tabel dibuat otomatis saat pertama dipakai, atau `npm run db:init`.

Tanpa kedua variabel itu aplikasi tetap berjalan seperti semula (berkas tidak disimpan, papan peringkat
disembunyikan). Catatan: tanpa Blob, berkas dikirim di badan request, yang di Vercel dibatasi 4,5 MB.

Aturan: skor = skor **berbasis aturan saja**. Temuan AI tetap ditampilkan dan dihitung jumlahnya, tetapi
tidak mengubah skor, sehingga skor di laporan sama dengan skor di papan peringkat. Setiap naskah yang diperiksa
otomatis masuk papan peringkat dengan nama dan NPM yang dibaca dari sampul (baris setelah OLEH;
`src/lib/student.ts`). Satu baris per NPM (skor terbaiknya); naskah tanpa NPM terbaca
tampil sendiri sebagai "Tanpa nama". Seri dimenangkan unggahan lebih awal. Naskah yang sedang masuk 5 besar (keseluruhan
atau per jenis naskah) dapat diunduh siapa pun sebagai contoh; naskah lain tetap privat di Blob. Tidak ada akun
pengguna.

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

### Dua acuan: PPTA Universitas Khairun dan format Prodi Informatika

`reference/official format.pdf` (Panduan Penulisan Tugas Akhir/PPTA, Nov 2023) adalah panduan **terbaru** dan
diikuti bila mengatur dokumen yang sama dengan format prodi. Setiap bentrokan diperiksa ruang lingkupnya, karena
banyak bagian PPTA ditulis untuk tesis, disertasi, laporan akhir vokasi, atau draf jurnal, bukan untuk skripsi S1.
Temuan berlabel **PPTA** (`issue.basis = "ppta"`) atau **Prodi + PPTA** bila keduanya sepakat.

**Bentrokan nyata (dokumen sama) → PPTA diikuti**

| Hal | Format prodi (lama) | PPTA (diikuti) | Berlaku untuk |
|---|---|---|---|
| Kepala abstrak | Judul kapital di tengah, nama + nomor afiliasi, alamat, e-mail (gaya artikel jurnal) | `NAMA MAHASISWA. Judul. Dibimbing oleh NAMA PEMBIMBING …` — kapital, tanpa NPM, tanpa gelar (3.1.4, Lamp. 9) | Skripsi |
| Isi abstrak | 150–250 kata | 1 paragraf, 1 spasi; maks. 100 kata (3.1.4) **atau** 500 kata (Lamp. 9) — PPTA tidak konsisten, >500 = peringatan, 101–500 = info | Skripsi |
| Kata kunci | maks. 6 | maks. 5, urut alfabet (3.1.4) | Skripsi |
| Nomor halaman abstrak | Romawi dicetak | Dihitung i, tidak dicetak (3.1.4) | Skripsi |
| Urutan bagian awal | Sampul, Pengesahan, Pernyataan, Persembahan, Kata Pengantar, Daftar Isi, Daftar Gambar, Daftar Tabel, Abstrak | Sampul, Pernyataan, Abstrak/Abstract, Hak Cipta, Tim Penguji, Pengesahan, Kata Pengantar, Daftar Isi, Daftar Tabel, Daftar Gambar, Daftar Lampiran (3.1) | Skripsi |
| Halaman wajib tambahan | — | Hak Cipta, Tim Penguji, Riwayat Hidup, Abstract (Inggris) (3.1, 3.3) | Skripsi |
| Lembar pengesahan | "… ini telah disahkan", Tim Penguji, Mengetahui/Menyetujui | Lembaran Pengesahan: Nama, NPM, Judul, Program Studi, Komisi Pembimbing, (skripsi: Komisi Penguji, Dekan), Koordinator Prodi, Tanggal Ujian (Lamp. 11a, 12) | Proposal, Skripsi |
| Pernyataan | Judul Capitalize Each Word; Nama, NPM, Fakultas, Jurusan | Pernyataan Orisinalitas: judul KAPITAL, pernyataan plagiasi, Nama/NIM/PS (Lamp. 8) | Skripsi |
| Huruf judul gambar/tabel | Huruf Awal Setiap Kata Kapital | Hanya huruf pertama kapital, kecuali nama/istilah khusus (6.1.1 a.4, 6.2) | Semua |
| Daftar Gambar/Tabel | Selalu ada | Hanya jika lebih dari satu gambar/tabel (3.1.12) | Semua |

**Bukan bentrokan (lain dokumen / PPTA tidak mengatur) → format prodi tetap**

| Hal | Alasan |
|---|---|
| Huruf Times New Roman | Hanya pada templat sampul tesis/disertasi, sampul skripsi fakultas lain (Hukum, Perikanan, FKIP), dan halaman sampul/judul; PPTA tidak mengatur huruf isi naskah. |
| Tata letak sampul, logo | PPTA menyerahkan sampul ke peraturan fakultas (3.1.1); tidak ada templat Fakultas Teknik. Logo 4 × 4 cm vs 4,15 × 4 cm masih dalam toleransi. |
| Margin, spasi isi, posisi nomor halaman BAB | Tidak diatur PPTA. |
| Format Daftar Isi tanpa "BAB" | Lampiran 16 khusus tesis dan disertasi. |
| Ringkasan/Summary | Untuk laporan akhir, tesis, dan disertasi (3.1.5), bukan skripsi. |
| Urutan ucapan terima kasih | Lampiran 15 hanya contoh (bertuliskan tesis/disertasi); urutan prodi tetap. |
| Sitasi `(Nama, 2020)` vs `(Nama 2020)` | PPTA menetapkan gaya APA (berkoma) tetapi sebagian contohnya tanpa koma; hanya ketidakkonsistenan yang ditandai. |
| Format entri daftar pustaka | PPTA menyebut APA tetapi contohnya gaya CSE; format prodi juga campuran; tidak dipaksakan. |
| Draf jurnal & poster (7.3) | Dokumen luaran terpisah, bukan naskah skripsi. |
| Laporan Kerja Praktik | Tidak dicakup PPTA. |

**Aturan tambahan dari PPTA (format prodi tidak mengatur)**

| Kode | Pemeriksaan | Dasar PPTA |
|---|---|---|
| SPELL-01 | Ejaan tidak baku (aktifitas, merubah, mempengaruhi, terimakasih, di gunakan, diantaranya, diatas, …) | 4.2.2, Tabel 4.1 |
| CITE-01…04 | `et al.` miring; "dan" bukan "&"; beberapa sumber dalam satu kurung, dipisah `;`, urut tahun | 7.1.3 |
| NUM-01/02/03 | Desimal koma, angka–satuan berspasi, kalimat tidak diawali angka | 5.1, 5.2 |
| CAP-16/17 | Nomor gambar/tabel tanpa titik, judul tidak diakhiri titik | 6.1.1, 6.2 |
| SUB-09 | Kata penghubung pada judul subbab huruf kecil | 4.2.1.2 |
| STRUCT-04/05 | Tinjauan pustaka ≤ 10% bagian utama; penutup memuat Simpulan dan Saran (skripsi) | 3.2, 3.2.6 |
| ABS-13/15 | Abstrak tanpa rujukan pustaka/gambar/tabel; Abstract bahasa Inggris (skripsi) | 3.1.4 |
| REF-09/10/11 | Referensi ≤ 10 tahun, minimal 20, tanpa Wikipedia | BAB VII, 7.3 |

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
lisensi komersial Artifex).

Dokumen di `reference/`:
- `official format.pdf` — Panduan Penulisan Tugas Akhir (PPTA) Universitas Khairun, November 2023 (panduan terbaru, tingkat universitas).
- `FORMAT PENULISAN UPDATE 012424_202301.{docx,pdf}` — format penulisan Prodi Informatika (dipakai untuk hal yang tidak diatur PPTA).

Keduanya milik Universitas Khairun. Rekaman/transkrip tutorial (`reference/tutorial*`) tidak ikut repo.
