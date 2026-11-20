const $ = (id) => document.getElementById(id);
const LABEL_H_MM = 12;
const SNAP_MM = 0.5;
const SNAP_EDGE_MM = 0.6;

let elements = [];
let selected = -1;
let scale = 26;
let guideX = null, guideY = null;

async function loadStatus() {
  const el = $('status');
  if (!el) return;
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'нет связи');
    const p = d.printer || {}, paper = d.rfid_paper || {};
    const parts = [];
    if (p.ModelID) parts.push(`модель <b>${p.ModelID}</b>`);
    if (p.Battery !== undefined) parts.push(`заряд <b>${p.Battery}</b>`);
    if (paper.tag) parts.push(`этикетки <b>${paper.labelType}</b>, осталось <b>${paper.left}</b>`);
    el.innerHTML = parts.join(' · ') || 'принтер на связи';
  } catch (e) {
    el.innerHTML = `<span class="warn">нет связи: ${e.message}</span>`;
  }
}

function labelLength() {
  return parseFloat($('length')?.value) || 30;
}

function computeScale() {
  const stage = $('stage');
  const avail = Math.max(300, (stage ? stage.clientWidth : 600) - 50);
  scale = Math.max(8, Math.min(30, avail / labelLength()));
}

function renderCanvas() {
  computeScale();
  const label = $('label');
  if (!label) return;
  const W = labelLength() * scale;
  const H = LABEL_H_MM * scale;

  label.style.width = W + 'px';
  label.style.height = H + 'px';
  label.style.setProperty('--mm', scale + 'px');
  if ($('grid')) label.classList.toggle('no-grid', !$('grid').checked);

  [...label.querySelectorAll('.el')].forEach((n) => n.remove());

  elements.forEach((el, i) => {
    const node = document.createElement('div');
    node.className = 'el' + (i === selected ? ' selected' : '') + (el.transparent ? ' is-transparent' : '');
    node.dataset.i = i;
    node.style.left = el.x * scale + 'px';
    node.style.top = el.y * scale + 'px';

        if (el.kind === 'diag') {
      const x1 = el.x || 0, y1 = el.y || 0, x2 = el.x2 ?? (x1 + 10), y2 = el.y2 ?? (y1 + 6);
      const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
      const bw = Math.max(0.5, Math.abs(x2 - x1)), bh = Math.max(0.5, Math.abs(y2 - y1));
      node.style.left = minX * scale + 'px';
      node.style.top = minY * scale + 'px';
      node.style.width = bw * scale + 'px';
      node.style.height = bh * scale + 'px';
      node.style.background = 'transparent';
      node.style.overflow = 'visible';
      if (i !== selected) node.style.borderColor = 'transparent';
      const sw = Math.max(1, (el.thickness || 0.4) * scale);
      node.innerHTML = `<svg width="${bw * scale}" height="${bh * scale}" style="overflow:visible;display:block;pointer-events:none"><line x1="${(x1 - minX) * scale}" y1="${(y1 - minY) * scale}" x2="${(x2 - minX) * scale}" y2="${(y2 - minY) * scale}" stroke="#111" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
      if (i === selected) {
        const h1 = document.createElement('div');
        h1.dataset.end = '1';
        h1.title = 'Тяните начало линии (X1, Y1)';
        h1.style.cssText = `position:absolute;left:${(x1 - minX) * scale - 5}px;top:${(y1 - minY) * scale - 5}px;width:10px;height:10px;border-radius:50%;background:#118D6A;border:1.5px solid #fff;cursor:crosshair;z-index:15`;
        const h2 = document.createElement('div');
        h2.dataset.end = '2';
        h2.title = 'Тяните конец линии (X2, Y2)';
        h2.style.cssText = `position:absolute;left:${(x2 - minX) * scale - 5}px;top:${(y2 - minY) * scale - 5}px;width:10px;height:10px;border-radius:50%;background:#0F172A;border:1.5px solid #fff;cursor:crosshair;z-index:15`;
        node.appendChild(h1);
        node.appendChild(h2);
      }
      label.appendChild(node);
      return;
    }

    if (el.kind === 'barcode') {
      node.style.width = (el.w || labelLength()) * scale + 'px';
      node.style.height = (el.h || 12) * scale + 'px';
      node.style.background = 'repeating-linear-gradient(90deg, #111 0 2px, #fff 2px 5px, #111 5px 6px, #fff 6px 9px)';
      node.innerHTML = '<span style="background:rgba(255,255,255,.9);padding:1px 4px;font-size:11px;font-weight:700;position:absolute;bottom:1px;left:4px">' +
        (el.bcFormat || 'auto').toUpperCase() + ': ' + (el.text || '') + '</span>';
      label.appendChild(node);
      return;
    }

    if (el.kind === 'line' || el.kind === 'frame' || el.kind === 'circle') {
      node.style.width = (el.w || 1) * scale + 'px';
      node.style.height = (el.h || 0.4) * scale + 'px';
      if (el.kind === 'line') {
        node.style.background = '#111';
      } else {
        node.style.background = el.transparent ? 'none' : '#ffffff';
        node.style.border = `${Math.max(1, (el.thickness || 0.3) * scale)}px solid #111`;
        if (el.kind === 'circle') node.style.borderRadius = '50%';
      }
      label.appendChild(node);
      return;
    }

    if (el.kind === 'image') {
      node.style.width = (el.w || 8) * scale + 'px';
      node.style.height = (el.h || 8) * scale + 'px';
      if (el.image) {
        const img = document.createElement('img');
        img.src = el.image;
      img.style.objectFit = el.stretch ? 'fill' : 'contain';
        img.style.objectFit = el.stretch ? 'fill' : 'contain';
        node.appendChild(img);
      } else {
        node.innerHTML = '<span class="ph">нет картинки</span>';
      }
      label.appendChild(node);
      return;
    }

    const boxW = (el.w || labelLength()) * scale;
    const boxH = (el.h || el.line || (el.font || 3)) * scale;
    const rot = ((el.rotate || 0) % 360 + 360) % 360;
    const swapped = rot === 90 || rot === 270;

    node.style.width = (swapped ? boxH : boxW) + 'px';
    node.style.height = (swapped ? boxW : boxH) + 'px';

    const inner = document.createElement('div');
    inner.className = 'txt';
    inner.style.width = boxW + 'px';
    inner.style.height = boxH + 'px';
    const lines = (el.text || '').split('\n');
    const lineCount = Math.max(1, lines.length);
    let pct = 1.0;
    const fs = String(el.fontSize || '-1').trim().toLowerCase();
    if (fs.endsWith('p')) {
      const v = parseFloat(fs.slice(0, -1));
      if (v > 0) pct = Math.min(1, v / 100);
    }
    inner.style.fontSize = Math.max(8, (boxH / lineCount) * pct * 0.85) + 'px';
    inner.style.lineHeight = (boxH / lineCount) + 'px';
    inner.style.textAlign = el.align || 'left';
    inner.style.transformOrigin = 'top left';
    if (el.family) inner.style.fontFamily = `"${el.family}", sans-serif`;
    inner.style.fontWeight = el.bold ? '700' : '400';
    if (rot === 90) inner.style.transform = `translate(${boxH}px, 0) rotate(90deg)`;
    else if (rot === 180) inner.style.transform = `translate(${boxW}px, ${boxH}px) rotate(180deg)`;
    else if (rot === 270) inner.style.transform = `translate(0, ${boxW}px) rotate(270deg)`;
    inner.textContent = el.text || '';
    node.appendChild(inner);
    label.appendChild(node);
  });

  if (selected >= 0 && elements[selected]?.kind !== 'diag') {
    const selNode = label.querySelector('.el.selected');
    if (selNode) {
      const hdl = document.createElement('div');
      hdl.className = 'resize-handle';
      hdl.title = 'Тяните для изменения размера (или зажмите Shift в любом месте элемента)';
      selNode.appendChild(hdl);
    }
  }
  drawGuides(label);
  drawRuler();
}

