/* Konfigurasi aplikasi.
   apiUrl: alamat Web App Google Apps Script. Semua perangkat otomatis memakai alamat ini.
   Saat kode Apps Script diperbarui, pakai Deploy > Manage deployments > Edit > New version
   agar alamat ini tidak berubah.
   Jangan menaruh kode akses (TOKEN) di file ini karena repositori GitHub Pages bersifat publik. */
window.APP_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbz-XuCT-Z2vUk0ymSGms9J04zmrWRoY5_LQ66ARDMAzV30MwqnKMVdRcukwvYZ1AMfz/exec',
  institusi: 'Poltekkes Kemenkes Manado',
  maxCpl: 4,      // sesuai kolom formulir FM.I-2-02 (CPL1–CPL4)
  maxCpmk: 5,     // sesuai kolom formulir FM.I-2-02 (CPMK1–CPMK5)
  jumlahMinggu: 16,
  mingguUts: 8,
  mingguUas: 16,
  templatePath: 'template/rps-template.docx'
};
