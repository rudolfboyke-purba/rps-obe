/* Pengisi templat .docx sederhana (tanpa server).
   Penanda di templat:
   {nama}                  -> diganti nilai
   {#daftar} ... {/daftar} -> dalam satu baris tabel: baris diulang untuk tiap item daftar
   Teks berisi baris baru (\n) ditulis sebagai line break di Word. */
(function (global) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XMLNS = 'http://www.w3.org/XML/1998/namespace';
  const TAG = /\{([#\/]?)([A-Za-z0-9_]+)\}/g;

  function textNodes(el) { return Array.from(el.getElementsByTagNameNS(W, 't')); }

  function fillText(tNode, scope) {
    const src = tNode.textContent;
    if (!src.includes('{')) return;
    const out = src.replace(TAG, (m, mark, key) => {
      if (mark) return '';
      const v = scope && Object.prototype.hasOwnProperty.call(scope, key) ? scope[key] : '';
      return v == null ? '' : String(v);
    });
    const parts = out.split('\n');
    tNode.textContent = parts[0];
    tNode.setAttributeNS(XMLNS, 'xml:space', 'preserve');
    if (parts.length === 1) return;
    const run = tNode.parentNode, doc = tNode.ownerDocument;
    let ref = tNode;
    for (let i = 1; i < parts.length; i++) {
      const br = doc.createElementNS(W, 'w:br');
      const t = doc.createElementNS(W, 'w:t');
      t.setAttributeNS(XMLNS, 'xml:space', 'preserve');
      t.textContent = parts[i];
      run.insertBefore(br, ref.nextSibling);
      run.insertBefore(t, br.nextSibling);
      ref = t;
    }
  }

  function fillXml(xml, data) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Templat Word tidak dapat dibaca.');

    // 1) Baris tabel berulang
    Array.from(doc.getElementsByTagNameNS(W, 'tr')).forEach(tr => {
      const txt = textNodes(tr).map(t => t.textContent).join('');
      const m = txt.match(/\{#([A-Za-z0-9_]+)\}/);
      if (!m) return;
      const list = Array.isArray(data[m[1]]) && data[m[1]].length ? data[m[1]] : [{}];
      const parent = tr.parentNode;
      list.forEach(item => {
        const clone = tr.cloneNode(true);
        textNodes(clone).forEach(t => fillText(t, item));
        parent.insertBefore(clone, tr);
      });
      parent.removeChild(tr);
    });

    // 2) Nilai tunggal
    textNodes(doc).forEach(t => fillText(t, data));
    return new XMLSerializer().serializeToString(doc);
  }

  async function fillDocx(arrayBuffer, data) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const path = 'word/document.xml';
    const xml = await zip.file(path).async('string');
    zip.file(path, fillXml(xml, data));
    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  global.DocxFill = { fillXml, fillDocx };
})(window);