function drawGuides(label) {
  [...label.querySelectorAll('.guide')].forEach((n) => n.remove());
  const add = (st) => { const g = document.createElement('div'); g.className = 'guide'; Object.assign(g.style, st); label.appendChild(g); };
  if (guideX !== null) add({ left: guideX * scale + 'px', top: 0, width: '1px', height: '100%' });
  if (guideY !== null) add({ top: guideY * scale + 'px', left: 0, height: '1px', width: '100%' });
}

function drawRuler() {
  const r = document.querySelector('.ruler-x');
  if (!r) return;
  r.style.width = labelLength() * scale + 'px';
  let html = '';
  for (let mm = 0; mm <= labelLength(); mm += 5) {
    html += `<span style="position:absolute;left:${mm * scale}px">${mm}</span>`;
  }
  r.innerHTML = html;
}

function snap(v) { return Math.round(v / SNAP_MM) * SNAP_MM; }
function sizeOf(el) { return { w: el.w || labelLength(), h: el.h || 3 }; }

function snapToEdges(el, x, y) {
  const L = labelLength(), H = LABEL_H_MM;
  const { w, h } = sizeOf(el);
  guideX = guideY = null;
  for (const c of [0, (L - w) / 2, L - w]) {
    if (Math.abs(x - c) < SNAP_EDGE_MM) { x = c; guideX = c <= 0.01 ? 0 : (Math.abs(c - (L - w) / 2) < 0.01 ? L / 2 : L); break; }
  }
  for (const c of [0, (H - h) / 2, H - h]) {
    if (Math.abs(y - c) < SNAP_EDGE_MM) { y = c; guideY = c <= 0.01 ? 0 : (Math.abs(c - (H - h) / 2) < 0.01 ? H / 2 : H); break; }
  }
  return { x: Math.max(0, Math.min(L - w, x)), y: Math.max(0, Math.min(H - h, y)) };
}
function select(i) { selected = i; renderCanvas(); showProps(); }

