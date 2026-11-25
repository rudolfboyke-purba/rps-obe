/* Lapisan data.
   - Mode Google Sheet: memanggil Web App Google Apps Script (lihat apps-script/Code.gs).
   - Mode lokal: data disimpan di browser (localStorage), cocok untuk mencoba aplikasi. */
window.Api = (function () {
  const P = 'rpsobe.';
  const SHEETS = ['Prodi', 'CPL', 'BahanKajian'];

  function settings() {
    // Alamat yang diisi di Pengaturan (jika ada) didahulukan; selain itu pakai alamat di config.js
    const saved = (localStorage.getItem(P + 'apiUrl') || '').trim();
    return {
      apiUrl: saved || (window.APP_CONFIG.apiUrl || '').trim(),
      token: localStorage.getItem(P + 'token') || ''
    };
  }
  function saveSettings(apiUrl, token) {
    localStorage.setItem(P + 'apiUrl', (apiUrl || '').trim());
    localStorage.setItem(P + 'token', token || '');
  }
  function mode() { return settings().apiUrl ? 'sheet' : 'local'; }

  // ---------- penyimpanan lokal ----------
  function lget(key, def) {
    try { const v = localStorage.getItem(P + key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function lset(key, val) { localStorage.setItem(P + key, JSON.stringify(val)); }

  // ---------- panggilan Apps Script ----------
  async function call(action, payload, opt) {
    const s = (opt && opt.settings) || settings();
    if (!s.apiUrl) throw new Error('Alamat Web App belum diisi di Pengaturan.');
    let res;
    try {
      // Body string -> Content-Type text/plain, sehingga tidak memicu preflight CORS.
      res = await fetch(s.apiUrl, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action, token: s.token }, payload || {})),
        redirect: 'follow'
      });
    } catch (e) {
      const err = new Error(navigator.onLine ? 'Tidak dapat menghubungi Google Apps Script. Periksa alamat Web App dan pengaturan aksesnya ("Anyone").' : 'Perangkat sedang offline.');
      err.network = true; throw err;
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Jawaban server bukan JSON. Pastikan Web App di-deploy dengan akses "Anyone".'); }
    if (!j.ok) throw new Error(j.error || 'Permintaan gagal.');
    return j.data;
  }

  // ---------- data master ----------
  async function list(sheet) {
    if (mode() === 'local') return lget('local.' + sheet, []);
    try {
      const rows = await call('list', { sheet });
      lset('cache.' + sheet, rows);
      return rows;
    } catch (e) {
      if (e.network) { const c = lget('cache.' + sheet, null); if (c) { c.__offline = true; return c; } }
      throw e;
    }
  }
  async function upsert(sheet, rows) {
    if (mode() === 'local') {
      const all = lget('local.' + sheet, []);
      rows.forEach(r => { const i = all.findIndex(x => x.id === r.id); if (i >= 0) all[i] = r; else all.push(r); });
      lset('local.' + sheet, all); return rows.length;
    }
    return call('upsert', { sheet, rows });
  }
  async function remove(sheet, ids) {
    if (mode() === 'local') {
      lset('local.' + sheet, lget('local.' + sheet, []).filter(r => !ids.includes(r.id))); return ids.length;
    }
    return call('remove', { sheet, ids });
  }

  // ---------- RPS ----------
  function meta(r) { return { id: r.id, prodi: r.prodi || '', kode: r.kode || '', nama: r.nama || '', dosen: r.dosen || '', updated: r.updated || 0 }; }
  async function listRps() {
    if (mode() === 'local') return lget('local.RPS', []).map(meta);
    try { const rows = await call('listRps'); lset('cache.RPSmeta', rows); return rows; }
    catch (e) { if (e.network) { const c = lget('cache.RPSmeta', null); if (c) return c; } throw e; }
  }
  async function getRps(id) {
    if (mode() === 'local') return lget('local.RPS', []).find(r => r.id === id) || null;
    try { const r = await call('getRps', { id }); if (r) lset('cache.RPS.' + id, r); return r; }
    catch (e) { if (e.network) { const c = lget('cache.RPS.' + id, null); if (c) return c; } throw e; }
  }
  async function saveRps(rps) {
    rps.updated = Date.now();
    if (mode() === 'local') {
      const all = lget('local.RPS', []);
      const i = all.findIndex(x => x.id === rps.id);
      if (i >= 0) all[i] = rps; else all.push(rps);
      lset('local.RPS', all); return rps;
    }
    await call('saveRps', { rps });
    lset('cache.RPS.' + rps.id, rps);
    return rps;
  }
  async function deleteRps(id) {
    if (mode() === 'local') { lset('local.RPS', lget('local.RPS', []).filter(r => r.id !== id)); return; }
    await call('deleteRps', { id });
    localStorage.removeItem(P + 'cache.RPS.' + id);
  }

  // ---------- draf otomatis (selalu di perangkat) ----------
  function saveDraft(rps) { lset('draft.' + rps.id, { at: Date.now(), rps }); }
  function getDraft(id) { return lget('draft.' + id, null); }
  function clearDraft(id) { localStorage.removeItem(P + 'draft.' + id); }
  function listDrafts() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(P + 'draft.')) continue;
      const d = lget(k.slice(P.length), null);
      if (d && d.rps) out.push(Object.assign(meta(d.rps), { updated: d.at }));
    }
    return out;
  }

  async function ping(s) { return call('ping', {}, { settings: s }); }

  // Kirim semua data mode lokal ke Google Sheet
  async function migrateLocal() {
    let n = 0;
    for (const sh of SHEETS) {
      const rows = lget('local.' + sh, []);
      if (rows.length) { await call('upsert', { sheet: sh, rows }); n += rows.length; }
    }
    for (const r of lget('local.RPS', [])) { await call('saveRps', { rps: r }); n++; }
    return n;
  }
  function hasLocalData() {
    return SHEETS.some(s => lget('local.' + s, []).length) || lget('local.RPS', []).length > 0;
  }

  return { settings, saveSettings, mode, list, upsert, remove, listRps, getRps, saveRps, deleteRps,
           saveDraft, getDraft, clearDraft, listDrafts, ping, migrateLocal, hasLocalData };
})();
