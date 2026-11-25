/* RPS OBE — logika antarmuka */
(function () {
  const C = window.APP_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const modal = $('#modal');

  const state = {
    master: { Prodi: [], CPL: [], BahanKajian: [] },
    rpsList: [],
    current: null,        // RPS yang sedang diedit
    dirty: false,
    masterTab: 'CPL',
    masterProdi: '',
    masterChanged: new Set(),
    importRows: [],
    importKind: 'cpl',
    importProdi: '',
    offline: false
  };

  // ---------- utilitas ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
  const fmtNum = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const tglIndo = iso => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const waktuRelatif = t => t ? new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, val) {
    const ks = path.split('.'); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) cur[ks[i]] = {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = val;
  }

  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, kind === 'error' ? 6000 : 3000);
  }
  async function busy(text, fn) {
    const b = $('#busy'); $('#busyText').textContent = text || 'Memuat…'; b.hidden = false;
    try { return await fn(); } finally { b.hidden = true; }
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(resolve => {
      modal.innerHTML = `<form method="dialog" class="modal-body small">
        <h2 id="modalTitle">${esc(title)}</h2><p>${esc(text)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" value="no">Batal</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${esc(okLabel)}</button>
        </div></form>`;
      modal.onclose = () => resolve(modal.returnValue === 'yes');
      modal.showModal();
    });
  }

  function updateConn() {
    const el = $('#conn');
    const off = !navigator.onLine;
    if (Api.mode() === 'local') { el.textContent = 'Mode lokal'; el.className = 'conn local'; el.title = 'Data tersimpan di browser ini saja. Hubungkan Google Sheet di Pengaturan.'; }
    else if (off || state.offline) { el.textContent = 'Offline'; el.className = 'conn off'; el.title = 'Menampilkan data terakhir. Perubahan belum bisa disimpan ke Google Sheet.'; }
    else { el.textContent = 'Google Sheet'; el.className = 'conn on'; el.title = 'Terhubung ke Google Sheet'; }
  }

  // ---------- model RPS ----------
  function newRps() {
    return {
      id: uid(), prodi: state.masterProdi || (state.master.Prodi[0] && state.master.Prodi[0].nama) || '',
      kode: '', nama: '', sks: '', semester: '', status: 'Wajib', prasyarat: '-',
      tanggal: new Date().toISOString().slice(0, 10), dosen: '', koordinator: '', kaprodi: '', deskripsi: '',
      cpl: [], cpmk: [], peta: [],
      nilai: [
        { uid: uid(), komponen: 'Tugas', persen: '', perCpl: {} },
        { uid: uid(), komponen: 'UTS', persen: '', perCpl: {} },
        { uid: uid(), komponen: 'UAS', persen: '', perCpl: {} }
      ],
      rkpm: [], updated: 0
    };
  }
  function normalize(r) {
    const base = newRps();
    Object.keys(base).forEach(k => { if (r[k] == null) r[k] = base[k]; });
    r.nilai.forEach(n => { if (!n.perCpl) n.perCpl = {}; if (!n.uid) n.uid = uid(); });
    r.cpl.forEach(c => { if (!c.uid) c.uid = uid(); });
    r.cpmk.forEach(c => { if (!c.uid) c.uid = uid(); });
    r.rkpm.forEach(w => { if (!w.uid) w.uid = uid(); });
    return r;
  }
  function emptyWeek(mg) { return { uid: uid(), mg: String(mg), sub: '', indikator: '', komponen: '', bobot: '', bahan: '', metode: '', waktu: '', pengalaman: '', pustaka: '' }; }

  function markDirty() {
    state.dirty = true;
    Api.saveDraft(state.current);
    const s = $('#saveState'); if (s) { s.textContent = 'Ada perubahan yang belum disimpan'; s.className = 'save-state dirty'; }
  }

  // ---------- validasi ----------
  function checks(r) {
    const out = [];
    const add = (step, level, text) => out.push({ step, level, text });
    if (!r.kode || !r.nama) add(0, 'err', 'Kode dan nama mata kuliah wajib diisi.');
    if (!r.prodi) add(0, 'err', 'Program studi belum dipilih.');
    if (!r.dosen) add(0, 'warn', 'Dosen pengembang RPS belum diisi.');
    if (!r.deskripsi) add(0, 'warn', 'Deskripsi singkat MK belum diisi.');
    if (!r.cpl.length) add(1, 'err', 'Belum ada CPL yang dibebankan pada MK.');
    if (!r.cpmk.length) add(1, 'err', 'Belum ada CPMK.');
    if (r.cpl.some(c => !c.teks)) add(1, 'warn', 'Ada CPL yang rumusannya kosong.');
    if (r.cpmk.some(c => !c.teks)) add(1, 'warn', 'Ada CPMK yang rumusannya kosong.');
    const peta = new Set(r.peta);
    r.cpmk.forEach(m => { if (!r.cpl.some(c => peta.has(c.uid + '|' + m.uid))) add(2, 'warn', `${m.kode || 'CPMK'} belum dipetakan ke CPL mana pun.`); });
    r.cpl.forEach(c => { if (r.cpmk.length && !r.cpmk.some(m => peta.has(c.uid + '|' + m.uid))) add(2, 'warn', `${c.kode || 'CPL'} belum didukung CPMK mana pun.`); });
    const tot = r.nilai.reduce((a, n) => a + num(n.persen), 0);
    if (!r.nilai.length) add(3, 'err', 'Komponen penilaian belum ada.');
    else if (Math.abs(tot - 100) > 0.01) add(3, 'err', `Total persentase penilaian ${fmtNum(tot)}%, seharusnya 100%.`);
    r.nilai.forEach(n => {
      const s = Object.keys(n.perCpl).filter(k => r.cpl.some(c => c.uid === k)).reduce((a, k) => a + num(n.perCpl[k]), 0);
      if (s > 0 && Math.abs(s - num(n.persen)) > 0.01) add(3, 'warn', `Sebaran ${n.komponen || 'komponen'} ke CPL (${fmtNum(s)}%) tidak sama dengan persentasenya (${fmtNum(num(n.persen))}%).`);
    });
    if (!r.rkpm.length) add(4, 'err', 'Rencana mingguan belum diisi.');
    else {
      const tb = r.rkpm.reduce((a, w) => a + num(w.bobot), 0);
      if (Math.abs(tb - 100) > 0.01) add(4, 'warn', `Total bobot di RKPM ${fmtNum(tb)}%, seharusnya 100%.`);
      r.nilai.forEach(n => {
        if (!n.komponen) return;
        const s = r.rkpm.filter(w => (w.komponen || '').trim().toLowerCase() === n.komponen.trim().toLowerCase()).reduce((a, w) => a + num(w.bobot), 0);
        if (Math.abs(s - num(n.persen)) > 0.01) add(4, 'warn', `Bobot ${n.komponen} di RKPM ${fmtNum(s)}%, sedangkan di penilaian ${fmtNum(num(n.persen))}%.`);
      });
      const kosong = r.rkpm.filter(w => !w.sub).length;
      if (kosong) add(4, 'warn', `${kosong} minggu belum memiliki Sub-CPMK.`);
    }
    return out;
  }
  function stepStatus(r, i) {
    const c = checks(r).filter(x => x.step === i);
    const filled = [() => r.kode || r.nama, () => r.cpl.length || r.cpmk.length, () => r.peta.length, () => r.nilai.some(n => n.persen !== ''), () => r.rkpm.length, () => true][i]();
    if (!filled) return 'empty';
    if (c.some(x => x.level === 'err')) return 'err';
    if (c.length) return 'warn';
    return 'ok';
  }

  // ---------- data untuk templat Word ----------
  function templateData(r) {
    const cpl = r.cpl.slice(0, C.maxCpl), cpmk = r.cpmk.slice(0, C.maxCpmk);
    const peta = new Set(r.peta);
    const d = {
      prodi_upper: (r.prodi || '').toUpperCase(), kode: r.kode, nama: r.nama, sks: r.sks, semester: r.semester,
      status: r.status, prasyarat: r.prasyarat, tanggal: tglIndo(r.tanggal), dosen: r.dosen,
      koordinator: r.koordinator, kaprodi: r.kaprodi, deskripsi: r.deskripsi,
      cpl: r.cpl.map(c => ({ kode: c.kode, teks: c.teks })),
      cpmk: r.cpmk.map(c => ({ kode: c.kode, teks: c.teks })),
      peta: cpl.map(c => { const o = { kode: c.kode }; for (let i = 0; i < 5; i++) o['c' + (i + 1)] = cpmk[i] && peta.has(c.uid + '|' + cpmk[i].uid) ? '✓' : ''; return o; }),
      nilai: r.nilai.map(n => {
        const o = { komponen: n.komponen, persen: n.persen !== '' ? fmtNum(num(n.persen)) + '%' : '' };
        for (let i = 0; i < 4; i++) { const v = cpl[i] ? n.perCpl[cpl[i].uid] : ''; o['a' + (i + 1)] = v !== '' && v != null ? fmtNum(num(v)) + '%' : ''; }
        return o;
      }),
      rkpm: r.rkpm.map(w => ({ mg: w.mg, sub: w.sub, indikator: w.indikator, komponen: w.komponen, bobot: w.bobot !== '' ? fmtNum(num(w.bobot)) : '', bahan: w.bahan, metode: w.metode, waktu: w.waktu, pengalaman: w.pengalaman, pustaka: w.pustaka }))
    };
    for (let i = 0; i < 5; i++) d['mh' + (i + 1)] = cpmk[i] ? cpmk[i].kode : '';
    for (let i = 0; i < 4; i++) d['ph' + (i + 1)] = cpl[i] ? cpl[i].kode : '';
    return d;
  }

  async function downloadDocx(r) {
    await busy('Menyusun dokumen Word…', async () => {
      if (!window.JSZip) throw new Error('Pustaka JSZip belum termuat. Periksa koneksi internet lalu muat ulang.');
      const res = await fetch(C.templatePath);
      if (!res.ok) throw new Error('Templat Word tidak ditemukan.');
      const blob = await DocxFill.fillDocx(await res.arrayBuffer(), templateData(r));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `RPS ${r.kode || ''} ${r.nama || ''}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.docx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }).then(() => toast('Dokumen Word diunduh.'), e => toast(e.message, 'error'));
  }

  // ---------- pemuatan data ----------
  async function loadAll() {
    state.offline = false;
    const sheets = ['Prodi', 'CPL', 'BahanKajian'];
    const res = await Promise.all([...sheets.map(s => Api.list(s)), Api.listRps()]);
    sheets.forEach((s, i) => { state.master[s] = res[i] || []; if (res[i] && res[i].__offline) state.offline = true; });
    state.rpsList = res[3] || [];
    if (!state.masterProdi && state.master.Prodi[0]) state.masterProdi = state.master.Prodi[0].nama;
  }

  // ---------- router ----------
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { page: parts[0] || 'home', a: parts[1] ? decodeURIComponent(parts[1]) : '', b: parts[2] || '' };
  }
  async function render() {
    const r = route();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (r.page === 'rps' ? 'home' : r.page)));
    updateConn();
    if (r.page === 'rps') return renderEditor(r.a, parseInt(r.b || '0', 10) || 0).then(refreshIndicators);
    state.current = null; state.dirty = false;
    if (r.page === 'master') { state.masterTab = ['Prodi', 'CPL', 'BahanKajian'].includes(r.a) ? r.a : state.masterTab; return renderMaster(); }
    if (r.page === 'pengaturan') return renderSettings();
    return renderHome();
  }

  // ---------- halaman: daftar RPS ----------
  function renderHome() {
    const drafts = Api.listDrafts().filter(d => !state.rpsList.some(x => x.id === d.id)).map(d => Object.assign({ draft: true }, d));
    const list = state.rpsList.concat(drafts).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const masterKosong = !state.master.CPL.length;
    app.innerHTML = `
      <section class="page">
        <div class="page-head">
          <div>
            <h1>Rencana Pembelajaran Semester</h1>
            <p class="lead">Susun RPS berbasis OBE sesuai formulir FM.I-2-02, lalu unduh sebagai dokumen Word.</p>
          </div>
          <button class="btn btn-primary" data-act="new-rps">Buat RPS baru</button>
        </div>
        ${masterKosong ? `<div class="notice">
            <p><strong>Mulai dari data master.</strong> Unggah CPL Prodi dan bahan kajian sekali, setelah itu tinggal dipilih saat menyusun setiap RPS.</p>
            <a class="btn btn-ghost btn-sm" href="#/master/CPL">Buka data master</a>
          </div>` : ''}
        ${list.length ? `<ul class="rps-list">${list.map(x => `
          <li>
            <a class="rps-item" href="#/rps/${encodeURIComponent(x.id)}">
              <span class="rps-kode">${esc(x.kode || 'Tanpa kode')}</span>
              <span class="rps-nama">${esc(x.nama || 'RPS tanpa judul')}</span>
              <span class="rps-meta">${esc(x.prodi || '')}${x.dosen ? '<br>' + esc(x.dosen) : ''}</span>
              <span class="rps-time">${x.draft ? 'Draf belum disimpan, ' + esc(waktuRelatif(x.updated)) : 'Diperbarui ' + esc(waktuRelatif(x.updated))}</span>
            </a>
            <div class="rps-actions">
              ${x.draft ? '' : `<button class="btn btn-ghost btn-sm" data-act="dup-rps" data-id="${esc(x.id)}">Duplikat</button>`}
              <button class="btn btn-ghost btn-sm danger-text" data-act="del-rps" data-id="${esc(x.id)}">Hapus</button>
            </div>
          </li>`).join('')}</ul>`
        : `<div class="empty"><h2>Belum ada RPS</h2><p>Buat RPS pertama Anda. Draf tersimpan otomatis di perangkat sambil Anda mengisi.</p></div>`}
      </section>`;
  }

  // ---------- halaman: data master ----------
  function renderMaster() {
    const tab = state.masterTab;
    const prodiList = state.master.Prodi;
    const label = { Prodi: 'Program studi', CPL: 'CPL Prodi', BahanKajian: 'Bahan kajian' };
    let body = '';
    if (tab === 'Prodi') {
      body = `
        <p class="hint">Daftar program studi beserta ketua program studinya. Nama kaprodi otomatis terisi di RPS.</p>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th>Nama program studi</th><th>Ketua program studi</th><th class="w-act"></th></tr></thead>
          <tbody>${prodiList.map(p => `<tr>
            <td><input data-mbind="Prodi.${esc(p.id)}.nama" value="${esc(p.nama)}" placeholder="Contoh: D-III Gizi" aria-label="Nama program studi"></td>
            <td><input data-mbind="Prodi.${esc(p.id)}.kaprodi" value="${esc(p.kaprodi)}" placeholder="Nama dan gelar" aria-label="Ketua program studi"></td>
            <td><button class="icon-btn" data-act="m-del" data-sheet="Prodi" data-id="${esc(p.id)}" aria-label="Hapus">✕</button></td>
          </tr>`).join('') || `<tr><td colspan="3" class="muted">Belum ada program studi.</td></tr>`}</tbody>
        </table></div>
        <div class="row-actions"><button class="btn btn-ghost" data-act="m-add" data-sheet="Prodi">Tambah program studi</button></div>`;
    } else {
      const isCpl = tab === 'CPL';
      const rows = state.master[tab].filter(x => !state.masterProdi || x.prodi === state.masterProdi);
      body = `
        <div class="toolbar">
          <label class="field inline">Program studi
            <select data-act-change="m-prodi">${prodiOptions(state.masterProdi, true)}</select>
          </label>
          <div class="toolbar-end">
            <label class="btn btn-primary file-btn">Unggah file
              <input type="file" accept=".xlsx,.xls,.csv,.docx,.pdf,.txt" data-act-change="m-import" data-kind="${isCpl ? 'cpl' : 'bk'}">
            </label>
            <button class="btn btn-ghost" data-act="m-template" data-kind="${isCpl ? 'cpl' : 'bk'}">Unduh templat Excel</button>
          </div>
        </div>
        <p class="hint">Format yang diterima: Excel (.xlsx), CSV, Word (.docx), dan PDF berteks. Hasil pembacaan ditampilkan dulu untuk diperiksa sebelum disimpan.</p>
        <div class="table-wrap"><table class="grid">
          <thead><tr><th class="w-kode">Kode</th>${isCpl ? '<th class="w-ranah">Ranah</th><th>Rumusan CPL</th>' : '<th>Bahan kajian</th>'}<th class="w-act"></th></tr></thead>
          <tbody>${rows.map(x => `<tr>
            <td><input data-mbind="${tab}.${esc(x.id)}.kode" value="${esc(x.kode)}" aria-label="Kode"></td>
            ${isCpl ? `<td><select data-mbind="${tab}.${esc(x.id)}.ranah" aria-label="Ranah">${ranahOptions(x.ranah)}</select></td>
            <td><textarea rows="2" data-mbind="${tab}.${esc(x.id)}.rumusan" aria-label="Rumusan CPL">${esc(x.rumusan)}</textarea></td>`
            : `<td><textarea rows="1" data-mbind="${tab}.${esc(x.id)}.nama" aria-label="Bahan kajian">${esc(x.nama)}</textarea></td>`}
            <td><button class="icon-btn" data-act="m-del" data-sheet="${tab}" data-id="${esc(x.id)}" aria-label="Hapus">✕</button></td>
          </tr>`).join('') || `<tr><td colspan="${isCpl ? 4 : 3}" class="muted">Belum ada data untuk program studi ini. Unggah file atau tambah satu per satu.</td></tr>`}</tbody>
        </table></div>
        <div class="row-actions"><button class="btn btn-ghost" data-act="m-add" data-sheet="${tab}">Tambah baris</button></div>`;
    }
    app.innerHTML = `
      <section class="page">
        <div class="page-head"><div><h1>Data master</h1>
          <p class="lead">Data yang dipakai bersama oleh semua RPS.</p></div>
          <button class="btn btn-primary" data-act="m-save" ${state.masterChanged.size ? '' : 'disabled'}>Simpan perubahan${state.masterChanged.size ? ` (${state.masterChanged.size})` : ''}</button>
        </div>
        <div class="tabs" role="tablist">
          ${['CPL', 'BahanKajian', 'Prodi'].map(t => `<a role="tab" aria-selected="${t === tab}" href="#/master/${t}" class="${t === tab ? 'active' : ''}">${label[t]} <span class="count">${t === 'Prodi' ? state.master.Prodi.length : state.master[t].length}</span></a>`).join('')}
        </div>
        ${!prodiList.length && tab !== 'Prodi' ? `<div class="notice"><p>Tambahkan program studi dulu agar CPL dan bahan kajian bisa dikelompokkan per prodi.</p><a class="btn btn-ghost btn-sm" href="#/master/Prodi">Tambah program studi</a></div>` : ''}
        ${body}
      </section>`;
  }
  function prodiOptions(sel, allowAll) {
    const opts = state.master.Prodi.map(p => `<option ${p.nama === sel ? 'selected' : ''}>${esc(p.nama)}</option>`).join('');
    const extra = sel && !state.master.Prodi.some(p => p.nama === sel) ? `<option selected>${esc(sel)}</option>` : '';
    return (allowAll ? `<option value="" ${!sel ? 'selected' : ''}>Semua program studi</option>` : '<option value="">Pilih program studi</option>') + opts + extra;
  }
  function ranahOptions(sel) {
    return ['', 'Sikap', 'Pengetahuan', 'Keterampilan Umum', 'Keterampilan Khusus'].map(r => `<option value="${r}" ${r === (sel || '') ? 'selected' : ''}>${r || '–'}</option>`).join('');
  }

  // ---------- pratinjau impor ----------
  function renderImport() {
    const isCpl = state.importKind === 'cpl';
    const rows = state.importRows;
    const n = rows.filter(r => r.include).length;
    modal.innerHTML = `<div class="modal-body wide">
      <h2 id="modalTitle">Periksa hasil pembacaan</h2>
      <p class="hint">Ditemukan ${rows.length} butir. Perbaiki teks yang terpotong, gabungkan baris lanjutan ke baris di atasnya, atau hapus centang pada yang bukan ${isCpl ? 'CPL' : 'bahan kajian'}.</p>
      <label class="field inline">Simpan untuk program studi
        <select data-ibind-prodi>${prodiOptions(state.importProdi, false)}</select>
      </label>
      <div class="table-wrap import-wrap"><table class="grid">
        <thead><tr><th class="w-chk"><span class="sr-only">Ikut disimpan</span></th><th class="w-kode">Kode</th>${isCpl ? '<th class="w-ranah">Ranah</th>' : ''}<th>${isCpl ? 'Rumusan CPL' : 'Bahan kajian'}</th><th class="w-act2"></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="${r.include ? '' : 'excluded'}">
          <td><input type="checkbox" data-ibind="${i}.include" ${r.include ? 'checked' : ''} aria-label="Ikut disimpan"></td>
          <td><input data-ibind="${i}.kode" value="${esc(r.kode)}" aria-label="Kode"></td>
          ${isCpl ? `<td><select data-ibind="${i}.ranah" aria-label="Ranah">${ranahOptions(r.ranah)}</select></td>` : ''}
          <td><textarea rows="2" data-ibind="${i}.teks" aria-label="Teks">${esc(r.teks)}</textarea></td>
          <td class="nowrap">${i ? `<button class="icon-btn" data-act="i-merge" data-i="${i}" title="Gabungkan ke baris di atas" aria-label="Gabungkan ke baris di atas">↑</button>` : ''}
            <button class="icon-btn" data-act="i-del" data-i="${i}" title="Hapus baris" aria-label="Hapus baris">✕</button></td>
        </tr>`).join('') || `<tr><td colspan="5" class="muted">Tidak ada butir yang dikenali. Coba gunakan templat Excel.</td></tr>`}</tbody>
      </table></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="i-cancel">Batal</button>
        <button class="btn btn-primary" data-act="i-save" ${n ? '' : 'disabled'}>Simpan ${n} butir</button>
      </div></div>`;
    if (!modal.open) modal.showModal();
  }

  // ---------- halaman: editor RPS ----------
  const STEPS = ['Identitas', 'CPL dan CPMK', 'Pemetaan', 'Penilaian', 'Rencana mingguan', 'Pratinjau dan unduh'];

  async function renderEditor(id, step) {
    if (!state.current || state.current.id !== id) {
      let r = null;
      try { r = await busy('Membuka RPS…', () => Api.getRps(id)); } catch (e) { toast(e.message, 'error'); }
      const draft = Api.getDraft(id);
      if (draft && (!r || draft.at > (r.updated || 0))) {
        r = draft.rps; state.dirty = true;
        if (r && r.updated) toast('Draf yang belum disimpan dipulihkan dari perangkat ini.');
      } else state.dirty = false;
      if (!r) { toast('RPS tidak ditemukan.', 'error'); location.hash = '#/'; return; }
      state.current = normalize(r);
      state.pickerOpen = false;
    }
    const r = state.current;
    step = Math.max(0, Math.min(STEPS.length - 1, step));
    const statusLabel = { ok: 'Lengkap', warn: 'Perlu dicek', err: 'Belum sesuai', empty: 'Belum diisi' };
    app.innerHTML = `
      <section class="editor">
        <aside class="spine" aria-label="Tahapan penyusunan">
          <a href="#/" class="back">Daftar RPS</a>
          <p class="spine-title">${esc(r.kode || 'Tanpa kode')}<span>${esc(r.nama || 'RPS baru')}</span></p>
          <ol>${STEPS.map((s, i) => { const st = stepStatus(r, i); return `<li class="${i === step ? 'current' : ''} st-${st}">
            <a href="#/rps/${encodeURIComponent(r.id)}/${i}" ${i === step ? 'aria-current="step"' : ''}>
              <span class="dot" aria-hidden="true"></span><span class="s-name">${s}</span>
              ${i < 5 ? `<span class="s-status">${statusLabel[st]}</span>` : ''}
            </a></li>`; }).join('')}</ol>
        </aside>
        <div class="editor-main">
          <div class="step-body">${[stepIdentitas, stepCapaian, stepPemetaan, stepPenilaian, stepRkpm, stepPratinjau][step](r)}</div>
          <div class="editor-bar">
            <span id="saveState" class="save-state ${state.dirty ? 'dirty' : ''}">${state.dirty ? 'Ada perubahan yang belum disimpan' : (r.updated ? 'Tersimpan ' + esc(waktuRelatif(r.updated)) : 'Belum pernah disimpan')}</span>
            <div class="bar-btns">
              ${step > 0 ? `<a class="btn btn-ghost" href="#/rps/${encodeURIComponent(r.id)}/${step - 1}">Sebelumnya</a>` : ''}
              <button class="btn ${step === 5 ? 'btn-ghost' : 'btn-ghost'}" data-act="save-rps">Simpan</button>
              ${step < 5 ? `<a class="btn btn-primary" href="#/rps/${encodeURIComponent(r.id)}/${step + 1}">Berikutnya</a>`
                : `<button class="btn btn-primary" data-act="docx">Unduh Word</button>`}
            </div>
          </div>
        </div>
      </section>`;
    app.focus({ preventScroll: true });
  }

  function field(label, path, val, opt = {}) {
    const id = 'f-' + path.replace(/\./g, '-');
    const input = opt.textarea
      ? `<textarea id="${id}" rows="${opt.rows || 3}" data-bind="${path}" ${opt.ph ? `placeholder="${esc(opt.ph)}"` : ''}>${esc(val)}</textarea>`
      : `<input id="${id}" type="${opt.type || 'text'}" data-bind="${path}" value="${esc(val)}" ${opt.list ? `list="${opt.list}"` : ''} ${opt.ph ? `placeholder="${esc(opt.ph)}"` : ''} ${opt.type === 'number' ? 'inputmode="decimal" step="any" min="0"' : ''}>`;
    return `<div class="field ${opt.cls || ''}"><label for="${id}">${label}</label>${input}${opt.help ? `<small>${opt.help}</small>` : ''}</div>`;
  }

  function stepIdentitas(r) {
    return `<h1>Identitas mata kuliah</h1>
      <div class="form-grid">
        <div class="field span-2"><label for="f-prodi">Program studi</label>
          <select id="f-prodi" data-bind="prodi" data-act-change="pick-prodi">${prodiOptions(r.prodi, false)}</select>
          ${!state.master.Prodi.length ? '<small>Belum ada data program studi. Tambahkan di <a href="#/master/Prodi">Data master</a>.</small>' : ''}</div>
        ${field('Kode MK', 'kode', r.kode, { ph: 'Contoh: GZ.2.07' })}
        ${field('Nama MK', 'nama', r.nama, { ph: 'Contoh: Kesehatan Masyarakat', cls: 'span-2' })}
        ${field('Bobot (SKS)', 'sks', r.sks, { ph: 'Contoh: 2 (T: 1, P: 1)' })}
        ${field('Semester', 'semester', r.semester, { ph: 'Contoh: III' })}
        <div class="field"><label for="f-status">Status MK</label>
          <select id="f-status" data-bind="status">${['Wajib', 'Pilihan'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${field('MK prasyarat', 'prasyarat', r.prasyarat)}
        ${field('Tanggal penyusunan', 'tanggal', r.tanggal, { type: 'date' })}
        ${field('Dosen pengembang RPS', 'dosen', r.dosen, { cls: 'span-2', ph: 'Nama dan gelar' })}
        ${field('Koordinator MK', 'koordinator', r.koordinator, { ph: 'Nama dan gelar' })}
        ${field('Ketua program studi', 'kaprodi', r.kaprodi, { cls: 'span-2', ph: 'Terisi otomatis dari data prodi' })}
        ${field('Deskripsi singkat MK', 'deskripsi', r.deskripsi, { textarea: true, rows: 5, cls: 'span-3' })}
      </div>`;
  }

  function stepCapaian(r) {
    const master = state.master.CPL.filter(c => c.prodi === r.prodi);
    const chosen = new Set(r.cpl.map(c => c.ref).filter(Boolean));
    const full = r.cpl.length >= C.maxCpl;
    return `<h1>CPL dan CPMK</h1>
      <h2>CPL Prodi yang dibebankan pada MK <span class="counter">${r.cpl.length}/${C.maxCpl}</span></h2>
      ${master.length ? `<details class="picker" ${state.pickerOpen || !r.cpl.length ? 'open' : ''}>
          <summary>Pilih dari CPL ${esc(r.prodi)}</summary>
          <ul class="pick-list">${master.map(c => `<li><label class="${!chosen.has(c.id) && full ? 'disabled' : ''}">
            <input type="checkbox" data-act-change="pick-cpl" data-id="${esc(c.id)}" ${chosen.has(c.id) ? 'checked' : ''} ${!chosen.has(c.id) && full ? 'disabled' : ''}>
            <span class="pk">${esc(c.kode)}</span><span>${esc(c.rumusan)}${c.ranah ? `<em>${esc(c.ranah)}</em>` : ''}</span></label></li>`).join('')}</ul>
        </details>`
        : `<p class="hint">${r.prodi ? `Belum ada CPL untuk ${esc(r.prodi)} di data master. <a href="#/master/CPL">Unggah CPL</a> atau tulis manual di bawah.` : 'Pilih program studi di tahap Identitas agar CPL bisa dipilih dari data master.'}</p>`}
      <ul class="item-list">${r.cpl.map((c, i) => `<li>
        <input class="kode-input" data-bind="cpl.${i}.kode" value="${esc(c.kode)}" aria-label="Kode CPL">
        <textarea rows="2" data-bind="cpl.${i}.teks" aria-label="Rumusan CPL">${esc(c.teks)}</textarea>
        <div class="item-btns">${moveBtns('cpl', i, r.cpl.length)}<button class="icon-btn" data-act="del-item" data-list="cpl" data-i="${i}" aria-label="Hapus CPL">✕</button></div>
      </li>`).join('')}</ul>
      <button class="btn btn-ghost btn-sm" data-act="add-item" data-list="cpl" ${full ? 'disabled' : ''}>Tulis CPL manual</button>

      <h2>Capaian pembelajaran mata kuliah (CPMK) <span class="counter">${r.cpmk.length}/${C.maxCpmk}</span></h2>
      <p class="hint">Rumuskan dengan kata kerja operasional yang terukur. Formulir menyediakan kolom untuk paling banyak ${C.maxCpmk} CPMK.</p>
      <ul class="item-list">${r.cpmk.map((c, i) => `<li>
        <input class="kode-input" data-bind="cpmk.${i}.kode" value="${esc(c.kode)}" aria-label="Kode CPMK">
        <textarea rows="2" data-bind="cpmk.${i}.teks" aria-label="Rumusan CPMK" placeholder="Mahasiswa mampu …">${esc(c.teks)}</textarea>
        <div class="item-btns">${moveBtns('cpmk', i, r.cpmk.length)}<button class="icon-btn" data-act="del-item" data-list="cpmk" data-i="${i}" aria-label="Hapus CPMK">✕</button></div>
      </li>`).join('')}</ul>
      <button class="btn btn-ghost btn-sm" data-act="add-item" data-list="cpmk" ${r.cpmk.length >= C.maxCpmk ? 'disabled' : ''}>Tambah CPMK</button>`;
  }
  function moveBtns(list, i, n) {
    return `<button class="icon-btn" data-act="move" data-list="${list}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Naikkan">↑</button>
            <button class="icon-btn" data-act="move" data-list="${list}" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Turunkan">↓</button>`;
  }

  function stepPemetaan(r) {
    if (!r.cpl.length || !r.cpmk.length) return `<h1>Pemetaan CPL terhadap CPMK</h1><div class="empty"><p>Isi CPL dan CPMK terlebih dahulu.</p><a class="btn btn-ghost" href="#/rps/${encodeURIComponent(r.id)}/1">Ke tahap CPL dan CPMK</a></div>`;
    const peta = new Set(r.peta);
    return `<h1>Pemetaan CPL terhadap CPMK</h1>
      <p class="hint">Centang CPMK yang mendukung tiap CPL. Arahkan kursor ke kode untuk melihat rumusannya.</p>
      <div class="table-wrap"><table class="matrix">
        <thead><tr><th></th>${r.cpmk.map(m => `<th title="${esc(m.teks)}">${esc(m.kode)}</th>`).join('')}</tr></thead>
        <tbody>${r.cpl.map(c => `<tr><th title="${esc(c.teks)}">${esc(c.kode)}</th>${r.cpmk.map(m => `<td>
          <input type="checkbox" data-act-change="peta" data-k="${c.uid}|${m.uid}" ${peta.has(c.uid + '|' + m.uid) ? 'checked' : ''} aria-label="${esc(c.kode)} didukung ${esc(m.kode)}"></td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <dl class="legend">${r.cpl.map(c => `<dt>${esc(c.kode)}</dt><dd>${esc(c.teks)}</dd>`).join('')}${r.cpmk.map(c => `<dt>${esc(c.kode)}</dt><dd>${esc(c.teks)}</dd>`).join('')}</dl>`;
  }

  function stepPenilaian(r) {
    const cpl = r.cpl.slice(0, C.maxCpl);
    return `<h1>Metode penilaian</h1>
      <p class="hint">Isi persentase tiap komponen (total 100%). Kolom CPL mengikuti formulir: tuliskan berapa persen dari komponen itu yang menilai tiap CPL, atau kosongkan.</p>
      <div class="table-wrap"><table class="grid nilai">
        <thead><tr><th>Komponen penilaian</th><th class="w-num">Persentase</th>${cpl.map(c => `<th class="w-num" title="${esc(c.teks)}">${esc(c.kode)}</th>`).join('')}<th class="w-act"></th></tr></thead>
        <tbody>${r.nilai.map((n, i) => `<tr>
          <td><input data-bind="nilai.${i}.komponen" value="${esc(n.komponen)}" list="dl-komponen" aria-label="Komponen"></td>
          <td><div class="suffix"><input type="number" inputmode="decimal" min="0" step="any" data-bind="nilai.${i}.persen" value="${esc(n.persen)}" aria-label="Persentase"><span>%</span></div></td>
          ${cpl.map(c => `<td><div class="suffix"><input type="number" inputmode="decimal" min="0" step="any" data-bind="nilai.${i}.perCpl.${c.uid}" value="${esc(n.perCpl[c.uid] == null ? '' : n.perCpl[c.uid])}" aria-label="${esc(c.kode)}"><span>%</span></div></td>`).join('')}
          <td><button class="icon-btn" data-act="del-item" data-list="nilai" data-i="${i}" aria-label="Hapus komponen">✕</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th>Total</th><td><span id="totNilai" class="total"></span></td>${cpl.map(c => `<td><span class="total" data-totcpl="${c.uid}"></span></td>`).join('')}<td></td></tr></tfoot>
      </table></div>
      <datalist id="dl-komponen">${['Tugas', 'Kuis', 'Praktikum', 'Presentasi', 'Proyek', 'Partisipasi', 'UTS', 'UAS'].map(x => `<option value="${x}">`).join('')}</datalist>
      <button class="btn btn-ghost btn-sm" data-act="add-item" data-list="nilai">Tambah komponen</button>`;
  }

  const METODE = ['Kuliah interaktif', 'Diskusi kelompok', 'Case Based Learning (CBL)', 'Project Based Learning (PjBL)', 'Problem Based Learning (PBL)', 'Praktikum', 'Seminar/presentasi', 'Studi lapangan'];
  const WAKTU = ['TM: 2 × 50 menit; PT: 2 × 60 menit; BM: 2 × 60 menit', 'TM: 1 × 50 menit; PT: 1 × 60 menit; BM: 1 × 60 menit', 'P: 1 × 170 menit'];

  function stepRkpm(r) {
    const bk = state.master.BahanKajian.filter(b => b.prodi === r.prodi);
    const komponen = r.nilai.map(n => n.komponen).filter(Boolean);
    if (!r.rkpm.length) return `<h1>Rencana kegiatan pembelajaran mingguan</h1>
      <div class="empty"><p>Belum ada rencana mingguan.</p>
      <button class="btn btn-primary" data-act="fill-weeks">Siapkan ${C.jumlahMinggu} minggu</button>
      <p class="hint">Minggu ${C.mingguUts} disiapkan untuk UTS dan minggu ${C.mingguUas} untuk UAS.</p></div>`;
    return `<h1>Rencana kegiatan pembelajaran mingguan</h1>
      <div class="toolbar"><p class="hint">Total bobot <span id="totBobot" class="total"></span>. Ketuk satu minggu untuk membuka isinya.</p>
        <div class="toolbar-end"><button class="btn btn-ghost btn-sm" data-act="toggle-weeks">Buka/tutup semua</button></div></div>
      <ol class="weeks">${r.rkpm.map((w, i) => `<li class="week">
        <details ${w._open ? 'open' : ''} data-week="${i}">
          <summary><span class="wk-num">${esc(w.mg || '?')}</span><span class="wk-sum">${esc(w.sub ? w.sub.slice(0, 110) : 'Sub-CPMK belum diisi')}</span>
            <span class="wk-bobot">${w.bobot !== '' ? esc(fmtNum(num(w.bobot))) + '%' : ''}</span></summary>
          <div class="week-body form-grid">
            ${field('Minggu ke-', `rkpm.${i}.mg`, w.mg, { ph: 'Contoh: 1 atau 2–3' })}
            <div class="field"><label for="f-rkpm-${i}-komponen">Komponen penilaian</label>
              <input id="f-rkpm-${i}-komponen" data-bind="rkpm.${i}.komponen" value="${esc(w.komponen)}" list="dl-komp-rkpm"></div>
            ${field('Bobot (%)', `rkpm.${i}.bobot`, w.bobot, { type: 'number' })}
            ${field('Sub-CPMK (kemampuan akhir tiap tahapan belajar)', `rkpm.${i}.sub`, w.sub, { textarea: true, rows: 2, cls: 'span-3' })}
            ${field('Indikator', `rkpm.${i}.indikator`, w.indikator, { textarea: true, rows: 2, cls: 'span-3' })}
            <div class="field span-3"><label for="f-rkpm-${i}-bahan">Bahan kajian (materi pembelajaran)</label>
              <textarea id="f-rkpm-${i}-bahan" rows="3" data-bind="rkpm.${i}.bahan">${esc(w.bahan)}</textarea>
              ${bk.length ? `<select class="insert-select" data-act-change="ins-bk" data-i="${i}" aria-label="Sisipkan bahan kajian"><option value="">Sisipkan dari bahan kajian prodi…</option>${bk.map(b => `<option value="${esc(b.id)}">${esc(b.kode)} ${esc(b.nama)}</option>`).join('')}</select>` : ''}</div>
            ${field('Bentuk dan metode pembelajaran', `rkpm.${i}.metode`, w.metode, { list: 'dl-metode', cls: 'span-3' })}
            ${field('Beban waktu pembelajaran', `rkpm.${i}.waktu`, w.waktu, { list: 'dl-waktu', cls: 'span-3' })}
            ${field('Pengalaman belajar mahasiswa', `rkpm.${i}.pengalaman`, w.pengalaman, { textarea: true, rows: 2, cls: 'span-3' })}
            <div class="field span-3"><label for="f-rkpm-${i}-pustaka">Pustaka dan sumber belajar</label>
              <textarea id="f-rkpm-${i}-pustaka" rows="2" data-bind="rkpm.${i}.pustaka">${esc(w.pustaka)}</textarea>
              ${i ? `<button class="link-btn" data-act="copy-prev" data-i="${i}">Salin pustaka dari minggu sebelumnya</button>` : ''}</div>
            <div class="week-actions span-3">${moveBtns('rkpm', i, r.rkpm.length)}
              <button class="btn btn-ghost btn-sm" data-act="dup-week" data-i="${i}">Duplikat minggu</button>
              <button class="btn btn-ghost btn-sm danger-text" data-act="del-item" data-list="rkpm" data-i="${i}">Hapus minggu</button></div>
          </div>
        </details></li>`).join('')}</ol>
      <button class="btn btn-ghost btn-sm" data-act="add-week">Tambah minggu</button>
      <datalist id="dl-metode">${METODE.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-waktu">${WAKTU.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-komp-rkpm">${komponen.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  }

  function stepPratinjau(r) {
    const list = checks(r);
    const d = templateData(r);
    const td = s => `<td>${esc(s).replace(/\n/g, '<br>')}</td>`;
    return `<h1>Pratinjau dan unduh</h1>
      ${list.length ? `<ul class="checks">${list.map(c => `<li class="${c.level}"><a href="#/rps/${encodeURIComponent(r.id)}/${c.step}">${esc(c.text)}</a></li>`).join('')}</ul>`
        : `<p class="all-ok">Semua pemeriksaan terpenuhi. RPS siap diunduh.</p>`}
      <div class="paper-wrap"><article class="paper" aria-label="Pratinjau dokumen">
        <header class="paper-head"><strong>KEMENKES POLTEKKES MANADO</strong><strong>PROGRAM STUDI ${esc(d.prodi_upper || '……')}</strong><b>RENCANA PEMBELAJARAN SEMESTER</b></header>
        <table class="doc">
          <tr><th>Kode MK</th><th>Nama MK</th><th>Bobot (SKS)</th><th>Semester</th><th>Status MK</th><th>MK Prasyarat</th></tr>
          <tr>${td(d.kode)}${td(d.nama)}${td(d.sks)}${td(d.semester)}${td(d.status)}${td(d.prasyarat)}</tr>
          <tr><th>Tanggal penyusunan</th><th colspan="2">Dosen pengembang RPS</th><th colspan="2">Koordinator MK</th><th>Ketua program studi</th></tr>
          <tr>${td(d.tanggal)}<td colspan="2">${esc(d.dosen)}</td><td colspan="2">${esc(d.koordinator)}</td>${td(d.kaprodi)}</tr>
        </table>
        <table class="doc">
          <tr><th colspan="2">CPL Prodi yang dibebankan pada MK</th></tr>
          ${d.cpl.map(c => `<tr><td class="k">${esc(c.kode)}</td>${td(c.teks)}</tr>`).join('')}
          <tr><th colspan="2">Capaian Pembelajaran Mata Kuliah (CPMK)</th></tr>
          ${d.cpmk.map(c => `<tr><td class="k">${esc(c.kode)}</td>${td(c.teks)}</tr>`).join('')}
        </table>
        <table class="doc center">
          <tr><th>Pemetaan</th>${[1, 2, 3, 4, 5].map(i => `<th>${esc(d['mh' + i])}</th>`).join('')}</tr>
          ${d.peta.map(p => `<tr><td class="k">${esc(p.kode)}</td>${[1, 2, 3, 4, 5].map(i => td(p['c' + i])).join('')}</tr>`).join('')}
        </table>
        <table class="doc"><tr><th class="k">Deskripsi singkat MK</th>${td(d.deskripsi)}</tr></table>
        <table class="doc center">
          <tr><th>Komponen penilaian</th><th>Persentase</th>${[1, 2, 3, 4].map(i => `<th>${esc(d['ph' + i])}</th>`).join('')}</tr>
          ${d.nilai.map(n => `<tr>${td(n.komponen)}${td(n.persen)}${[1, 2, 3, 4].map(i => td(n['a' + i])).join('')}</tr>`).join('')}
        </table>
        <h3>Rencana Kegiatan Pembelajaran Mingguan (RKPM)</h3>
        <div class="doc-scroll"><table class="doc small">
          <tr><th>Mg</th><th>Sub-CPMK</th><th>Indikator</th><th>Komponen</th><th>Bobot (%)</th><th>Bahan kajian</th><th>Metode</th><th>Beban waktu</th><th>Pengalaman belajar</th><th>Pustaka</th></tr>
          ${d.rkpm.map(w => `<tr>${['mg', 'sub', 'indikator', 'komponen', 'bobot', 'bahan', 'metode', 'waktu', 'pengalaman', 'pustaka'].map(k => td(w[k])).join('')}</tr>`).join('')}
        </table></div>
      </article></div>
      <p class="hint">Dokumen Word mengikuti formulir FM.I-2-02-rev.3-2024 lengkap dengan kop resmi. Pratinjau ini hanya menampilkan isinya.</p>`;
  }

  function refreshIndicators() {
    const r = state.current; if (!r) return;
    const t = $('#totNilai');
    if (t) {
      const tot = r.nilai.reduce((a, n) => a + num(n.persen), 0);
      t.textContent = fmtNum(tot) + '%'; t.className = 'total ' + (Math.abs(tot - 100) < 0.01 ? 'ok' : 'bad');
      document.querySelectorAll('[data-totcpl]').forEach(el => {
        const s = r.nilai.reduce((a, n) => a + num(n.perCpl[el.dataset.totcpl]), 0);
        el.textContent = s ? fmtNum(s) + '%' : '';
      });
    }
    const b = $('#totBobot');
    if (b) { const tb = r.rkpm.reduce((a, w) => a + num(w.bobot), 0); b.textContent = fmtNum(tb) + '%'; b.className = 'total ' + (Math.abs(tb - 100) < 0.01 ? 'ok' : 'bad'); }
    // perbarui status di tulang tahapan
    document.querySelectorAll('.spine li').forEach((li, i) => {
      if (i > 4) return;
      const st = stepStatus(r, i);
      li.className = li.className.replace(/\bst-\w+/, 'st-' + st);
      const s = li.querySelector('.s-status'); if (s) s.textContent = { ok: 'Lengkap', warn: 'Perlu dicek', err: 'Belum sesuai', empty: 'Belum diisi' }[st];
    });
    const sp = $('.spine-title'); if (sp) sp.innerHTML = `${esc(r.kode || 'Tanpa kode')}<span>${esc(r.nama || 'RPS baru')}</span>`;
  }

  function rerenderStep() { const rt = route(); renderEditor(rt.a, parseInt(rt.b || '0', 10) || 0).then(refreshIndicators); }
  function keepOpenWeeks() {
    if (!state.current) return;
    document.querySelectorAll('details[data-week]').forEach(d => { const w = state.current.rkpm[+d.dataset.week]; if (w) w._open = d.open; });
  }

  // ---------- halaman: pengaturan ----------
  function renderSettings() {
    const s = Api.settings();
    app.innerHTML = `<section class="page narrow">
      <h1>Pengaturan</h1>
      <p class="lead">Hubungkan aplikasi ke Google Sheet melalui Web App Google Apps Script. Langkah lengkapnya ada di README.</p>
      <div class="card-plain">
        <div class="field"><label for="s-url">Alamat Web App Apps Script</label>
          <input id="s-url" type="url" value="${esc(s.apiUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
          ${C.apiUrl ? '<small>Sudah diatur di config.js. Kosongkan kolom ini untuk memakai alamat bawaan tersebut.</small>' : ''}</div>
        <div class="field"><label for="s-token">Kode akses</label>
          <input id="s-token" type="password" value="${esc(s.token)}" autocomplete="off">
          <small>Sama dengan nilai TOKEN di Script Properties. Disimpan hanya di perangkat ini.</small></div>
        <div class="row-actions">
          <button class="btn btn-primary" data-act="s-save">Simpan dan uji koneksi</button>
          ${s.apiUrl && !C.apiUrl ? '<button class="btn btn-ghost" data-act="s-local">Kembali ke mode lokal</button>' : ''}
        </div>
      </div>
      ${s.apiUrl && Api.hasLocalData() ? `<div class="notice"><p>Ada data dari mode lokal di perangkat ini. Kirim ke Google Sheet agar bisa dipakai bersama.</p>
        <button class="btn btn-ghost btn-sm" data-act="s-migrate">Kirim data lokal ke Google Sheet</button></div>` : ''}
      <h2>Tentang mode lokal</h2>
      <p>Tanpa alamat Web App, aplikasi menyimpan data di browser ini saja. Cocok untuk mencoba, tetapi data hilang jika riwayat browser dibersihkan dan tidak bisa dibuka dari perangkat lain.</p>
    </section>`;
  }

  // ---------- aksi klik ----------
  const actions = {
    async 'new-rps'() {
      const r = newRps();
      const p = state.master.Prodi.find(x => x.nama === r.prodi); if (p) r.kaprodi = p.kaprodi || '';
      state.current = r; state.dirty = true; Api.saveDraft(r);
      location.hash = '#/rps/' + encodeURIComponent(r.id) + '/0';
    },
    async 'dup-rps'(ds) {
      try {
        const src = await busy('Menyalin…', () => Api.getRps(ds.id));
        const r = normalize(JSON.parse(JSON.stringify(src)));
        r.id = uid(); r.kode = r.kode ? r.kode + ' (salinan)' : ''; r.nama = (r.nama || '') + ' (salinan)';
        await busy('Menyimpan…', () => Api.saveRps(r));
        state.rpsList.push({ id: r.id, prodi: r.prodi, kode: r.kode, nama: r.nama, dosen: r.dosen, updated: r.updated });
        renderHome(); toast('RPS diduplikat.');
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'del-rps'(ds) {
      const x = state.rpsList.find(r => r.id === ds.id) || Api.listDrafts().find(r => r.id === ds.id);
      if (!await confirmBox('Hapus RPS?', `${x ? (x.kode + ' ' + x.nama) : 'RPS ini'} akan dihapus permanen.`, 'Hapus', true)) return;
      try { if (state.rpsList.some(r => r.id === ds.id)) await busy('Menghapus…', () => Api.deleteRps(ds.id)); Api.clearDraft(ds.id); state.rpsList = state.rpsList.filter(r => r.id !== ds.id); renderHome(); toast('RPS dihapus.'); }
      catch (e) { toast(e.message, 'error'); }
    },
    async 'save-rps'() {
      const r = state.current;
      keepOpenWeeks();
      const clean = JSON.parse(JSON.stringify(r, (k, v) => k === '_open' ? undefined : v));
      try {
        await busy('Menyimpan…', () => Api.saveRps(clean));
        r.updated = clean.updated; state.dirty = false; Api.clearDraft(r.id);
        const m = { id: r.id, prodi: r.prodi, kode: r.kode, nama: r.nama, dosen: r.dosen, updated: r.updated };
        const i = state.rpsList.findIndex(x => x.id === r.id); if (i >= 0) state.rpsList[i] = m; else state.rpsList.push(m);
        const s = $('#saveState'); if (s) { s.textContent = 'Tersimpan ' + waktuRelatif(r.updated); s.className = 'save-state'; }
        toast(Api.mode() === 'local' ? 'Tersimpan di perangkat ini.' : 'Tersimpan ke Google Sheet.');
      } catch (e) { toast(e.message + ' Draf tetap aman di perangkat ini.', 'error'); }
    },
    docx() { downloadDocx(state.current); },
    'add-item'(ds) {
      const r = state.current;
      if (ds.list === 'cpl') r.cpl.push({ uid: uid(), kode: 'CPL' + (r.cpl.length + 1), teks: '' });
      if (ds.list === 'cpmk') r.cpmk.push({ uid: uid(), kode: 'CPMK' + (r.cpmk.length + 1), teks: '' });
      if (ds.list === 'nilai') r.nilai.push({ uid: uid(), komponen: '', persen: '', perCpl: {} });
      markDirty(); rerenderStep();
    },
    async 'del-item'(ds) {
      keepOpenWeeks();
      const r = state.current, arr = r[ds.list], it = arr[+ds.i];
      const filled = it && (it.teks || it.sub || it.komponen);
      if (filled && !await confirmBox('Hapus butir ini?', 'Isi yang sudah ditulis akan hilang.', 'Hapus', true)) return;
      arr.splice(+ds.i, 1);
      if (ds.list === 'cpl' || ds.list === 'cpmk') r.peta = r.peta.filter(k => k.split('|').every(u => r.cpl.some(c => c.uid === u) || r.cpmk.some(c => c.uid === u)));
      markDirty(); rerenderStep();
    },
    move(ds) {
      keepOpenWeeks();
      const arr = state.current[ds.list], i = +ds.i, j = i + +ds.d;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      markDirty(); rerenderStep();
    },
    'fill-weeks'() {
      const r = state.current;
      r.rkpm = [];
      for (let m = 1; m <= C.jumlahMinggu; m++) {
        const w = emptyWeek(m);
        if (m === C.mingguUts) { w.sub = 'Ujian Tengah Semester'; w.komponen = 'UTS'; w.metode = 'Ujian tertulis'; }
        if (m === C.mingguUas) { w.sub = 'Ujian Akhir Semester'; w.komponen = 'UAS'; w.metode = 'Ujian tertulis'; }
        r.rkpm.push(w);
      }
      r.rkpm[0]._open = true;
      markDirty(); rerenderStep();
    },
    'add-week'() {
      keepOpenWeeks();
      const r = state.current; const last = r.rkpm[r.rkpm.length - 1];
      const w = emptyWeek(last ? (parseInt(last.mg, 10) || r.rkpm.length) + 1 : 1); w._open = true;
      r.rkpm.push(w); markDirty(); rerenderStep();
    },
    'dup-week'(ds) {
      keepOpenWeeks();
      const r = state.current, src = r.rkpm[+ds.i];
      const w = Object.assign({}, src, { uid: uid(), _open: true });
      r.rkpm.splice(+ds.i + 1, 0, w); markDirty(); rerenderStep();
    },
    'toggle-weeks'() {
      const ds = document.querySelectorAll('details[data-week]');
      const anyClosed = Array.from(ds).some(d => !d.open);
      ds.forEach(d => { d.open = anyClosed; });
    },
    'copy-prev'(ds) {
      const r = state.current, i = +ds.i;
      r.rkpm[i].pustaka = r.rkpm[i - 1].pustaka;
      const ta = $(`#f-rkpm-${i}-pustaka`); if (ta) ta.value = r.rkpm[i].pustaka;
      markDirty();
    },
    // master
    'm-add'(ds) {
      const row = ds.sheet === 'Prodi' ? { id: uid(), nama: '', kaprodi: '' }
        : ds.sheet === 'CPL' ? { id: uid(), prodi: state.masterProdi, kode: 'CPL' + (state.master.CPL.filter(c => c.prodi === state.masterProdi).length + 1), ranah: '', rumusan: '' }
        : { id: uid(), prodi: state.masterProdi, kode: 'BK' + (state.master.BahanKajian.filter(c => c.prodi === state.masterProdi).length + 1), nama: '' };
      state.master[ds.sheet].push(row);
      state.masterChanged.add(ds.sheet + '|' + row.id);
      renderMaster();
      const inputs = app.querySelectorAll('tbody tr:last-child input, tbody tr:last-child textarea');
      if (inputs.length) inputs[ds.sheet === 'Prodi' ? 0 : inputs.length - 1].focus();
    },
    async 'm-del'(ds) {
      if (!await confirmBox('Hapus data ini?', 'RPS yang sudah memakai data ini tidak ikut berubah.', 'Hapus', true)) return;
      try {
        await busy('Menghapus…', () => Api.remove(ds.sheet, [ds.id]));
        state.master[ds.sheet] = state.master[ds.sheet].filter(x => x.id !== ds.id);
        state.masterChanged.delete(ds.sheet + '|' + ds.id);
        renderMaster();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'm-save'() {
      const by = {};
      state.masterChanged.forEach(k => { const [sh, id] = k.split('|'); const row = state.master[sh].find(x => x.id === id); if (row) (by[sh] = by[sh] || []).push(row); });
      try {
        await busy('Menyimpan…', async () => { for (const sh of Object.keys(by)) await Api.upsert(sh, by[sh]); });
        state.masterChanged.clear(); renderMaster(); toast('Data master tersimpan.');
      } catch (e) { toast(e.message, 'error'); }
    },
    async 'm-template'(ds) {
      try { await busy('Menyiapkan templat…', () => Importer.downloadTemplate(ds.kind)); } catch (e) { toast(e.message, 'error'); }
    },
    // impor
    'i-merge'(ds) {
      const i = +ds.i, rows = state.importRows;
      rows[i - 1].teks = (rows[i - 1].teks + ' ' + rows[i].teks).trim();
      rows.splice(i, 1); renderImport();
    },
    'i-del'(ds) { state.importRows.splice(+ds.i, 1); renderImport(); },
    'i-cancel'() { modal.close(); },
    async 'i-save'() {
      const kind = state.importKind, sheet = kind === 'cpl' ? 'CPL' : 'BahanKajian';
      if (!state.importProdi) { toast('Pilih program studi terlebih dahulu.', 'error'); return; }
      const rows = state.importRows.filter(r => r.include && r.teks.trim()).map(r => kind === 'cpl'
        ? { id: uid(), prodi: state.importProdi, kode: r.kode, ranah: r.ranah || '', rumusan: r.teks.trim() }
        : { id: uid(), prodi: state.importProdi, kode: r.kode, nama: r.teks.trim() });
      // Kode yang sama di prodi yang sama diperbarui, bukan diduplikasi
      rows.forEach(r => { const ex = state.master[sheet].find(x => x.prodi === r.prodi && x.kode && x.kode === r.kode); if (ex) r.id = ex.id; });
      try {
        await busy('Menyimpan…', () => Api.upsert(sheet, rows));
        rows.forEach(r => { const i = state.master[sheet].findIndex(x => x.id === r.id); if (i >= 0) state.master[sheet][i] = r; else state.master[sheet].push(r); });
        modal.close(); state.masterProdi = state.importProdi; renderMaster(); toast(`${rows.length} butir tersimpan.`);
      } catch (e) { toast(e.message, 'error'); }
    },
    // pengaturan
    async 's-save'() {
      const url = $('#s-url').value.trim(), token = $('#s-token').value;
      if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('Alamat harus berupa URL Web App dari script.google.com.', 'error'); return; }
      try {
        if (url) await busy('Menguji koneksi…', () => Api.ping({ apiUrl: url, token }));
        Api.saveSettings(url, token);
        await busy('Memuat data…', loadAll);
        toast(url ? 'Terhubung ke Google Sheet.' : 'Mode lokal aktif.'); renderSettings(); updateConn();
      } catch (e) { toast(e.message, 'error'); }
    },
    async 's-local'() {
      if (!await confirmBox('Kembali ke mode lokal?', 'Data di Google Sheet tetap aman. Aplikasi hanya berhenti terhubung dari perangkat ini.', 'Ya, mode lokal')) return;
      Api.saveSettings('', ''); await busy('Memuat data…', loadAll); renderSettings(); updateConn();
    },
    async 's-migrate'() {
      try { const n = await busy('Mengirim data…', () => Api.migrateLocal()); await busy('Memuat data…', loadAll); toast(`${n} data terkirim ke Google Sheet.`); }
      catch (e) { toast(e.message, 'error'); }
    }
  };

  const changeActions = {
    'pick-prodi'(el) {
      const r = state.current; const p = state.master.Prodi.find(x => x.nama === el.value);
      if (p && p.kaprodi) { r.kaprodi = p.kaprodi; const k = $('#f-kaprodi'); if (k) k.value = p.kaprodi; }
    },
    'pick-cpl'(el) {
      const r = state.current, m = state.master.CPL.find(c => c.id === el.dataset.id);
      if (!m) return;
      state.pickerOpen = true;
      if (el.checked) { if (r.cpl.length < C.maxCpl) r.cpl.push({ uid: uid(), ref: m.id, kode: m.kode, teks: m.rumusan }); }
      else { const c = r.cpl.find(x => x.ref === m.id); r.cpl = r.cpl.filter(x => x.ref !== m.id); if (c) r.peta = r.peta.filter(k => !k.startsWith(c.uid + '|')); }
      markDirty(); rerenderStep();
    },
    peta(el) {
      const r = state.current, k = el.dataset.k;
      r.peta = r.peta.filter(x => x !== k); if (el.checked) r.peta.push(k);
      markDirty(); refreshIndicators();
    },
    'ins-bk'(el) {
      const b = state.master.BahanKajian.find(x => x.id === el.value); if (!b) return;
      const w = state.current.rkpm[+el.dataset.i];
      w.bahan = (w.bahan ? w.bahan + '\n' : '') + b.nama;
      const ta = $(`#f-rkpm-${el.dataset.i}-bahan`); if (ta) ta.value = w.bahan;
      el.value = ''; markDirty();
    },
    'm-prodi'(el) { state.masterProdi = el.value; renderMaster(); },
    async 'm-import'(el) {
      const file = el.files[0]; if (!file) return;
      state.importKind = el.dataset.kind;
      state.importProdi = state.masterProdi || (state.master.Prodi[0] && state.master.Prodi[0].nama) || '';
      try {
        const data = await busy('Membaca file…', () => Importer.readFile(file));
        state.importRows = Importer.parse(data, state.importKind);
        if (!state.importRows.length) throw new Error('Tidak ada butir yang dikenali dalam file. Coba gunakan templat Excel.');
        renderImport();
      } catch (e) { toast(e.message, 'error'); }
      el.value = '';
    }
  };

  // ---------- pendengar peristiwa ----------
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (!a || a.tagName === 'SELECT' || a.tagName === 'INPUT') return;
    const fn = actions[a.dataset.act];
    if (fn) { e.preventDefault(); fn(a.dataset, a); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.bind && state.current) {
      setPath(state.current, el.dataset.bind, el.value);
      markDirty(); refreshIndicators();
      const wk = el.closest('details[data-week]');
      if (wk) {
        const w = state.current.rkpm[+wk.dataset.week];
        wk.querySelector('.wk-num').textContent = w.mg || '?';
        wk.querySelector('.wk-sum').textContent = w.sub ? w.sub.slice(0, 110) : 'Sub-CPMK belum diisi';
        wk.querySelector('.wk-bobot').textContent = w.bobot !== '' ? fmtNum(num(w.bobot)) + '%' : '';
      }
    } else if (el.dataset.mbind) {
      const [sh, id, f] = el.dataset.mbind.split('.');
      const row = state.master[sh].find(x => x.id === id);
      if (row) { row[f] = el.value; state.masterChanged.add(sh + '|' + id); }
      const btn = $('[data-act="m-save"]'); if (btn) { btn.disabled = false; btn.textContent = `Simpan perubahan (${state.masterChanged.size})`; }
    } else if (el.dataset.ibind) {
      const [i, f] = el.dataset.ibind.split('.');
      const row = state.importRows[+i];
      row[f] = el.type === 'checkbox' ? el.checked : el.value;
      if (f === 'include') { el.closest('tr').classList.toggle('excluded', !el.checked); const n = state.importRows.filter(r => r.include).length; const b = $('[data-act="i-save"]'); b.textContent = `Simpan ${n} butir`; b.disabled = !n; }
    } else if (el.hasAttribute('data-ibind-prodi')) {
      state.importProdi = el.value;
    }
  });
  document.addEventListener('change', e => {
    const el = e.target, k = el.dataset.actChange;
    if (k && changeActions[k]) changeActions[k](el);
  });
  window.addEventListener('hashchange', () => { keepOpenWeeks(); render(); window.scrollTo(0, 0); });
  window.addEventListener('online', updateConn);
  window.addEventListener('offline', updateConn);

  // Pasang sebagai aplikasi
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---------- mulai ----------
  (async function start() {
    try { await busy('Memuat data…', loadAll); }
    catch (e) { toast(e.message, 'error'); }
    render();
  })();
})();