if ($('label')) {
  $('label').addEventListener('mousedown', (e) => {
    const node = e.target.closest('.el');
    if (!node) { select(-1); return; }
    const i = Number(node.dataset.i);
    select(i);
    const el = elements[i];
    const startX = e.clientX, startY = e.clientY;
    const ox = el.x, oy = el.y;
    const sz = sizeOf(el);
    const ow = el.w || sz.w || 4, oh = el.h || sz.h || 2;
    const isResize = e.shiftKey || e.target.classList.contains('resize-handle');

    const move = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (isResize || ev.shiftKey) {
        el.w = Math.min(Math.max(1, labelLength() - el.x), Math.max(1, snap(ow + dx)));
        el.h = Math.min(Math.max(0.5, LABEL_H_MM - el.y), Math.max(0.5, snap(oh + dy)));
        renderCanvas(); showProps(); return;
      }
      let nx = snap(Math.max(0, ox + dx)), ny = snap(Math.max(0, oy + dy));
      if (!ev.altKey) { const r = snapToEdges(el, nx, ny); nx = r.x; ny = r.y; }
      else { guideX = guideY = null; }
      el.x = nx; el.y = ny;
      renderCanvas(); showProps();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      guideX = guideY = null; renderCanvas(); refreshPreview();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  });
}

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0 &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    elements.splice(selected, 1); select(-1); refreshPreview(); e.preventDefault();
  }
});

async function loadFonts() {
  try {
    const r = await fetch('/api/fonts');
    const d = await r.json();
    const sel = $('p-family');
    if (!sel) return;
    sel.innerHTML = '<option value="">по умолчанию</option>';
    (d.families || []).forEach((f) => {
      const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o);
    });
  } catch (e) {}
}

function showProps() {
  const has = selected >= 0 && selected < elements.length;
  if ($('props')) $('props').classList.toggle('hidden', !has);
  if ($('no-selection')) $('no-selection').classList.toggle('hidden', has);
  if (!has) return;

  const el = elements[selected];
  if ($('p-x')) $('p-x').value = el.x;
  if ($('p-y')) $('p-y').value = el.y;
  if ($('p-w')) $('p-w').value = el.w || 4;
    if ($('p-h')) $('p-h').value = el.h || 3;
  if ($('p-order')) {
    $('p-order').max = Math.max(1, elements.length);
    $('p-order').value = selected + 1;
  }

  const isText = el.kind === 'text', isBc = el.kind === 'barcode';
  if ($('text-props')) $('text-props').classList.toggle('hidden', !isText);
  if ($('barcode-props')) $('barcode-props').classList.toggle('hidden', !isBc);
  if ($('common-text-style')) $('common-text-style').classList.toggle('hidden', !(isText || isBc));
  if ($('image-props')) $('image-props').classList.toggle('hidden', el.kind !== 'image');
  if ($('p-img-stretch')) $('p-img-stretch').checked = !!el.stretch;
  if ($('shape-props')) $('shape-props').classList.toggle('hidden', !(el.kind === 'frame' || el.kind === 'circle' || el.kind === 'diag'));

  if (isText) {
    if ($('p-text')) $('p-text').value = el.text || '';
    if ($('p-align')) $('p-align').value = el.align || 'left';
    if ($('p-rotate')) $('p-rotate').value = String(el.rotate || 0);
  }
  if (isBc) {
    if ($('p-bc-data')) $('p-bc-data').value = el.text || '';
    if ($('p-bc-format')) $('p-bc-format').value = el.bcFormat || 'auto';
    if ($('p-bc-gap')) $('p-bc-gap').value = el.gapPx ?? 2;
  }
  if (isText || isBc) {
    if ($('p-family')) $('p-family').value = el.family || '';
    if ($('p-fontsize')) $('p-fontsize').value = el.fontSize || '-1';
    if ($('p-bold')) $('p-bold').checked = !!el.bold;
  }
  if ($('p-thickness')) $('p-thickness').value = el.thickness || 0.3;
  if ($('diag-props')) $('diag-props').classList.toggle('hidden', el.kind !== 'diag');
  if (el.kind === 'diag') { if ($('p-x2')) $('p-x2').value = el.x2 ?? 0; if ($('p-y2')) $('p-y2').value = el.y2 ?? 0; }
  if ($('p-transparent')) $('p-transparent').checked = !!el.transparent;
  if ($('p-hide-if')) $('p-hide-if').value = el.hideIfEmpty || '';
}

function bindProp(id, apply, evName = 'input') {
  const el = $(id);
  if (!el) return;
  el.addEventListener(evName, () => {
    if (selected < 0) return;
    apply(elements[selected], el);
    renderCanvas(); schedulePreview();
  });
}

