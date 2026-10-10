# Hackathon-JLKPnM
Proyek Form 14 untuk TIM Jangan Lupa Kerjakan PA-nya MAS.

EduQuest membantu mahasiswa mengajukan koreksi presensi melalui Form 14 dan membantu petugas BAAK memeriksa serta menerapkan keputusan. Antarmukanya berbentuk ruang interaktif. Rincian komponen, alat, kontribusi, dan penggunaan AI ada di [architecture.md](architecture.md).

## Target user dan problem

| Pengguna | Kebutuhan yang ditangani |
| --- | --- |
| Mahasiswa | Mengunggah Form, mengetahui kekurangan scan atau bukti pendukung, dan memantau status koreksi presensi. |
| Petugas BAAK/program studi | Melihat pengajuan dalam lingkup programnya, memeriksa bukti, memberi keputusan per baris, dan menerapkan perubahan presensi. |
| Mahasiswa dan petugas | Menanyakan kebijakan akademik yang memiliki sumber dokumen resmi aktif. |

Proses manual membuat kelengkapan Form 14 dan status pengajuan sulit diketahui lebih awal. Sistem membaca scan, memeriksa aturan, lalu menempatkan keputusan akhir pada petugas. Asisten BAAK hanya menjawab pertanyaan yang didukung dokumen resmi yang tersedia.

## Workflow

1. Pengguna mendaftar atau masuk dengan Supabase Auth; profil menentukan peran mahasiswa atau petugas.
2. Mahasiswa mengunggah Form 14 (PDF satu halaman, PNG, atau JPG), serta surat dokter jika alasan sakit memerlukannya.
3. Server melakukan OCR lokal, mencocokkan baris dengan presensi berstatus `A`, dan menampilkan masalah yang harus diperbaiki. Scan yang siap dapat diajukan.
4. Petugas melihat antrean dalam lingkup program studinya, membuka berkas, mencatat pemeriksaan tanda tangan/bukti, lalu menyetujui, menolak, atau meminta perbaikan per baris.
5. Keputusan yang disetujui diterapkan ke data presensi. Mahasiswa melihat status terbaru; jejak keputusan tersimpan di database.
6. Petugas dapat meminta ringkasan dashboard. Pengguna yang masuk dapat memakai **Tanya BAAK**; jawaban menyertakan sumber jika dokumen relevan ditemukan.

## Data sources

