# MyTax & Biz Audit Hub 2.6

PWA mobile-first untuk rekod resit cukai peribadi dan audit perniagaan. Projek ini sedia untuk drag-and-drop deploy ke Netlify atau disambungkan ke Git.

Versi 2.1 menggunakan tema cerah premium dengan palet putih, emerald dan aksen champagne gold untuk rupa yang lebih profesional.

## Fungsi utama

- Navigasi bawah khas telefon dan kad resit responsif
- Scan kamera, compression gambar dan Gemini OCR melalui Netlify Function
- Tambah, edit, lihat, putar, muat turun serta padam resit
- Sokongan beberapa gambar atau muka surat bagi satu resit
- Gemini authorization key melalui header `x-goog-api-key`
- Mesej ralat OCR khusus untuk auth, model, kuota, gambar dan timeout
- Migrasi selamat daripada struktur Supabase single-file lama
- Upload gambar menggunakan penukaran Data URL ke Blob secara lokal tanpa melanggar CSP
- Audit Evidence Bundle dengan penapis bulan/kategori, satu resit satu halaman A4, download PDF dan cetakan gambar
- Amaran OCR, pengesanan pendua dan loading state
- Dashboard tahunan, carta bulanan, had kategori dan senarai perlu disemak
- Supabase Auth, Row Level Security dan Storage
- Simpanan offline serta sync semula apabila internet kembali
- Eksport CSV, cetak PDF, backup dan restore JSON
- Tema gelap, install PWA dan ikon maskable

## Deploy Netlify

1. Zip kandungan folder ini atau push ke GitHub.
2. Di Netlify pilih **Add new site → Deploy manually** dan upload ZIP. Untuk fungsi OCR, kaedah Git lebih disyorkan kerana Netlify membina folder Functions dengan konsisten.
3. Buka **Site configuration → Environment variables** dan tambah:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` = `gemini-2.5-flash` (boleh ditukar jika model akaun anda berbeza)
4. Trigger **Clear cache and deploy site**.

Kunci Gemini tidak berada dalam HTML atau JavaScript browser. `SUPABASE_ANON_KEY` memang kunci awam dan dilindungi oleh polisi RLS.

## Konfigurasi Supabase

1. Cipta projek Supabase.
2. Buka **SQL Editor** dan jalankan seluruh kandungan `supabase-setup.sql`.
3. Di **Authentication → URL Configuration**, masukkan URL Netlify sebagai Site URL.
4. Untuk ujian mudah, anda boleh matikan **Confirm email**. Untuk penggunaan sebenar, biarkan pengesahan e-mel aktif.

Jika projek Supabase pernah digunakan oleh versi single-file, jalankan `supabase-migrate-from-single-file.sql` dan bukan setup kosong. Skrip ini mengekalkan rekod lama, menambah medan pemilikan, RLS dan private Storage.

## Nota migrasi

Versi ini menggunakan jadual `tax_profiles` dan `receipts` dengan `owner_id`. Ia sengaja tidak terus menggunakan struktur lama yang tiada pemilikan pengguna kerana struktur lama tidak selamat untuk data kad pengenalan dan cukai.

## Ujian tempatan

Gunakan Netlify CLI supaya `/api/config` dan `/api/ocr` berfungsi:

```bash
npx netlify dev
```

Buka alamat yang dipaparkan oleh Netlify CLI. Jika environment variables belum diisi, aplikasi berjalan dalam **mod peranti** menggunakan localStorage.