bindProp('p-x', (el, inp) => { el.x = Math.max(0, parseFloat(inp.value) || 0); });
bindProp('p-y', (el, inp) => { el.y = Math.max(0, parseFloat(inp.value) || 0); });
bindProp('p-w', (el, inp) => { const v = parseFloat(inp.value); if (v >= 0.1) el.w = v; });
bindProp('p-h', (el, inp) => { const v = parseFloat(inp.value); if (v >= 0.1) el.h = v; });
bindProp('p-text', (el, inp) => { el.text = inp.value; });
bindProp('p-align', (el, inp) => { el.align = inp.value; }, 'change');
bindProp('p-rotate', (el, inp) => { el.rotate = parseInt(inp.value, 10) || 0; }, 'change');
bindProp('p-family', (el, inp) => { el.family = inp.value; }, 'change');
bindProp('p-fontsize', (el, inp) => { el.fontSize = inp.value; el.font = 0; el.line = 0; });
bindProp('p-bold', (el, inp) => { el.bold = inp.checked; }, 'change');
bindProp('p-bc-data', (el, inp) => { el.text = inp.value; });
bindProp('p-bc-format', (el, inp) => { el.bcFormat = inp.value; }, 'change');
bindProp('p-bc-gap', (el, inp) => { el.gapPx = Math.max(0, parseInt(inp.value, 10) || 0); });
bindProp('p-thickness', (el, inp) => { el.thickness = Math.max(0.05, parseFloat(inp.value) || 0.3); });
if ($('p-fs-btn') && $('p-fs-menu') && $('p-fontsize')) {
  $('p-fs-btn').onclick = (e) => { e.stopPropagation(); $('p-fs-menu').classList.toggle('hidden'); };
  $('p-fs-menu').querySelectorAll('div[data-val]').forEach((item) => {
    item.onclick = () => {
      if (selected >= 0 && elements[selected]?.kind !== 'diag') {
        elements[selected].fontSize = item.dataset.val; elements[selected].font = 0; elements[selected].line = 0;
        $('p-fontsize').value = item.dataset.val; renderCanvas(); schedulePreview();
      }
      $('p-fs-menu').classList.add('hidden');
    };
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.combo-wrap')) $('p-fs-menu').classList.add('hidden'); });
}

if ($('add-text')) $('add-text').onclick = () => { elements.push({ kind: 'text', x: 1, y: 1, w: labelLength() - 2, h: 3.5, text: 'Надпись {1}', fontSize: '-1', align: 'left' }); select(elements.length - 1); refreshPreview(); };
if ($('add-barcode')) $('add-barcode').onclick = () => { elements.push({ kind: 'barcode', x: 1, y: 0.5, w: Math.max(10, labelLength() - 2), h: 11, text: '{1}', bcFormat: 'auto', fontSize: '-1', bold: false }); select(elements.length - 1); refreshPreview(); };
if ($('add-line')) $('add-line').onclick = () => { elements.push({ kind: 'line', x: 1, y: 5.7, w: labelLength() - 2, h: 0.4 }); select(elements.length - 1); refreshPreview(); };
if ($('add-frame')) $('add-frame').onclick = () => { elements.push({ kind: 'frame', x: 0.4, y: 0.4, w: labelLength() - 0.8, h: 11.2, thickness: 0.4, transparent: true }); select(elements.length - 1); refreshPreview(); };
if ($('add-stamp')) $('add-stamp').onclick = () => { elements.push({ kind: 'text', x: 1, y: 9.5, w: labelLength() - 2, h: 2, text: '{дата} {время}', fontSize: '-1', align: 'right' }); select(elements.length - 1); refreshPreview(); };
if ($('add-image') && $('image-file')) $('add-image').onclick = () => $('image-file').click();
if ($('del-el')) $('del-el').onclick = () => { if (selected >= 0 && elements[selected]?.kind !== 'diag') { elements.splice(selected, 1); select(-1); refreshPreview(); } };

function readAsDataURL(file, cb) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); }
if ($('image-file')) $('image-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; readAsDataURL(f, (u) => { elements.push({ kind: 'image', x: 1, y: 1, w: 8, h: 8, image: u }); select(elements.length - 1); refreshPreview(); }); e.target.value = ''; });
if ($('p-image-file')) $('p-image-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (!f || selected < 0) return; readAsDataURL(f, (u) => { elements[selected].image = u; renderCanvas(); refreshPreview(); }); e.target.value = ''; });

if ($('grid')) $('grid').onchange = renderCanvas;
if ($('length')) $('length').addEventListener('input', () => { renderCanvas(); schedulePreview(); });

let previewTimer = null;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 350); }
function requestBody() {
  return {
    items: [$('sample')?.value || ''], elements, length: labelLength(),
    density: parseInt($('density')?.value, 10) || 2, label: $('label')?.value || '',
    copies: parseInt($('copies')?.value, 10) || 1, threshold: parseInt($('threshold')?.value, 10) || 200,
    flip: !!$('flip')?.checked
  };
}
async function refreshPreview() {
  try {
    const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody()) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      if ($('preview')) $('preview').classList.remove('ready');
      if ($('preview-empty')) { $('preview-empty').textContent = 'ошибка: ' + (d.error || 'макет'); $('preview-empty').style.display = 'block'; }
      return;
    }
    const blob = await r.blob();
    const img = $('preview');
    if (img) { if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url; img.classList.add('ready'); }
  } catch (e) { if ($('preview-empty')) $('preview-empty').textContent = 'ошибка: ' + e.message; }
}
if ($('refresh-preview')) $('refresh-preview').onclick = refreshPreview;
if ($('sample')) $('sample').addEventListener('input', schedulePreview);
function seriesItems() { return ($('series-text')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean); }
function updateCount() { const n = seriesItems().length; if ($('series-count')) $('series-count').textContent = `${n} этикеток`; }
if ($('series-text')) $('series-text').addEventListener('input', updateCount);
if ($('csv-btn') && $('csv-file')) $('csv-btn').onclick = () => $('csv-file').click();
if ($('csv-file')) $('csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  let rows = (await f.text()).split(/\r?\n/).map((l) => l.split(l.includes('\t') ? '\t' : (l.includes(';') ? ';' : ',')).map((s) => s.trim())).filter((c) => c.some(Boolean));
  if ($('csv-header')?.checked && rows.length > 1) rows = rows.slice(1);
  if ($('series-text')) $('series-text').value = rows.map((c) => c.join(';')).join('\n');
  updateCount(); e.target.value = '';
});

