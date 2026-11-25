/* Membaca CPL / bahan kajian dari Excel, CSV, Word (.docx), atau PDF (berteks, bukan hasil scan).
   Hasil selalu ditampilkan dulu di tabel pratinjau agar bisa dikoreksi sebelum disimpan. */
window.Importer = (function () {
  const LIB = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  };
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res;
        s.onerror = () => { delete loaded[src]; rej(new Error('Pustaka pembaca file gagal dimuat. Periksa koneksi internet.')); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  const clean = s => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

  // ---------- pembaca per format ----------
  async function readXlsx(buf) {
    await loadScript(LIB.xlsx);
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    return { rows: rows.map(r => r.map(clean)).filter(r => r.some(Boolean)), lines: [] };
  }
  async function readDocx(buf) {
    await loadScript(LIB.mammoth);
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
    const doc = new DOMParser().parseFromString(value, 'text/html');
    const rows = [];
    doc.querySelectorAll('table tr').forEach(tr => {
      const cells = Array.from(tr.children).map(td => clean(td.innerText || td.textContent));
      if (cells.some(Boolean)) rows.push(cells);
    });
    const lines = [];
    doc.body.querySelectorAll('p, li, h1, h2, h3, h4').forEach(el => {
      if (el.closest('table')) return;
      const t = clean(el.textContent);
      if (!t) return;
      // Nomor otomatis Word hilang saat konversi; beri penanda agar tetap dikenali sebagai butir
      lines.push(el.tagName === 'LI' && !/^\s*\S+\s*\d/.test(t) ? '• ' + t : t);
    });
    return { rows, lines };
  }
  async function readPdf(buf) {
    await loadScript(LIB.pdf);
    pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const byY = new Map();
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = Math.round(it.transform[5] / 3) * 3;
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ x: it.transform[4], s: it.str });
      });
      Array.from(byY.keys()).sort((a, b) => b - a).forEach(y => {
        const t = clean(byY.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(' '));
        if (t) lines.push(t);
      });
    }
    if (!lines.length) throw new Error('PDF tidak berisi teks yang bisa dibaca (kemungkinan hasil scan). Gunakan file Word atau Excel.');
    return { rows: [], lines };
  }
  async function readText(buf) {
    const text = new TextDecoder().decode(buf);
    return { rows: [], lines: text.split(/\r?\n/).map(clean).filter(Boolean) };
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    if (/\.(xlsx|xls|csv|ods)$/.test(name)) return readXlsx(buf);
    if (/\.docx$/.test(name)) return readDocx(buf);
    if (/\.pdf$/.test(name)) return readPdf(buf);
    if (/\.txt$/.test(name)) return readText(buf);
    if (/\.doc$/.test(name)) throw new Error('Format .doc lama belum didukung. Simpan ulang sebagai .docx di Word.');
    throw new Error('Format file belum didukung. Gunakan .xlsx, .csv, .docx, atau .pdf.');
  }

  // ---------- pengenalan butir ----------
  const RANAH = { S: 'Sikap', P: 'Pengetahuan', KU: 'Keterampilan Umum', KK: 'Keterampilan Khusus' };
  const CODE_RE = /^\s*\(?((?:CPL|CPMK|BK|KU|KK|S|P)\s*[-.]?\s*\d+[a-z]?)\)?\s*[.:)\-–]?\s+(.+)$/i;
  const NUM_RE = /^\s*(?:(\d{1,3})[.)]|[•\-–▪●○■□]|[a-z][.)])\s+(.+)$/i;
  const RANAH_HEAD = /^(?:[A-D][.)]\s*)?(sikap|pengetahuan|penguasaan pengetahuan|keterampilan umum|keterampilan khusus)\b\s*:?\s*$/i;

  function normCode(c) { return c.toUpperCase().replace(/\s+/g, '').replace(/[.]/g, '-'); }
  function ranahFromCode(code) {
    const m = code.match(/^(KU|KK|S|P)/i);
    return m ? RANAH[m[1].toUpperCase()] : '';
  }
  function ranahFromHead(t) {
    const s = t.toLowerCase();
    if (s.includes('umum')) return RANAH.KU;
    if (s.includes('khusus')) return RANAH.KK;
    if (s.includes('sikap')) return RANAH.S;
    if (s.includes('pengetahuan')) return RANAH.P;
    return '';
  }

  function fromLines(lines, kind) {
    const items = [];
    let ranah = '', cur = null;
    lines.forEach(raw => {
      const t = clean(raw);
      if (!t) return;
      if (kind === 'cpl' && RANAH_HEAD.test(t)) { ranah = ranahFromHead(t); cur = null; return; }
      let m = t.match(CODE_RE);
      if (m) {
        const kode = normCode(m[1]);
        cur = { kode, ranah: ranahFromCode(kode) || ranah, teks: m[2] };
        items.push(cur); return;
      }
      m = t.match(NUM_RE);
      if (m) { cur = { kode: '', ranah, teks: m[2] }; items.push(cur); return; }
      // Lanjutan baris sebelumnya (teks panjang yang terpotong)
      if (cur && /^[a-z(,;]/.test(t)) { cur.teks += ' ' + t; return; }
      if (cur && !/[.;:]$/.test(cur.teks) && t.length > 3) { cur.teks += ' ' + t; return; }
    });
    return items;
  }

  function fromRows(rows, kind) {
    if (!rows.length) return [];
    const head = rows[0].map(c => c.toLowerCase());
    const find = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
    const iKode = find('kode', 'no');
    const iRanah = find('ranah', 'aspek', 'domain');
    const iTeks = kind === 'cpl'
      ? find('rumusan', 'deskripsi', 'capaian', 'cpl', 'uraian')
      : find('bahan kajian', 'nama', 'materi', 'uraian', 'deskripsi', 'topik');
    const hasHeader = iTeks >= 0 && iTeks !== iKode;
    const items = [];
    let ranah = '';
    rows.slice(hasHeader ? 1 : 0).forEach(r => {
      const filled = r.filter(Boolean);
      if (!filled.length) return;
      if (filled.length === 1 && kind === 'cpl' && RANAH_HEAD.test(filled[0])) { ranah = ranahFromHead(filled[0]); return; }
      let kode, teks, rn = '';
      if (hasHeader) {
        kode = iKode >= 0 ? r[iKode] : '';
        teks = r[iTeks];
        rn = iRanah >= 0 ? r[iRanah] : '';
      } else {
        const ci = r.findIndex(c => /^\(?(CPL|CPMK|BK|KU|KK|S|P)\s*[-.]?\s*\d+[a-z]?\)?$/i.test(c));
        if (ci >= 0) {
          kode = r[ci];
          teks = r.slice(ci + 1).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
        } else if (filled.length === 1) {
          const sub = fromLines([filled[0]], kind)[0];
          if (sub) { kode = sub.kode; teks = sub.teks; } else return;
        } else {
          const longest = filled.slice().sort((a, b) => b.length - a.length)[0];
          kode = /^\d{1,3}[.)]?$/.test(filled[0]) ? '' : (filled[0] === longest ? '' : filled[0]);
          teks = longest;
        }
      }
      if (!teks) return;
      kode = kode ? normCode(String(kode)) : '';
      if (/^\d+$/.test(kode)) kode = '';
      items.push({ kode, ranah: rn || ranahFromCode(kode) || ranah, teks: clean(teks) });
    });
    return items;
  }

  function parse(data, kind) {
    let items = data.rows.length ? fromRows(data.rows, kind) : [];
    if (data.lines.length) {
      const li = fromLines(data.lines, kind);
      if (li.length > items.length) items = li;
    }
    // Beri kode otomatis untuk butir tanpa kode
    const prefix = kind === 'cpl' ? 'CPL' : 'BK';
    let n = 0;
    items.forEach(it => { n++; if (!it.kode) it.kode = prefix + n; });
    return items.map(it => Object.assign({ include: true }, it));
  }

  async function downloadTemplate(kind) {
    await loadScript(LIB.xlsx);
    const aoa = kind === 'cpl'
      ? [['Kode', 'Ranah', 'Rumusan CPL'],
         ['S1', 'Sikap', 'Contoh: Bertakwa kepada Tuhan Yang Maha Esa dan mampu menunjukkan sikap religius'],
         ['P1', 'Pengetahuan', 'Contoh: Menguasai konsep teoretis ...'],
         ['KU1', 'Keterampilan Umum', 'Contoh: Mampu menyelesaikan pekerjaan berlingkup luas ...'],
         ['KK1', 'Keterampilan Khusus', 'Contoh: Mampu melakukan asuhan gizi ...']]
      : [['Kode', 'Bahan Kajian'], ['BK1', 'Contoh: Konsep dasar kesehatan masyarakat'], ['BK2', 'Contoh: Epidemiologi gizi']];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = kind === 'cpl' ? [{ wch: 8 }, { wch: 20 }, { wch: 90 }] : [{ wch: 8 }, { wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, kind === 'cpl' ? 'CPL' : 'Bahan Kajian');
    XLSX.writeFile(wb, kind === 'cpl' ? 'templat-cpl.xlsx' : 'templat-bahan-kajian.xlsx');
  }

  return { readFile, parse, downloadTemplate };
})();
