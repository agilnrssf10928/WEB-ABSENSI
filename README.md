# 🏫 PresensiKu Sekolah - Sistem Presensi Siswa & Guru Digital

Sistem absensi sekolah digital berbasis web yang dirancang khusus untuk **Siswa, Guru, dan Staf Sekolah** dengan verifikasi kamera selfie, deteksi lokasi GPS radius gerbang sekolah, pengajuan surat izin/sakit/dispensasi lomba, serta monitoring dan rekapitulasi laporan presensi per kelas.

> [!NOTE]
> **Semua pengguna (termasuk Admin & Kepala Sekolah) dapat melakukan absensi mandiri** dengan kamera selfie dan GPS lokasi sekolah.

---

## 🌟 Fitur Utama

### 1. Portal Siswa & Guru
- **Absen Masuk & Pulang Sekolah**:
  - Pratinjau kamera selfie langsung dengan garis panduan wajah & tombol ambil ulang.
  - Deteksi lokasi GPS gerbang sekolah otomatis via rumus Haversine.
  - Peta interaktif Leaflet OpenStreetMap dengan lingkaran radius jangkauan sekolah.
  - Evaluasi otomatis status **Tepat Waktu** vs **Terlambat** (Bel masuk: **07:00 WIB**, toleransi s/d **07:15 WIB**).
  - Bel pulang sekolah standar pukul **15:00 WIB**.
- **Riwayat Presensi**:
  - Filter presensi bulanan lengkap dengan pratinjau foto selfie, jam masuk, jam pulang, dan jarak.
- **Izin, Sakit & Dispensasi**:
  - Formulir pengajuan: Sakit (Surat Dokter), Izin Orang Tua, dan Dispensasi (Lomba / Tugas / Kegiatan Sekolah).
  - Unggah foto bukti surat pendukung.
  - Status pemantauan persetujuan oleh pihak sekolah.

### 2. Portal Admin & Kepala Sekolah
- **Absensi Mandiri Admin ("Absen Saya")**:
  - Kepala Sekolah & Admin memiliki tab khusus untuk melakukan absen masuk & pulang dengan kamera selfie & GPS.
- **Dashboard Presensi Sekolah**:
  - Statistik harian: Total Warga Sekolah, Siswa, Guru & Staf, Hadir Tepat Waktu, Terlambat, Izin/Sakit/Dispensasi, dan Belum Hadir (Alfa).
  - Grafik tren kehadiran 7 hari terakhir (Chart.js).
- **Monitoring Kehadiran Realtime**:
  - Tabel kehadiran hari ini dengan filter per Kelas/Unit (misal: XII RPL 1, XI MIPA 2, Dewan Guru) dan peran (Siswa vs Guru).
  - Modal detail presensi: Pratinjau foto selfie dan titik koordinat peta GPS saat absen.
- **Rekapitulasi & Laporan Sekolah**:
  - Filter bulanan dan kelas.
  - **Export CSV / Excel** untuk arsip rekap nilai sikap siswa.
  - **Cetak Laporan Resmi (Print View)** lengkap dengan kop surat sekolah dan tanda tangan Kepala Sekolah serta Guru Piket.
- **Persetujuan Izin & Dispensasi**:
  - Tinjau surat izin/dokter/dispensasi dan setujui / tolak permohonan.
- **Data Siswa & Guru (CRUD)**:
  - Kelola NISN (Siswa), NIP (Guru), Nama, Kelas, Jabatan, dan status akun.
- **Pengaturan Gerbang & Jam Sekolah**:
  - Jam masuk sekolah (07:00), jam pulang (15:00), toleransi keterlambatan (15 menit), koordinat sekolah, dan radius jangkauan gerbang (meter).

---

## 🔑 Akun Demonstrasi (Tersedia Tombol 1-Klik Login)

| Peran | Nama | Email | Password | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| **Kepala Sekolah / Admin** | Drs. H. Mulyadi, M.Pd | `admin@sekolah.sch.id` | `admin123` | NIP: `197501012000031001` • Bisa Absen Sendiri & Kelola Sekolah |
| **Guru / Wali Kelas** | Ibu Ratna Dewi, S.Pd | `guru@sekolah.sch.id` | `guru123` | NIP: `198505122010012005` • Dewan Guru & Wali Kelas |
| **Siswa 1** | Budi Santoso | `budi@sekolah.sch.id` | `budi123` | NISN: `0061234567` • Kelas XII RPL 1 |
| **Siswa 2** | Siti Rahmawati | `siti@sekolah.sch.id` | `siti123` | NISN: `0072345678` • Kelas XI MIPA 2 |
| **Siswa 3** | Ahmad Fauzi | `ahmad@sekolah.sch.id` | `ahmad123` | NISN: `0083456789` • Kelas X IPS 1 |

---

## 🚀 Menjalankan Aplikasi

```bash
cd /home/agilnurussofa/.gemini/antigravity/scratch/web-absensi
node src/server.js
```
Akses di browser:
👉 **http://localhost:3000**

Jalankan pengujian:
```bash
npm test
```