if ($('print-btn')) $('print-btn').onclick = async () => {
  const items = seriesItems();
  if (!items.length || !elements.length) { alert('Заполните список и элементы'); return; }
  const r = await fetch('/api/print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...requestBody(), items }) });
  const d = await r.json();
  if (!r.ok) { alert(d.error || 'ошибка печати'); return; }
  if ($('progress')) $('progress').classList.remove('hidden');
  while (true) {
    await new Promise((res) => setTimeout(res, 700));
    const jr = await fetch('/api/job?id=' + encodeURIComponent(d.job));
    if (!jr.ok) continue;
    const j = await jr.json();
    const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
    if ($('bar-fill')) $('bar-fill').style.width = pct + '%';
    if ($('progress-text')) $('progress-text').textContent = j.state === 'done' ? 'готово' : (j.state === 'error' ? 'ошибка: ' + j.error : `${j.done} из ${j.total}`);
    if (j.state === 'done' || j.state === 'error') break;
  }
};

function formatTemplateBadge(t) {
  const parts = [];
  if (t.hasDesigner || (t.elements && t.elements.length > 0)) parts.push('Дизайн');
  if (t.hasSingle) parts.push('Одиночная');
  if (t.hasSystem || t.system) parts.push('Системные');
  return parts.length ? `${t.name} [${parts.join(' + ')}]` : t.name;
}
async function loadTemplates() {
  try {
    const r = await fetch('/api/templates');
    const list = (await r.json()) || [];
    const sel = $('templates'); if (!sel) return;
    sel.innerHTML = '<option value="">— выберите —</option>';
    list.forEach((t) => { const o = document.createElement('option'); o.value = t.name; o.textContent = formatTemplateBadge(t); o.dataset.tpl = JSON.stringify(t); sel.appendChild(o); });
  } catch (e) {}
}
function applyTemplateObject(t) {
  elements = t.elements ? JSON.parse(JSON.stringify(t.elements)) : [];
  if ($('tpl-name')) $('tpl-name').value = t.name || '';
  if (t.length && $('length')) $('length').value = t.length;
  if (t.density && $('density')) $('density').value = t.density;
  if (t.label !== undefined && $('label')) $('label').value = t.label;
  if (t.copies && $('copies')) $('copies').value = t.copies;
  if (t.threshold && $('threshold')) $('threshold').value = t.threshold;
  if ($('flip')) $('flip').checked = !!t.flip;
  select(-1);
  renderCanvas();
  refreshPreview();
}

if ($('templates')) $('templates').addEventListener('change', (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt?.dataset.tpl) return;
  applyTemplateObject(JSON.parse(opt.dataset.tpl));
});
function tplMsg(txt, bad) { if ($('tpl-msg')) { $('tpl-msg').textContent = txt; $('tpl-msg').style.color = bad ? '#B3392F' : 'var(--green)'; } }
if ($('tpl-save')) $('tpl-save').onclick = async () => {
  const name = $('tpl-name')?.value.trim(); if (!name || !elements.length) { tplMsg('Укажите имя и добавьте элементы', true); return; }
  await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(JSON.parse($("templates")?.selectedOptions?.[0]?.dataset.tpl || "{}")), name, hasDesigner: true, length: labelLength(), counterStart: parseInt($("des-cnt-start")?.value, 10) || 1, counterStep: parseInt($("des-cnt-step")?.value, 10) || 1, density: parseInt($('density')?.value, 10) || 2, label: $('label')?.value || '', copies: parseInt($('copies')?.value, 10) || 1, threshold: parseInt($('threshold')?.value, 10) || 200, flip: !!$('flip')?.checked, elements }) });
  await loadTemplates(); if ($('templates')) $('templates').value = name; tplMsg(`шаблон «${name}» сохранён`);
};
if ($('tpl-del')) $('tpl-del').onclick = async () => { const n = $('templates')?.value; if (!n) return; await fetch('/api/templates?name=' + encodeURIComponent(n), { method: 'DELETE' }); await loadTemplates(); tplMsg(`шаблон «${n}» удалён`); };
if ($('tpl-new')) $('tpl-new').onclick = () => { elements = []; if ($('tpl-name')) $('tpl-name').value = ''; select(-1); renderCanvas(); refreshPreview(); tplMsg('холст очищен'); };
if ($('tpl-export')) $('tpl-export').onclick = () => {
  if (!elements.length) return;
  const name = $('tpl-name')?.value.trim() || 'template';
  const payload = {
    name,
    length: labelLength(),
    density: parseInt($('density')?.value, 10) || 2,
    label: $('label')?.value || '',
    copies: parseInt($('copies')?.value, 10) || 1,
    threshold: parseInt($('threshold')?.value, 10) || 200,
    flip: !!$('flip')?.checked,
    elements
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = name + '.niimbot.json';
  a.click();
  tplMsg(`шаблон «${name}» экспортирован со всеми параметрами`);
};
if ($('tpl-import') && $('tpl-import-file')) {
  $('tpl-import').onclick = () => $('tpl-import-file').click();
  $('tpl-import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const p = JSON.parse(await f.text());
    const t = Array.isArray(p) ? p[0] : p;
    if (t?.elements) {
      if (!t.name) t.name = f.name.replace(/\.niimbot\.json$|\.json$/i, '');
      applyTemplateObject(t);
      tplMsg(`шаблон «${t.name}» загружен (нажмите «Сохранить» для записи в список)`);
    }
    e.target.value = '';
  });
}

