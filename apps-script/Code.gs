/**
 * RPS OBE — API Google Sheet
 * Tempel kode ini di Extensions > Apps Script pada Google Sheet yang akan menjadi database.
 * 1. Jalankan fungsi setup() sekali (izinkan akses saat diminta).
 * 2. Project Settings > Script Properties: tambahkan TOKEN = kode akses pilihan Anda.
 * 3. Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".
 * 4. Salin URL Web App (berakhiran /exec) ke menu Pengaturan di aplikasi.
 */

const SCHEMA = {
  Prodi: ['id', 'nama', 'kaprodi'],
  CPL: ['id', 'prodi', 'kode', 'ranah', 'rumusan'],
  BahanKajian: ['id', 'prodi', 'kode', 'nama'],
  RPS: ['id', 'prodi', 'kode', 'nama', 'dosen', 'updated', 'data']
};
const CHUNK = 45000; // batas aman isi satu sel (maks. 50.000 karakter)

function setup() {
  Object.keys(SCHEMA).forEach(sheetOf_);
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('TOKEN')) p.setProperty('TOKEN', Utilities.getUuid().slice(0, 8));
  Logger.log('Siap. Kode akses (TOKEN): ' + p.getProperty('TOKEN'));
}

function doGet() {
  return json_({ ok: true, data: { app: 'RPS OBE API', waktu: new Date().toISOString() } });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (token && req.token !== token) return json_({ ok: false, error: 'Kode akses salah. Periksa menu Pengaturan.' });
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { return json_({ ok: true, data: route_(req) }); }
    finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function route_(req) {
  switch (req.action) {
    case 'ping': return { sheets: Object.keys(SCHEMA) };
    case 'list': return readAll_(check_(req.sheet));
    case 'upsert': return upsert_(check_(req.sheet), req.rows || []);
    case 'remove': return remove_(check_(req.sheet), req.ids || []);
    case 'listRps': return readAll_('RPS').map(r => { delete r.data; return r; });
    case 'getRps': {
      const r = readAll_('RPS').find(x => x.id === req.id);
      return r && r.data ? JSON.parse(r.data) : null;
    }
    case 'saveRps': {
      const rps = req.rps;
      if (!rps || !rps.id) throw new Error('Data RPS tidak lengkap.');
      return upsert_('RPS', [{ id: rps.id, prodi: rps.prodi || '', kode: rps.kode || '', nama: rps.nama || '',
        dosen: rps.dosen || '', updated: rps.updated || Date.now(), data: JSON.stringify(rps) }]);
    }
    case 'deleteRps': return remove_('RPS', [req.id]);
    default: throw new Error('Aksi tidak dikenal: ' + req.action);
  }
}

function check_(name) {
  if (!SCHEMA[name] || name === 'RPS') throw new Error('Lembar tidak dikenal: ' + name);
  return name;
}

function sheetOf_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Membaca seluruh baris menjadi objek. Untuk RPS, kolom data dapat terpecah ke beberapa kolom.
function readAll_(name) {
  const sh = sheetOf_(name);
  const values = sh.getDataRange().getValues();
  const cols = SCHEMA[name];
  return values.slice(1).filter(r => r[0] !== '' && r[0] != null).map(r => {
    const o = {};
    cols.forEach((k, i) => { o[k] = r[i] === null || r[i] === undefined ? '' : r[i]; });
    if (name === 'RPS') o.data = r.slice(cols.length - 1).join('');
    cols.forEach(k => { if (k !== 'updated' && typeof o[k] !== 'string') o[k] = String(o[k]); });
    if (name === 'RPS') o.updated = Number(o.updated) || 0;
    return o;
  });
}

function toRow_(name, obj) {
  const cols = SCHEMA[name];
  const row = cols.map(k => obj[k] == null ? '' : obj[k]);
  if (name === 'RPS') {
    const data = String(row.pop());
    for (let i = 0; i < Math.max(1, Math.ceil(data.length / CHUNK)); i++) row.push(data.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  return row;
}

function writeAll_(name, objs) {
  const sh = sheetOf_(name);
  const rows = objs.map(o => toRow_(name, o));
  const width = Math.max(SCHEMA[name].length, ...rows.map(r => r.length));
  const header = SCHEMA[name].slice();
  for (let i = header.length; i < width; i++) header.push('data_' + (i - SCHEMA[name].length + 2));
  const matrix = [header].concat(rows.map(r => r.concat(Array(width - r.length).fill(''))));
  sh.clearContents();
  const range = sh.getRange(1, 1, matrix.length, width);
  range.setNumberFormat('@');           // simpan sebagai teks agar kode seperti "01" tidak berubah
  range.setValues(matrix.map(r => r.map(v => typeof v === 'string' ? v : String(v))));
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
}

function upsert_(name, rows) {
  const all = readAll_(name);
  rows.forEach(r => {
    if (!r || !r.id) return;
    const i = all.findIndex(x => x.id === r.id);
    if (i >= 0) all[i] = Object.assign(all[i], r); else all.push(r);
  });
  writeAll_(name, all);
  return rows.length;
}

function remove_(name, ids) {
  const all = readAll_(name);
  writeAll_(name, all.filter(x => ids.indexOf(x.id) < 0));
  return ids.length;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