| Sumber | Pemakaian |
| --- | --- |
| Form 14 dan surat dokter yang diunggah pengguna | OCR, validasi, dan pemeriksaan petugas; disimpan dalam bucket Supabase Storage privat `form14-private`. |
| Tabel Supabase `profiles`, `attendance`, `form14_*` | Identitas/peran, presensi, pengajuan, versi, hasil scan, keputusan, dan audit. |
| Peraturan Akademik PENS 2024 | Korpus demo chatbot dalam `backend/knowledge/peraturan-akademik-2024.json`, dengan tautan ke [PDF resmi PENS](https://www.pens.ac.id/wp-content/uploads/2024/09/SK-PERAK-2024_convert.pdf). |
| Berkas `backend/tests/fixtures/` | Data contoh untuk pengujian lokal; bukan kebijakan resmi atau data produksi. |

## Architecture

Frontend HTML/CSS/JavaScript dan Phaser disajikan oleh Next.js dari `/frontend/`. API Next.js memeriksa token Supabase, menjalankan OCR dan validasi, lalu berinteraksi dengan Supabase PostgreSQL/Storage. Row Level Security membatasi pembacaan menurut pemilik data dan program petugas. Fitur AI memanggil gateway LLM dari server: ringkasan memakai snapshot dashboard terotorisasi, sedangkan chatbot mencari potongan dokumen aktif sebelum membuat jawaban. Lihat [architecture.md](architecture.md) untuk diagram, pustaka, dan batasannya.

## Setup instructions

Prasyarat: Node.js yang mendukung `--experimental-transform-types` (pengujian dokumen ini memakai Node.js 24.19.0), npm, proyek Supabase khusus demo dengan Auth/Storage, serta Poppler (`pdftoppm`) untuk scan PDF. Frontend memakai CDN Tailwind, Phaser, dan Supabase JS sehingga browser perlu akses ke CDN tersebut.

1. Di `backend/`, jalankan `npm install` (atau gunakan pengelola paket yang sesuai dengan lockfile `pnpm-lock.yaml`). Isi `backend/.env.local` dengan `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, dan `AI_API_KEY`. `AI_BASE_URL` dan `AI_MODEL` opsional. Simpan `DATABASE_URL` dalam `backend/.env.database.local` untuk migrasi/ingest; `SUPABASE_SECRET_KEY` atau `SUPABASE_SERVICE_ROLE_KEY` hanya untuk operasi admin/demo. Jangan masukkan kunci rahasia ke frontend.
2. Di `database/`, jalankan `npm ci`. Terapkan `001_form14.sql` **sekali pada proyek Supabase baru** melalui SQL editor atau klien PostgreSQL yang berwenang. Setelah itu jalankan `npm run migrate:review-checks`, `npm run migrate:scan-flow`, dan `npm run migrate:knowledge` sesuai urutan. Skrip migrasi membaca variabel dari `backend/.env.local` dan `backend/.env.database.local`.
3. Jalankan `npm run dev` dari `backend/`, lalu buka `http://localhost:3000/`. Proses `predev` menyalin frontend ke direktori publik. Jangan membuka HTML melalui `file:` atau Live Server.
4. Untuk chatbot, operator dapat mengimpor JSON dokumen resmi yang telah disetujui dengan perintah pada bagian **Asisten AI BAAK** di bawah. Jalankan `--dry-run` lebih dulu untuk memeriksa jumlah potongan.

## Test cases and results

Verifikasi lokal pada 10 Oktober 2026: dari `backend/`, `npm test` **lulus 31/31** dan `npm run typecheck` **lulus**. Kasus otomatis mencakup OCR scan lengkap/tidak lengkap, validasi tanda tangan dan surat dokter, pencocokan presensi, keputusan petugas, ringkasan dashboard, pencarian sumber RAG, penolakan sumber lemah, dan kegagalan gateway. Tes ini tidak membuktikan seluruh alur antarmuka pada browser.

| Kasus | Hasil |
| --- | --- |
| OCR dan validasi Form 14, termasuk scan tidak lengkap | Lulus dalam suite unit lokal. |
| Status presensi, persetujuan, dan ringkasan dashboard | Lulus dalam suite unit lokal. |
| Chatbot: sumber relevan, sumber lemah, dan galat gateway | Lulus dalam suite unit lokal dengan mock; bukan pengukuran gateway langsung. |
| Pemeriksaan tipe TypeScript | Lulus. |
| Alur klik mahasiswa dan petugas di browser | selesai. |

## Token usage dan limitations

Panggilan ringkasan membatasi `max_tokens` keluaran menjadi 250 dan chatbot menjadi 180. Angka tersebut adalah batas per permintaan, **bukan** total token yang terpakai. Log pemakaian token, biaya, dan total penggunaan AI coding assistant selama acara tidak tersedia di repo.

- OCR mengandalkan tata letak Form yang tetap dan kualitas scan memadai; keputusan tetap diperiksa petugas.
- Korpus chatbot demo baru mencakup satu peraturan akademik. Prosedur Form belum memiliki sumber resmi dalam korpus, sehingga chatbot menolak menjawabnya.
- Fitur AI memerlukan gateway dan kredensial server. Respons memakai JSON tanpa streaming.

## Team responsibilities

| Anggota tim | Tanggung jawab selama event |
| --- | --- |
| Eka Bayu Sakhrulban | Backend, OCR, dan AI. |
| Muhammad Fatan Makhsani | Frontend dan timeline. |
| Panca Puspita Sari | UI/UX dan seluruh aset produk. |

Pembagian ini diberikan langsung oleh tim. Angka penggunaan token belum tersedia di repo.

## Struktur proyek

- `backend/` — API Next.js, aturan validasi, skrip demo, dan pengujian.
- `backend/tests/fixtures/` — gambar dan PDF contoh untuk pengujian lokal.
- `database/` — migrasi SQL dan alat migrasi untuk basis data demo.

## Asisten AI BAAK

Dashboard pegawai mempunyai tombol **Buat / perbarui ringkasan**. Semua pengguna yang masuk dapat membuka **Tanya BAAK**. Jawaban prosedur hanya diberikan jika pencarian menemukan potongan dokumen resmi aktif; tanpa sumber, aplikasi mengarahkan pengguna ke BAAK.

Pengaturan server: `AI_API_KEY` wajib diisi oleh pemilik proyek. `AI_BASE_URL` dan `AI_MODEL` opsional, dengan nilai bawaan sesuai PRD. Kunci tidak dipasang sebagai variabel `NEXT_PUBLIC_*`. Koneksi gateway dan nama model perlu diuji pada lingkungan demo sebelum rilis.

Untuk menyiapkan database, jalankan `npm run migrate:knowledge` dari `database/`. Skrip memilih `004_rag_knowledge.sql` untuk database yang belum memiliki tabel pengetahuan, atau `005_rag_upgrade.sql` jika skema vektor lama sudah ada. Keduanya tidak perlu dijalankan manual secara berurutan.

Operator BAAK memasukkan dokumen resmi yang telah disetujui melalui `backend/scripts/ingest-knowledge.mjs` dari server dengan `SUPABASE_SERVICE_ROLE_KEY`. Contoh input JSON:

```json
{
  "document_key": "panduan-form14",
  "version_no": 1,
  "title": "Panduan Form 14",
  "source_url": "https://situs-resmi.example/panduan-form14",
  "approved_by": "BAAK",
  "effective_at": "2026-10-10",
  "expires_at": null,
  "content": "Isi dokumen resmi yang telah disetujui."
}
```

Jalankan dari `backend/`: `node --env-file=.env.local --env-file=.env.database.local --experimental-transform-types scripts/ingest-knowledge.mjs dokumen-disetujui.json`. Skrip memakai `SUPABASE_SERVICE_ROLE_KEY` jika ada, atau `DATABASE_URL` operator sebagai alternatif transaksional. Tambahkan `--dry-run` untuk melihat jumlah potongan tanpa menulis ke basis data. `source_url` harus berupa tautan dokumen resmi yang dapat dibuka pengguna. Saat versi baru diunggah, versi lama dinonaktifkan. Jangan gunakan PRD, data pribadi pengajuan, atau contoh dummy sebagai korpus kebijakan.

Korpus demo saat ini berasal dari Peraturan Direktur PENS Nomor 2 Tahun 2024 dalam `backend/knowledge/peraturan-akademik-2024.json`, diekstrak dari `backend/tests/fixtures/peraturan akademik.pdf`. Sumber yang ditampilkan kepada pengguna adalah PDF di situs resmi PENS. Dokumen ini tidak menjelaskan prosedur pengajuan Form 14, sehingga pertanyaan tersebut ditolak sampai sumber resmi yang tepat tersedia.