async function initDesigner() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) { const c = await r.json(); if (c?.length > 0 && $('length')) $('length').value = c.length;
      if (c) updateModeButton(!!c.keepAlive); }
  } catch (e) {}
  if (!elements.length) elements.push({ kind: 'text', x: 1, y: 3, w: labelLength() - 2, h: 6, text: '{1}', fontSize: '-1', align: 'center' });
  loadStatus(); loadFonts(); loadTemplates(); renderCanvas(); showProps(); updateCount(); refreshPreview();
}
initDesigner();

if ($('p-img-stretch')) {
  $('p-img-stretch').addEventListener('change', () => {
    if (selected >= 0 && elements[selected]) {
      elements[selected].stretch = $('p-img-stretch').checked;
      renderCanvas();
      refreshPreview();
    }
  });
}

// Управление порядком слоёв (на передний / задний план)
if ($('layer-up')) {
  $('layer-up').onclick = () => {
    if (selected < 0 || selected >= elements.length - 1) return;
    const [item] = elements.splice(selected, 1);
    elements.push(item);
    selected = elements.length - 1;
    renderCanvas();
    showProps();
    refreshPreview();
  };
}

if ($('layer-down')) {
  $('layer-down').onclick = () => {
    if (selected <= 0) return;
    const [item] = elements.splice(selected, 1);
    elements.unshift(item);
    selected = 0;
    renderCanvas();
    showProps();
    refreshPreview();
  };
}

// Перемещение выбранного элемента на заданную позицию слоя (1..elements.length)
function moveSelectedToOrder(newOrder1Based) {
  if (selected < 0 || elements.length < 2) return;
  const targetIdx = Math.max(0, Math.min(elements.length - 1, (parseInt(newOrder1Based, 10) || 1) - 1));
  if (targetIdx === selected) {
    if ($('p-order')) $('p-order').value = selected + 1;
    return;
  }
  const [item] = elements.splice(selected, 1);
  elements.splice(targetIdx, 0, item);
  selected = targetIdx;
  renderCanvas();
  showProps();
  refreshPreview();
}

if ($('p-order')) {
  $('p-order').addEventListener('change', () => moveSelectedToOrder($('p-order').value));
  $('p-order').addEventListener('input', () => moveSelectedToOrder($('p-order').value));
}

// Управление связью, режимом Keep-Alive и выключением сервера из шапки конструктора
function updateModeButton(keepAlive) {
  const btn = $('btn-mode-toggle');
  if (!btn) return;
  btn.dataset.keep = keepAlive ? 'true' : 'false';
  btn.textContent = keepAlive ? 'Режим: Keep-Alive' : 'Режим: On-Demand';
}

async function postHeaderAction(url, bodyObj, okMsg) {
  try {
    const opts = { method: 'POST' };
    if (bodyObj !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(bodyObj);
    }
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
    if (okMsg && $('status')) $('status').textContent = okMsg;
    return d;
  } catch (e) {
    alert(e.message);
    return null;
  }
}

if ($('btn-connect')) {
  $('btn-connect').onclick = async () => {
    if ($('status')) $('status').textContent = 'подключаюсь к принтеру…';
    const d = await postHeaderAction('/api/connect', undefined, null);
    if (d) loadStatus();
  };
}
if ($('btn-disconnect')) {
  $('btn-disconnect').onclick = async () => {
    await postHeaderAction('/api/disconnect', undefined, 'отключено вручную');
  };
}
if ($('btn-mode-toggle')) {
  $('btn-mode-toggle').onclick = async () => {
    const nextKeep = $('btn-mode-toggle').dataset.keep !== 'true';
    const d = await postHeaderAction('/api/mode', { keepAlive: nextKeep }, null);
    if (d) {
      updateModeButton(!!d.keepAlive);
      loadStatus();
    }
  };
}
if ($('refresh')) {
  $('refresh').onclick = () => loadStatus();
}
if ($('btn-shutdown')) {
  $('btn-shutdown').onclick = async () => {
    if (!confirm('Остановить локальный веб-сервер NIIMBOT?')) return;
    await postHeaderAction('/api/shutdown', undefined, 'сервер остановлен');
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;text-align:center"><h2>Сервер NIIMBOT N1 остановлен</h2><p>Эту вкладку можно закрыть.</p></div>';
  };
}

