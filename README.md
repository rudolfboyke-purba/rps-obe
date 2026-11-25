# RPS OBE — Poltekkes Kemenkes Manado

Aplikasi web progresif (PWA) untuk menyusun Rencana Pembelajaran Semester berbasis OBE sesuai formulir **FM.I-2-02-rev.3-2024**. Hasil akhirnya diunduh sebagai dokumen Word lengkap dengan kop resmi.

- Hosting: GitHub Pages (gratis)
- Database: Google Sheet, melalui Google Apps Script
- Bisa dipasang di HP/laptop dan dibuka saat offline (data terakhir tetap terlihat)

## Isi folder

```
index.html               halaman aplikasi
manifest.webmanifest     identitas PWA
sw.js                    service worker (cache offline)
css/style.css            tampilan
js/config.js             pengaturan (batas CPL/CPMK, jumlah minggu, dll.)
js/api.js                penghubung ke Google Sheet / penyimpanan lokal
js/importer.js           pembaca file CPL & bahan kajian (Excel, Word, PDF)
js/docx-fill.js          pengisi templat Word
js/app.js                logika aplikasi
template/rps-template.docx   formulir RPS resmi yang sudah diberi penanda isian
icons/                   ikon aplikasi
apps-script/Code.gs      kode untuk Google Apps Script (tidak dipakai oleh GitHub)
```

## Langkah 1 — Siapkan Google Sheet

1. Buat Google Sheet baru, misalnya **Database RPS OBE**.
2. Buka **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu tempel seluruh isi file `apps-script/Code.gs`. Simpan.
4. Pilih fungsi **setup** di bilah atas, klik **Run**, dan izinkan akses saat diminta.
   Lembar *Prodi*, *CPL*, *BahanKajian*, dan *RPS* akan dibuat otomatis.
5. Buka **Project Settings (ikon roda gigi) → Script Properties**. Di sana sudah ada `TOKEN` hasil setup. Ganti nilainya dengan kode akses pilihan Anda bila perlu. Kode ini nanti dibagikan hanya kepada dosen yang boleh menyimpan data.
6. Klik **Deploy → New deployment**, pilih jenis **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Klik **Deploy**, lalu salin **Web app URL** (berakhiran `/exec`).

> Jika kode Apps Script diubah di kemudian hari, gunakan **Deploy → Manage deployments → Edit → Version: New version** agar URL tetap sama.

## Langkah 2 — Unggah ke GitHub Pages

1. Buat repositori baru di GitHub, misalnya `rps-obe`.
2. Unggah semua file dan folder di atas (boleh tanpa folder `apps-script`) melalui **Add file → Upload files**.
3. Buka **Settings → Pages**. Pada *Source* pilih **Deploy from a branch**, branch **main**, folder **/ (root)**. Simpan.
4. Tunggu 1–2 menit. Aplikasi tersedia di `https://<nama-akun>.github.io/rps-obe/`.

## Langkah 3 — Hubungkan aplikasi ke Google Sheet

1. Buka aplikasi, masuk ke **Pengaturan**.
2. Tempel Web app URL dan isi kode akses (TOKEN).
3. Klik **Simpan dan uji koneksi**. Label di kanan atas berubah menjadi **Google Sheet**.

Setiap perangkat perlu melakukan langkah ini sekali. Kode akses disimpan di perangkat masing-masing dan tidak tercantum di GitHub.
Jika ingin URL terisi otomatis untuk semua orang, isi `apiUrl` di `js/config.js` (kode akses tetap diisi manual).

## Cara pakai

1. **Data master**
   - *Program studi*: tambahkan prodi dan nama kaprodi.
   - *CPL Prodi* dan *Bahan kajian*: klik **Unggah file** (Excel, CSV, Word .docx, atau PDF berteks). Periksa tabel pratinjau, perbaiki teks yang terpotong (tombol ↑ menggabungkan baris ke atasnya), lalu simpan. Templat Excel kosong bisa diunduh untuk hasil yang paling rapi.
2. **Buat RPS baru**, lalu ikuti enam tahap di panel kiri: Identitas → CPL dan CPMK → Pemetaan → Penilaian → Rencana mingguan → Pratinjau dan unduh.
3. Titik di panel kiri menunjukkan status tiap tahap: hijau lengkap, kuning perlu dicek, merah belum sesuai.
4. Pemeriksaan otomatis mencakup total penilaian 100%, total bobot RKPM 100%, kesesuaian bobot tiap komponen antara tabel penilaian dan RKPM, serta CPMK yang belum dipetakan ke CPL.
5. Klik **Simpan** untuk menyimpan ke Google Sheet, dan **Unduh Word** di tahap terakhir.

Draf tersimpan otomatis di perangkat selama mengetik, jadi isian tidak hilang meski koneksi terputus. Draf yang belum disimpan tampil di daftar RPS dengan keterangan *Draf belum disimpan*.

## Catatan

- **Batas CPL dan CPMK** mengikuti kolom formulir: 4 CPL dan 5 CPMK. Batas ini ada di `js/config.js`, tetapi menaikkannya juga memerlukan penambahan kolom di templat Word.
- **Kolom penilaian** mengikuti formulir, yaitu dipetakan ke CPL (bukan CPMK) meskipun judul barisnya "Kaitan dengan CPMK".
- **PDF hasil scan** tidak bisa dibaca. Gunakan Word atau Excel.
- **Mode lokal**: tanpa Web App URL, data disimpan di browser saja. Data mode lokal bisa dikirim ke Google Sheet dari menu Pengaturan setelah terhubung.
- **Memperbarui aplikasi**: setelah mengubah file di GitHub, naikkan nilai `VERSION` di `sw.js` (misalnya `rps-obe-v2`) agar perangkat pengguna mengambil versi terbaru.
- **Mengganti templat Word**: penanda isian ditulis dalam kurung kurawal, misalnya `{nama}`. Baris tabel yang berulang ditandai `{#rkpm}` di sel pertama dan `{/rkpm}` di sel terakhir. Setiap penanda harus diketik utuh dalam satu kali ketik agar tidak terpecah oleh Word.