// Поддержка счётчика {c} / {n} в Конструкторе этикеток
if ($('templates')) {
  $('templates').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions && e.target.selectedOptions[0];
    if (!opt || !opt.dataset.tpl) return;
    try {
      const t = JSON.parse(opt.dataset.tpl);
      if ($('des-cnt-start')) $('des-cnt-start').value = t.counterStart ?? 1;
      if ($('des-cnt-step')) $('des-cnt-step').value = t.counterStep ?? 1;
    } catch (err) {}
  });
}

// ==========================================================================
// Дублирование элементов (Ctrl+D), встроенные пиктограммы и прозрачность
// ==========================================================================
function duplicateSelectedElement() {
  if (selected < 0 || selected >= elements.length) return;
  const copy = JSON.parse(JSON.stringify(elements[selected]));
  const maxW = labelLength(), maxH = LABEL_H_MM;
  const w = copy.w || 4, h = copy.h || 3;
  copy.x = snap(Math.min(Math.max(0, maxW - w), (copy.x || 0) + 1.5));
  copy.y = snap(Math.min(Math.max(0, maxH - h), (copy.y || 0) + 1.5));
  elements.push(copy);
  select(elements.length - 1);
  refreshPreview();
}

if ($('dup-el')) $('dup-el').onclick = duplicateSelectedElement;

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      duplicateSelectedElement();
    }
  }
});

// Привязка свойств прозрачного фона и условной видимости
bindProp('p-transparent', (el, inp) => { el.transparent = inp.checked; el.opaque = !inp.checked; }, 'change');
bindProp('p-hide-if', (el, inp) => { el.hideIfEmpty = inp.value.trim(); });

// Генератор чётких чёрно-белых пиктограмм (96x96 PNG data:URL)
function buildBuiltInIconDataURL(kind) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 96, 96);
  g.strokeStyle = '#000000';
  g.fillStyle = '#000000';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (kind === 'warn') {
    g.beginPath(); g.moveTo(48, 12); g.lineTo(86, 82); g.lineTo(10, 82); g.closePath(); g.stroke();
    g.fillRect(44, 34, 8, 26); g.fillRect(44, 67, 8, 8);
  } else if (kind === 'volt') {
    g.beginPath(); g.moveTo(56, 8); g.lineTo(24, 52); g.lineTo(48, 52); g.lineTo(38, 88); g.lineTo(72, 42); g.lineTo(48, 42); g.closePath(); g.fill();
  } else if (kind === 'fragile') {
    g.beginPath(); g.moveTo(26, 12); g.lineTo(70, 12); g.lineTo(66, 40); g.arc(48, 40, 18, 0, Math.PI, false); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(48, 58); g.lineTo(48, 84); g.moveTo(30, 84); g.lineTo(66, 84); g.stroke();
  } else if (kind === 'rain') {
    g.beginPath(); g.arc(48, 46, 34, Math.PI, 0, false); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(48, 12); g.lineTo(48, 78); g.arc(40, 78, 8, 0, Math.PI, false); g.stroke();
  } else if (kind === 'up') {
    g.beginPath(); g.moveTo(48, 14); g.lineTo(48, 84); g.moveTo(22, 40); g.lineTo(48, 14); g.lineTo(74, 40); g.stroke();
  } else if (kind === 'right') {
    g.beginPath(); g.moveTo(12, 48); g.lineTo(82, 48); g.moveTo(56, 22); g.lineTo(82, 48); g.lineTo(56, 74); g.stroke();
  } else if (kind === 'check') {
    g.beginPath(); g.moveTo(16, 52); g.lineTo(38, 76); g.lineTo(82, 22); g.lineWidth = 10; g.stroke();
  } else if (kind === 'cross') {
    g.beginPath(); g.moveTo(20, 20); g.lineTo(76, 76); g.moveTo(76, 20); g.lineTo(20, 76); g.lineWidth = 10; g.stroke();
  } else if (kind === 'gear') {
    g.beginPath(); g.arc(48, 48, 22, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(48, 48, 8, 0, Math.PI * 2); g.fill();
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      g.beginPath(); g.moveTo(48 + Math.cos(ang) * 24, 48 + Math.sin(ang) * 24);
      g.lineTo(48 + Math.cos(ang) * 36, 48 + Math.sin(ang) * 36); g.stroke();
    }
  } else if (kind === 'lock') {
    g.strokeRect(22, 42, 52, 42);
    g.beginPath(); g.arc(48, 42, 16, Math.PI, 0, false); g.stroke();
    g.beginPath(); g.arc(48, 61, 5, 0, Math.PI * 2); g.fill();
  }
  return c.toDataURL('image/png');
}

if ($('add-icon') && $('icon-picker-menu')) {
  $('add-icon').onclick = (e) => {
    e.stopPropagation();
    $('icon-picker-menu').classList.toggle('hidden');
  };
  $('icon-picker-menu').querySelectorAll('.icon-opt').forEach((btn) => {
    btn.onclick = () => {
      const dataUrl = buildBuiltInIconDataURL(btn.dataset.icon);
      elements.push({ kind: 'image', x: 1, y: 3, w: 6, h: 6, image: dataUrl, transparent: true });
      $('icon-picker-menu').classList.add('hidden');
      select(elements.length - 1);
      refreshPreview();
    };
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#icon-picker-menu') && e.target.id !== 'add-icon') {
      $('icon-picker-menu').classList.add('hidden');
    }
  });
}

// Добавление вертикальной линии и окружности в Конструктор этикеток
if ($('add-vline')) {
  $('add-vline').onclick = () => {
    const cx = snap(Math.max(0, labelLength() / 2 - 0.2));
    elements.push({ kind: 'line', x: cx, y: 1, w: 0.4, h: 10 });
    select(elements.length - 1);
    refreshPreview();
  };
}

if ($('add-circle')) {
  $('add-circle').onclick = () => {
    elements.push({ kind: 'circle', x: 2, y: 2, w: 8, h: 8, thickness: 0.4, transparent: true });
    select(elements.length - 1);
    refreshPreview();
  };
}

// ==========================================================================
// Кнопка "+ Косая линия", поля X2/Y2 и перетаскивание концов отрезка мышью
// ==========================================================================
bindProp('p-x2', (el, inp) => { el.x2 = Math.max(0, parseFloat(inp.value) || 0); });
bindProp('p-y2', (el, inp) => { el.y2 = Math.max(0, Math.min(LABEL_H_MM, parseFloat(inp.value) || 0)); });

if ($('add-diag')) {
  $('add-diag').onclick = () => {
    const x2 = snap(Math.min(labelLength() - 1, 14));
    elements.push({ kind: 'diag', x: 2, y: 2, x2, y2: 10, thickness: 0.4 });
    select(elements.length - 1);
    refreshPreview();
  };
}

if ($('label')) {
  $('label').addEventListener('mousedown', (e) => {
    const endIdx = e.target && e.target.dataset && e.target.dataset.end;
    if (!endIdx || selected < 0 || !elements[selected] || elements[selected].kind !== 'diag') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const el = elements[selected];
    const startX = e.clientX, startY = e.clientY;
    const ox = endIdx === '1' ? (el.x || 0) : (el.x2 ?? 0);
    const oy = endIdx === '1' ? (el.y || 0) : (el.y2 ?? 0);

    const moveEnd = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      const nx = Math.max(0, Math.min(labelLength(), snap(ox + dx)));
      const ny = Math.max(0, Math.min(LABEL_H_MM, snap(oy + dy)));
      if (endIdx === '1') { el.x = nx; el.y = ny; }
      else { el.x2 = nx; el.y2 = ny; }
      renderCanvas();
      showProps();
    };
    const upEnd = () => {
      document.removeEventListener('mousemove', moveEnd);
      document.removeEventListener('mouseup', upEnd);
      renderCanvas();
      refreshPreview();
    };
    document.addEventListener('mousemove', moveEnd);
    document.addEventListener('mouseup', upEnd);
  }, true);
}

// Синхронное перемещение обоих концов косой линии при перетаскивании за тело отрезка
if ($('label')) {
  $('label').addEventListener('mousedown', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.end) return;
    const node = e.target.closest('.el');
    if (!node) return;
    const i = Number(node.dataset.i);
    const el = elements[i];
    if (!el || el.kind !== 'diag') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    select(i);
    const startX = e.clientX, startY = e.clientY;
    const ox1 = el.x || 0, oy1 = el.y || 0, ox2 = el.x2 ?? 0, oy2 = el.y2 ?? 0;
    const L = labelLength(), H = LABEL_H_MM;

    const moveDiag = (ev) => {
      let dx = snap((ev.clientX - startX) / scale);
      let dy = snap((ev.clientY - startY) / scale);
      const minX = Math.min(ox1, ox2), maxX = Math.max(ox1, ox2);
      const minY = Math.min(oy1, oy2), maxY = Math.max(oy1, oy2);
      dx = Math.max(-minX, Math.min(L - maxX, dx));
      dy = Math.max(-minY, Math.min(H - maxY, dy));
      el.x = snap(ox1 + dx);
      el.y = snap(oy1 + dy);
      el.x2 = snap(ox2 + dx);
      el.y2 = snap(oy2 + dy);
      renderCanvas();
      showProps();
    };
    const upDiag = () => {
      document.removeEventListener('mousemove', moveDiag);
      document.removeEventListener('mouseup', upDiag);
      renderCanvas();
      refreshPreview();
    };
    document.addEventListener('mousemove', moveDiag);
    document.addEventListener('mouseup', upDiag);
  }, true);
}

// Подмена полей Ширина/Высота на Конец X2/Y2 при выборе косой линии
const _prevShowPropsDiag = showProps;
showProps = function() {
  _prevShowPropsDiag();
  if (selected < 0 || selected >= elements.length) return;
  const el = elements[selected];
  const isDiag = el.kind === 'diag';
  const lblW = $('p-w') ? $('p-w').closest('label') : null;
  const lblH = $('p-h') ? $('p-h').closest('label') : null;
  if (lblW) lblW.classList.toggle('hidden', isDiag);
  if (lblH) lblH.classList.toggle('hidden', isDiag);
  if ($('lbl-x2')) $('lbl-x2').classList.toggle('hidden', !isDiag);
  if ($('lbl-y2')) $('lbl-y2').classList.toggle('hidden', !isDiag);
  if (isDiag) {
    if ($('p-x2')) $('p-x2').value = el.x2 ?? 0;
    if ($('p-y2')) $('p-y2').value = el.y2 ?? 0;
  }
};
