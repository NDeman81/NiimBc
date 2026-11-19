// NIIMBOT N1 — интерфейс печати этикеток.
// Никаких фреймворков: обычный JS, общение с драйвером через /api.

const $ = (id) => document.getElementById(id);

let mode = 'barcode';
let previewURL = null;

// ---------------------------------------------------------------- состояние

async function loadStatus() {
  const el = $('status');
  el.textContent = 'читаю состояние…';
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'нет связи');

    const p = d.printer || {};
    const paper = d.rfid_paper || {};
    const ribbon = d.rfid_ribbon || {};
    const parts = [];

    if (p.ModelID) parts.push(`модель <b>${p.ModelID}</b>`);
    if (p.Serial) parts.push(`№ <b>${p.Serial}</b>`);
    if (p.Battery !== undefined) parts.push(`заряд <b>${p.Battery}</b>`);
    if (paper.tag) {
      parts.push(`этикетки <b>${paper.labelType}</b>, осталось <b>${paper.left}</b>`);
    } else {
      parts.push('<span class="warn">метка рулона не прочитана</span>');
    }
    if (ribbon.tag) parts.push(`лента: осталось <b>${ribbon.left}</b>`);
    if (p.ModelID && p.ModelID !== 3586) {
      parts.push('<span class="warn">модель не N1</span>');
    }
    el.innerHTML = parts.join(' · ');
  } catch (e) {
    el.innerHTML = `<span class="warn">нет связи: ${e.message}</span>`;
  }
}

// ------------------------------------------------------------------- режимы

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    mode = tab.dataset.mode;
    if ($('pane-barcode')) $('pane-barcode').classList.toggle('hidden', mode !== 'barcode');
    if ($('pane-single')) $('pane-single').classList.toggle('hidden', mode !== 'single');
    if ($('pane-image')) $('pane-image').classList.toggle('hidden', mode !== 'image');
    if ($('pane-series')) $('pane-series').classList.toggle('hidden', mode !== 'series');
    if ($('pane-tpl')) $('pane-tpl').classList.toggle('hidden', mode !== 'tpl');
    if (mode === 'tpl' && typeof loadTplTabList === 'function') loadTplTabList();
    if ($('text-params-block')) $('text-params-block').classList.toggle('hidden', mode === 'image' || mode === 'tpl');
    document.querySelectorAll('.non-tpl-field').forEach((el) => el.classList.toggle('hidden', mode === 'tpl'));
    updateSeriesCount();
  };
});

function seriesItems() {
  return $('series-text').value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function updateSeriesCount() {
  const n = seriesItems().length;
  $('series-count').textContent = `${n} ${plural(n, 'этикетка', 'этикетки', 'этикеток')}`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

$('series-text').addEventListener('input', updateSeriesCount);

// ---------------------------------------------------------------- настройки

function intVal(id, def) {
  const el = $(id);
  if (!el || el.value === '') return def;
  const n = parseInt(el.value, 10);
  return Number.isNaN(n) ? def : n;
}

function collectRequest() {
  const base = {
    mode,
    length: parseFloat($('length').value) || 50,
    font: parseFloat($('font').value) || 0,
    density: parseInt($('density').value, 10) || 2,
    label: $('label').value,
    copies: parseInt($('copies').value, 10) || 1,
    flip: $('flip').checked,
    threshold: intVal('threshold', 200),
    address: $('address') ? $('address').value.trim() : '',
    fontName: $('cfg-fontname') ? $('cfg-fontname').value : '',
    fontSize: $('cfg-fontsize') ? ($('cfg-fontsize').value.trim() || '-1') : '-1',
    bold: $('cfg-bold') ? $('cfg-bold').checked : false,
    marginPx: intVal('cfg-margin', 4),
    sideMarginPx: intVal('cfg-sidemargin', 10),
    offsetPx: intVal('cfg-offset', 0)
  };

  if (mode === 'barcode') {
    const val = $('bc-data') ? $('bc-data').value.trim() : '';
    return {
      ...base,
      items: val ? [val] : [],
      bcFormat: $('cfg-bcformat') ? $('cfg-bcformat').value : 'auto',
      topText: $('bc-top') ? $('bc-top').value : '',
      bottomText: $('bc-bot') ? $('bc-bot').value : '',
      gapPx: intVal('cfg-gap', 4),
      textGapPx: intVal('cfg-textgap', 4)
    };
  }

  if (mode === 'image') {
    return {
      ...base,
      imageData: uploadedImageData,
      stretch: $('img-stretch') ? $('img-stretch').checked : false,
      items: uploadedImageData ? ['image'] : []
    };
  }

  if (mode === 'single') {
    return {
      ...base,
      items: [$('single-text').value]
    };
  }

  if (mode === 'tpl') {
    const lines = ($('tpl-print-items')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!selectedDesignTpl) {
      return { ...base, items: [] };
    }
    return {
      ...base,
      mode: 'series',
      items: lines,
      elements: selectedDesignTpl.elements || [],
      template: selectedDesignTpl.template || '',
      length: selectedDesignTpl.length || base.length,
      density: selectedDesignTpl.density || base.density,
      label: selectedDesignTpl.label !== undefined ? selectedDesignTpl.label : base.label,
      copies: parseInt($('copies')?.value, 10) || selectedDesignTpl.copies || 1,
      threshold: selectedDesignTpl.threshold || base.threshold,
      flip: !!selectedDesignTpl.flip
    };
  }

  return {
    ...base,
    items: seriesItems(),
    template: $('template').value
  };
}

function applySettings(s) {
  if (s.length) $('length').value = s.length;
  if (s.font !== undefined) $('font').value = s.font;
  if (s.density) $('density').value = s.density;
  if (s.label !== undefined) $('label').value = s.label;
  if (s.copies) $('copies').value = s.copies;
  if (s.template !== undefined) $('template').value = s.template;
  if (s.colorder !== undefined) $('colorder').value = s.colorder;
  $('flip').checked = !!s.flip;
}

// ------------------------------------------------------------- предпросмотр

async function doPreview() {
  const req = collectRequest();
  if (!req.items.length || !req.items[0].trim()) {
    alert('Введите текст этикетки');
    return;
  }
  try {
    const r = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || 'не удалось построить макет');
    }
    const blob = await r.blob();
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(blob);

    const img = $('preview');
    img.src = previewURL;
    img.classList.add('ready');

    const px = await imageSize(previewURL);
    $('preview-info').textContent =
      `${px.w}×${px.h} точек · ${(px.w / 8).toFixed(1)}×${(px.h / 8).toFixed(1)} мм` +
      (mode === 'series' ? ' · предпросмотр первой этикетки серии' : '');
  } catch (e) {
    alert(e.message);
  }
}

function imageSize(url) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
    i.src = url;
  });
}

// -------------------------------------------------------------------- печать

async function doPrint() {
  const req = collectRequest();
  const n = req.items.filter((s) => s.trim()).length;
  if (!n) {
    alert('Нечего печатать: список пуст');
    return;
  }
  const total = n * req.copies;
  if (!confirm(`Напечатать ${total} ${plural(total, 'этикетку', 'этикетки', 'этикеток')}?`)) return;

  $('print-btn').disabled = true;
  $('progress').classList.remove('hidden');
  setProgress(0, total, 'отправляю на принтер…');

  try {
    const r = await fetch('/api/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'не удалось начать печать');
    await pollJob(d.job, d.total);
  } catch (e) {
    $('progress-text').textContent = 'ошибка: ' + e.message;
  } finally {
    $('print-btn').disabled = false;
  }
}

async function pollJob(id, total) {
  while (true) {
    await new Promise((r) => setTimeout(r, 600));
    const r = await fetch('/api/job?id=' + encodeURIComponent(id));
    if (!r.ok) continue;
    const j = await r.json();
    setProgress(j.done, j.total || total, null);

    if (j.state === 'done') {
      setProgress(j.total, j.total, 'готово');
      loadStatus();
      return;
    }
    if (j.state === 'error') {
      $('progress-text').textContent = 'ошибка: ' + j.error;
      return;
    }
  }
}

function setProgress(done, total, note) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('bar-fill').style.width = pct + '%';
  $('progress-text').textContent =
    note || `напечатано ${done} из ${total} (${pct}%)`;
}

// ------------------------------------------------------------------ шаблоны

async function loadTemplates() {
  const r = await fetch('/api/templates');
  const list = await r.json();
  const sel = $('templates');
  sel.innerHTML = '<option value="">— выберите —</option>';
  (list || []).forEach((t) => {
    const o = document.createElement('option');
    o.value = t.name;
    o.textContent = t.name;
    o.dataset.tpl = JSON.stringify(t);
    sel.appendChild(o);
  });
}

async function saveTemplate() {
  const name = prompt('Название шаблона (например: кабельные бирки):');
  if (!name) return;
  const s = collectRequest();
  const t = {
    name: name.trim(),
    length: s.length, font: s.font, density: s.density,
    label: s.label, copies: s.copies, flip: s.flip,
    template: s.template,
    colorder: $('colorder').value,
  };
  const r = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(t),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    alert(d.error || 'не удалось сохранить');
    return;
  }
  await loadTemplates();
  $('templates').value = t.name;
}

async function deleteTemplate() {
  const name = $('templates').value;
  if (!name) return;
  if (!confirm(`Удалить шаблон «${name}»?`)) return;
  await fetch('/api/templates?name=' + encodeURIComponent(name), { method: 'DELETE' });
  await loadTemplates();
}

$('templates').addEventListener('change', (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt && opt.dataset.tpl) applySettings(JSON.parse(opt.dataset.tpl));
});


// Порядок столбцов — сокращение для шаблона: «4, 1, 2, 5» означает
// четыре строки на этикетке: столбец 4, затем 1, затем 2, затем 5.
// Заполняет поле шаблона, чтобы было видно, что именно уйдёт на печать.
function applyColumnOrder() {
  const raw = $('colorder').value.trim();
  if (!raw) return;
  const nums = raw.split(/[^0-9]+/).filter((s) => s.length > 0);
  if (!nums.length) return;
  $('template').value = nums.map((n) => `{${n}}`).join('\n');
}

$('colorder').addEventListener('input', applyColumnOrder);

// ---------------------------------------------------------------------- CSV

$('csv-btn').onclick = () => $('csv-file').click();

// Разбор строки CSV: учитывает кавычки и удвоенные кавычки внутри поля.
// Разделителем считается ; , или табуляция — что встретится первым.
function parseCsvLine(line) {
  const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

$('csv-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();

  let rows = text.split(/\r?\n/)
    .map(parseCsvLine)
    .filter((cols) => cols.some((c) => c.length > 0));

  // Строку заголовков из Excel отбрасываем, если попросили.
  if ($('csv-header').checked && rows.length > 1) rows = rows.slice(1);

  // Все столбцы сохраняем: их подставляет шаблон этикетки.
  const lines = rows.map((cols) => cols.join(';'));

  // Подсказываем, сколько столбцов в данных: по нему выбирают порядок.
  const width = rows.reduce((m, cols) => Math.max(m, cols.length), 0);
  $('csv-cols').textContent = width
    ? `в данных ${width} ${plural(width, 'столбец', 'столбца', 'столбцов')}`
    : '';

  $('series-text').value = lines.join('\n');
  updateSeriesCount();

  // переключаемся на серию, раз принесли список
  document.querySelector('.tab[data-mode="series"]').click();
  e.target.value = '';
});

// ------------------------------------------------------------------- запуск

$('refresh').onclick = loadStatus;
$('preview-btn').onclick = doPreview;
$('print-btn').onclick = doPrint;
$('tpl-save').onclick = saveTemplate;
$('tpl-del').onclick = deleteTemplate;

loadStatus();
loadTemplates();
updateSeriesCount();

// --------------------------------------------------------------------------
// Единое чтение и сохранение конфигурации (config.json) без дублей полей
// --------------------------------------------------------------------------
let uploadedImageData = '';
if ($('img-file')) {
  $('img-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      uploadedImageData = '';
      if ($('img-file-name')) $('img-file-name').textContent = 'Файл не выбран.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      uploadedImageData = String(reader.result || '');
      if ($('img-file-name')) $('img-file-name').textContent = 'Выбран файл: ' + file.name;
      if (typeof schedulePreview === 'function') schedulePreview();
    };
    reader.readAsDataURL(file);
  });
}



let currentConfig = {};

async function loadSystemFonts() {
  const sel = $('cfg-fontname');
  if (!sel) return;
  try {
    const r = await fetch('/api/fonts');
    if (!r.ok) return;
    const data = await r.json();
    const current = sel.value || (currentConfig && currentConfig.fontName) || '';
    sel.innerHTML = '<option value="">системный по умолчанию</option>';
    (data.families || []).forEach((fam) => {
      const opt = document.createElement('option');
      opt.value = fam;
      opt.textContent = fam;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  } catch (e) {
    console.error('Ошибка загрузки списка шрифтов:', e);
  }
}

async function loadAppConfig() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return;
    const c = await r.json();
    currentConfig = c;

    if ($('length')) $('length').value = c.length ?? 50;
    if ($('cfg-height')) $('cfg-height').value = c.height ?? 14;
    if ($('density')) $('density').value = c.density ?? 2;
    if ($('threshold')) $('threshold').value = c.threshold ?? 200;
    if ($('copies')) $('copies').value = c.copies ?? 1;
    if ($('address')) $('address').value = c.address || '';
    if ($('label')) $('label').value = c.label || '';
    if ($('flip')) $('flip').checked = !!c.flip;
    if ($('cfg-autoname')) $('cfg-autoname').checked = !!c.autoFileName;
    if ($('img-stretch')) $('img-stretch').checked = !!c.imgStretch;

    if ($('cfg-keepalive')) $('cfg-keepalive').value = String(c.keepAlive !== false);
    if ($('cfg-printmode')) $('cfg-printmode').value = c.printMode || 'fast';
    if ($('cfg-loglevel')) $('cfg-loglevel').value = c.logLevel || 'info';
    if ($('cfg-bcformat')) $('cfg-bcformat').value = c.bcFormat || 'auto';
    if ($('cfg-qrside')) $('cfg-qrside').value = c.defaultQrSide || 'left';
    if ($('cfg-fontname')) $('cfg-fontname').value = c.fontName || '';
    await loadSystemFonts();
    if ($('cfg-fontname')) $('cfg-fontname').value = c.fontName || '';
    if ($('cfg-fontsize')) $('cfg-fontsize').value = c.fontSize || '-1';
    if ($('cfg-offset')) $('cfg-offset').value = c.offsetPx ?? 0;
    if ($('cfg-margin')) $('cfg-margin').value = c.marginPx ?? 4;
    if ($('cfg-sidemargin')) $('cfg-sidemargin').value = c.sideMarginPx ?? 10;
    if ($('cfg-gap')) $('cfg-gap').value = c.gapPx ?? 4;
    if ($('cfg-textgap')) $('cfg-textgap').value = c.textGapPx ?? 4;
    if ($('cfg-savedir')) $('cfg-savedir').value = c.saveDir || '';
    if ($('cfg-savefile')) $('cfg-savefile').value = c.saveFile || 'niimbot_label_preview.png';
    if ($('cfg-watchdir')) $('cfg-watchdir').value = c.watchDir || '';
    if ($('cfg-bold')) $('cfg-bold').checked = !!c.isMainTextBold;
  } catch (e) {
    console.error('Ошибка загрузки config.json:', e);
  }
}

if ($('btn-save-cfg')) {
  $('btn-save-cfg').onclick = async () => {
    const payload = {
      ...currentConfig,
      length: parseFloat($('length').value) || 50,
      height: parseFloat($('cfg-height').value) || 14,
      density: parseInt($('density').value, 10) || 2,
      threshold: parseInt($('threshold').value, 10) || 200,
      copies: parseInt($('copies').value, 10) || 1,
      address: $('address').value.trim(),
      label: $('label').value,
      flip: $('flip').checked,
      autoFileName: $('cfg-autoname') ? $('cfg-autoname').checked : false,
      imgStretch: $('img-stretch') ? $('img-stretch').checked : false,
      keepAlive: $('cfg-keepalive').value === 'true',
      printMode: $('cfg-printmode') ? $('cfg-printmode').value : 'fast',
      logLevel: $('cfg-loglevel') ? $('cfg-loglevel').value : 'info',
      bcFormat: $('cfg-bcformat').value,
      defaultQrSide: $('cfg-qrside').value,
      fontName: $('cfg-fontname').value.trim(),
      fontSize: $('cfg-fontsize').value.trim() || '-1',
      offsetPx: parseInt($('cfg-offset').value, 10) || 0,
      marginPx: intVal('cfg-margin', 4),
      sideMarginPx: intVal('cfg-sidemargin', 10),
    offsetPx: intVal('cfg-offset', 0),
      gapPx: intVal('cfg-gap', 4),
      textGapPx: intVal('cfg-textgap', 4),
      saveDir: $('cfg-savedir').value.trim(),
      saveFile: $('cfg-savefile') ? ($('cfg-savefile').value.trim() || 'niimbot_label_preview.png') : 'niimbot_label_preview.png',
      watchDir: $('cfg-watchdir').value.trim(),
      isMainTextBold: $('cfg-bold').checked
    };

    $('cfg-status').textContent = 'Сохранение...';
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (r.ok) {
      await loadAppConfig();
      $('cfg-status').textContent = 'Сохранено в config.json!';
    } else {
      const err = await r.json().catch(() => ({}));
      $('cfg-status').textContent = 'Ошибка: ' + (err.error || r.status);
    }
  };

  $('btn-load-cfg').onclick = async () => {
    await loadAppConfig();
    $('cfg-status').textContent = 'Загружено из config.json.';
  };
}

loadAppConfig();
['bc-data', 'bc-top', 'bc-bot', 'cfg-fontname', 'cfg-fontsize', 'cfg-margin', 'cfg-sidemargin', 'cfg-gap'].forEach(id => {
  if ($(id)) $(id).addEventListener('input', () => { if (typeof schedulePreview === 'function') schedulePreview(); });
});
['cfg-bcformat', 'cfg-bold'].forEach(id => {
  if ($(id)) $(id).addEventListener('change', () => { if (typeof schedulePreview === 'function') schedulePreview(); });
});

// Сохранение текущего макета в PNG-файл (учитывая autoFileName и saveFile)
function buildDownloadName(req) {
  const autoName = $('cfg-autoname') ? $('cfg-autoname').checked : false;
  if (autoName && req.items && req.items.length > 0 && req.items[0].trim()) {
    const clean = req.items[0].trim()
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/^[._]+|[._]+$/g, '')
      .slice(0, 80);
    if (clean) return clean + '.png';
  }
  let name = $('cfg-savefile') ? $('cfg-savefile').value.trim() : '';
  if (!name) name = 'niimbot_label_preview.png';
  if (!name.toLowerCase().endsWith('.png')) name += '.png';
  return name;
}

if ($('save-file-btn')) {
  $('save-file-btn').onclick = async () => {
    const req = collectRequest();
    if (!req.items.length || !req.items[0].trim()) {
      alert('Сначала заполните данные этикетки');
      return;
    }
    try {
      const r = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'не удалось построить макет');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildDownloadName(req);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert(e.message);
    }
  };
}

if ($('img-stretch')) $('img-stretch').addEventListener('change', () => { if (typeof schedulePreview === 'function') schedulePreview(); });

// Управление связью, режимом Keep-Alive, калибровкой и выключением сервера
function updateModeButton(keepAlive) {
  const btn = $('btn-mode-toggle');
  if (!btn) return;
  btn.dataset.keep = keepAlive ? 'true' : 'false';
  btn.textContent = keepAlive ? 'Режим: Keep-Alive' : 'Режим: On-Demand';
  if ($('cfg-keepalive')) $('cfg-keepalive').value = keepAlive ? 'true' : 'false';
}

function updateBcLenHint() {
  const inp = $('bc-data');
  const hint = $('bc-len-hint');
  if (!inp || !hint) return;
  const v = inp.value.trim();
  if (!v) { hint.textContent = ''; return; }
  const isItf = /^[0-9]+$/.test(v) && (v.length % 2 === 0);
  hint.textContent = `(${v.length} симв. · ${isItf ? 'ITF' : 'Code 128'})`;
}

if ($('bc-data')) {
  $('bc-data').addEventListener('input', updateBcLenHint);
  updateBcLenHint();
}

async function postAction(url, bodyObj, okMsg) {
  try {
    const opts = { method: 'POST' };
    if (bodyObj !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(bodyObj);
    }
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
    if (okMsg) $('status').textContent = okMsg;
    return d;
  } catch (e) {
    alert(e.message);
    return null;
  }
}

if ($('btn-connect')) {
  $('btn-connect').onclick = async () => {
    $('status').textContent = 'подключаюсь к принтеру…';
    const d = await postAction('/api/connect', undefined, null);
    if (d && typeof loadStatus === 'function') loadStatus();
  };
}

if ($('btn-disconnect')) {
  $('btn-disconnect').onclick = async () => {
    await postAction('/api/disconnect', undefined, 'отключено вручную');
  };
}

if ($('btn-mode-toggle')) {
  $('btn-mode-toggle').onclick = async () => {
    const nextKeep = $('btn-mode-toggle').dataset.keep !== 'true';
    const d = await postAction('/api/mode', { keepAlive: nextKeep }, null);
    if (d) {
      updateModeButton(!!d.keepAlive);
      if (typeof loadStatus === 'function') loadStatus();
    }
  };
}

if ($('btn-cal-silent')) {
  $('btn-cal-silent').onclick = async () => {
    await postAction('/api/calibrate', undefined, 'тихая калибровка выполнена');
  };
}

if ($('btn-cal-feed')) {
  $('btn-cal-feed').onclick = async () => {
    await postAction('/api/calibrate?feed=1', undefined, 'калибровка с протяжкой выполнена');
  };
}

if ($('btn-testpage')) {
  $('btn-testpage').onclick = async () => {
    await postAction('/api/testpage', undefined, 'тестовая страница отправлена');
  };
}

if ($('btn-shutdown')) {
  $('btn-shutdown').onclick = async () => {
    if (!confirm('Остановить локальный веб-сервер NIIMBOT?')) return;
    await postAction('/api/shutdown', undefined, 'сервер остановлен');
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;text-align:center"><h2>Сервер NIIMBOT N1 остановлен</h2><p>Эту вкладку можно закрыть.</p></div>';
  };
}

// Кастомный выпадающий список для поля "Размер текста"
if ($('fs-drop-btn') && $('fs-menu') && $('cfg-fontsize')) {
  $('fs-drop-btn').onclick = (e) => {
    e.stopPropagation();
    $('fs-menu').classList.toggle('hidden');
  };
  $('fs-menu').querySelectorAll('div[data-val]').forEach((item) => {
    item.onclick = () => {
      $('cfg-fontsize').value = item.dataset.val;
      $('fs-menu').classList.add('hidden');
      if (typeof schedulePreview === 'function') schedulePreview();
    };
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combo-wrap')) {
      $('fs-menu').classList.add('hidden');
    }
  });
}

// Вкладка "По шаблону" на главной странице
let selectedDesignTpl = null;

async function loadTplTabList() {
  const sel = $('tpl-print-select');
  if (!sel) return;
  try {
    const r = await fetch('/api/templates');
    const list = (await r.json()) || [];
    const prev = sel.value;
    sel.innerHTML = '<option value="">— выберите сохранённый шаблон —</option>';
    list.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.name;
      o.dataset.tpl = JSON.stringify(t);
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  } catch (e) {}
}

if ($('tpl-print-select')) {
  $('tpl-print-select').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.dataset.tpl) {
      selectedDesignTpl = null;
      return;
    }
    selectedDesignTpl = JSON.parse(opt.dataset.tpl);
    if ($('tpl-print-info')) {
      $('tpl-print-info').textContent = `Шаблон «${selectedDesignTpl.name}»: длина ${selectedDesignTpl.length || 50} мм, элементов: ${(selectedDesignTpl.elements || []).length}`;
    }
  });
}

if ($('tpl-print-file-btn') && $('tpl-print-file')) {
  $('tpl-print-file-btn').onclick = () => $('tpl-print-file').click();
  $('tpl-print-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const t = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!t || (!Array.isArray(t.elements) && !t.template)) {
        throw new Error('Файл не содержит корректного шаблона');
      }
      selectedDesignTpl = t;
      if ($('tpl-print-select')) $('tpl-print-select').value = '';
      if ($('tpl-print-info')) {
        $('tpl-print-info').textContent = `Загружен из файла «${f.name}»: длина ${t.length || 50} мм, элементов: ${(t.elements || []).length}`;
      }
    } catch (err) {
      alert('Ошибка чтения шаблона: ' + err.message);
    }
    e.target.value = '';
  });
}

loadTplTabList();

// ==========================================================================
// Навигация по строкам списка (предпросмотр) и диапазон печати/сохранения
// ==========================================================================
let currentPreviewRow = 1; // 1-based индекс текущей строки

function activeListLines() {
  if (mode === 'series') return seriesItems();
  if (mode === 'tpl') {
    return ($('tpl-print-items')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function syncListNavUI() {
  const box = $('list-nav-box');
  if (!box) return;
  const isListMode = (mode === 'series' || mode === 'tpl');
  box.classList.toggle('hidden', !isListMode);
  if (!isListMode) return;

  const lines = activeListLines();
  const total = lines.length;
  if ($('nav-total')) $('nav-total').textContent = String(total);

  if (total === 0) {
    currentPreviewRow = 1;
    if ($('nav-idx')) { $('nav-idx').value = 1; $('nav-idx').max = 1; }
    return;
  }

  if (currentPreviewRow > total) currentPreviewRow = total;
  if (currentPreviewRow < 1) currentPreviewRow = 1;

  if ($('nav-idx')) {
    $('nav-idx').max = total;
    $('nav-idx').value = currentPreviewRow;
  }
  if ($('range-from')) {
    $('range-from').max = total;
    if ((parseInt($('range-from').value, 10) || 1) > total) $('range-from').value = 1;
  }
  if ($('range-to')) {
    $('range-to').max = total;
    const curTo = parseInt($('range-to').value, 10) || 0;
    if (curTo < 1 || curTo > total) $('range-to').value = total;
  }
}

function getSelectedRangeItems(allItems) {
  if (!allItems.length) return [];
  const rMode = $('range-mode') ? $('range-mode').value : 'all';
  if (rMode === 'current') {
    const idx = Math.max(0, Math.min(allItems.length - 1, currentPreviewRow - 1));
    return [allItems[idx]];
  }
  if (rMode === 'custom') {
    let from = parseInt($('range-from')?.value, 10) || 1;
    let to = parseInt($('range-to')?.value, 10) || allItems.length;
    if (from > to) { const tmp = from; from = to; to = tmp; }
    from = Math.max(1, Math.min(allItems.length, from));
    to = Math.max(1, Math.min(allItems.length, to));
    return allItems.slice(from - 1, to);
  }
  return allItems;
}

// Перехватываем collectRequest для подстановки текущей строки в предпросмотр и диапазона в печать/сохранение
const _origCollectRequest = collectRequest;
collectRequest = function(forPreview = false) {
  const req = _origCollectRequest();
  if (mode === 'series' || mode === 'tpl') {
    const all = req.items || [];
    if (!all.length) return req;
    if (forPreview) {
      const idx = Math.max(0, Math.min(all.length - 1, currentPreviewRow - 1));
      req.items = [all[idx]];
    } else {
      req.items = getSelectedRangeItems(all);
    }
  }
  return req;
};

// Переназначаем doPreview, чтобы передавать флаг forPreview = true и показывать номер строки
doPreview = async function() {
  syncListNavUI();
  const req = collectRequest(true);
  if (!req.items.length || !String(req.items[0] || '').trim()) {
    alert('Введите текст этикетки');
    return;
  }
  try {
    const r = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || 'не удалось построить макет');
    }
    const blob = await r.blob();
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = URL.createObjectURL(blob);

    const img = $('preview');
    img.src = previewURL;
    img.classList.add('ready');

    const px = await imageSize(previewURL);
    const total = activeListLines().length;
    const rowNote = (mode === 'series' || mode === 'tpl') && total > 0
      ? ` · строка ${currentPreviewRow} из ${total}`
      : '';
    $('preview-info').textContent =
      `${px.w}×${px.h} точек · ${(px.w / 8).toFixed(1)}×${(px.h / 8).toFixed(1)} мм` + rowNote;
  } catch (e) {
    alert(e.message);
  }
};

// Переназначаем сохранение в файл: для списков сохраняет все выбранные в диапазоне этикетки
if ($('save-file-btn')) {
  $('save-file-btn').onclick = async () => {
    const req = collectRequest(false);
    if (!req.items.length || !String(req.items[0] || '').trim()) {
      alert('Сначала заполните данные этикетки');
      return;
    }
    if (req.items.length > 1 && !confirm(`Сохранить ${req.items.length} PNG-файлов по выбранному диапазону?`)) {
      return;
    }
    for (let i = 0; i < req.items.length; i++) {
      const singleReq = { ...req, items: [req.items[i]] };
      try {
        const r = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(singleReq),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || 'не удалось построить макет');
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        let fname = buildDownloadName(singleReq);
        if (req.items.length > 1 && !($('cfg-autoname')?.checked)) {
          fname = fname.replace(/\.png$/i, `_${i + 1}.png`);
        }
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (req.items.length > 1) await new Promise((res) => setTimeout(res, 150));
      } catch (e) {
        alert(e.message);
        break;
      }
    }
  };
}

// События навигации, кнопки "Очистить" и режима диапазона
if ($('series-clear-btn')) {
  $('series-clear-btn').onclick = () => {
    if ($('series-text')) $('series-text').value = '';
    if ($('csv-cols')) $('csv-cols').textContent = '';
    currentPreviewRow = 1;
    updateSeriesCount();
    syncListNavUI();
  };
}

if ($('nav-prev')) {
  $('nav-prev').onclick = () => {
    const total = activeListLines().length;
    if (!total) return;
    currentPreviewRow = currentPreviewRow > 1 ? currentPreviewRow - 1 : total;
    syncListNavUI();
    doPreview();
  };
}

if ($('nav-next')) {
  $('nav-next').onclick = () => {
    const total = activeListLines().length;
    if (!total) return;
    currentPreviewRow = currentPreviewRow < total ? currentPreviewRow + 1 : 1;
    syncListNavUI();
    doPreview();
  };
}

if ($('nav-idx')) {
  $('nav-idx').addEventListener('change', () => {
    const total = activeListLines().length;
    if (!total) return;
    const v = parseInt($('nav-idx').value, 10) || 1;
    currentPreviewRow = Math.max(1, Math.min(total, v));
    syncListNavUI();
    doPreview();
  });
}

if ($('range-mode')) {
  $('range-mode').addEventListener('change', () => {
    if ($('range-custom-wrap')) {
      $('range-custom-wrap').classList.toggle('hidden', $('range-mode').value !== 'custom');
    }
  });
}

if ($('series-text')) $('series-text').addEventListener('input', syncListNavUI);
if ($('tpl-print-items')) $('tpl-print-items').addEventListener('input', syncListNavUI);
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setTimeout(syncListNavUI, 0));
});
syncListNavUI();
if ($('preview-btn')) $('preview-btn').onclick = () => doPreview();

// Прямое сохранение PNG-макетов на диск в папку saveDir через POST /api/save-preview
if ($('save-file-btn')) {
  $('save-file-btn').onclick = async () => {
    const req = collectRequest(false);
    if (!req.items.length || !String(req.items || '').trim()) {
      alert('Сначала заполните данные этикетки');
      return;
    }
    $('save-file-btn').disabled = true;
    try {
      const r = await fetch('/api/save-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(d.error || 'не удалось сохранить файлы');
      }
      const msg = d.count === 1
        ? `Файл сохранён:\n${d.files}`
        : `Сохранено файлов: ${d.count}\nПапка: ${d.dir}`;
      if ($('preview-info')) {
        $('preview-info').textContent = d.count === 1
          ? `сохранено: ${d.files}`
          : `сохранено ${d.count} шт. в ${d.dir}`;
      }
      alert(msg);
    } catch (e) {
      alert(e.message);
    } finally {
      $('save-file-btn').disabled = false;
    }
  };
}

// ==========================================================================
// Загрузка CSV, очистка и порядок столбцов для вкладки "По шаблону"
// ==========================================================================
function updateTplSeriesCount() {
  const inp = $('tpl-print-items');
  const cnt = $('tpl-series-count');
  if (!inp || !cnt) return;
  const n = inp.value.split('\n').map((s) => s.trim()).filter(Boolean).length;
  cnt.textContent = `${n} ${plural(n, 'этикетка', 'этикетки', 'этикеток')}`;
}

function reorderRowColumns(line, colOrderRaw) {
  const raw = String(colOrderRaw || '').trim();
  if (!raw) return line;
  const nums = raw.split(/[^0-9]+/).filter(Boolean).map((n) => parseInt(n, 10));
  if (!nums.length) return line;
  const cols = parseCsvLine(line);
  return nums.map((idx) => (idx >= 1 && idx <= cols.length ? cols[idx - 1] : '')).join(';');
}

// Перехватываем collectRequest для применения "Порядок столбцов на этикетке" в режиме tpl
const _prevCollectRequestTpl = collectRequest;
collectRequest = function(forPreview = false) {
  const req = _prevCollectRequestTpl(forPreview);
  if (mode === 'tpl' && Array.isArray(req.items)) {
    const orderVal = $('tpl-colorder') ? $('tpl-colorder').value : '';
    if (orderVal.trim()) {
      req.items = req.items.map((line) => reorderRowColumns(line, orderVal));
    }
  }
  return req;
};

if ($('tpl-print-items')) {
  $('tpl-print-items').addEventListener('input', () => {
    updateTplSeriesCount();
    syncListNavUI();
  });
  updateTplSeriesCount();
}

if ($('tpl-clear-btn')) {
  $('tpl-clear-btn').onclick = () => {
    if ($('tpl-print-items')) $('tpl-print-items').value = '';
    if ($('tpl-csv-cols')) $('tpl-csv-cols').textContent = '';
    currentPreviewRow = 1;
    updateTplSeriesCount();
    syncListNavUI();
  };
}

if ($('tpl-csv-btn') && $('tpl-csv-file')) {
  $('tpl-csv-btn').onclick = () => $('tpl-csv-file').click();
  $('tpl-csv-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files;
    if (!file) return;
    const text = await file.text();
    let rows = text.split(/\r?\n/)
      .map(parseCsvLine)
      .filter((cols) => cols.some((c) => c.length > 0));
    if ($('tpl-csv-header')?.checked && rows.length > 1) rows = rows.slice(1);

    const width = rows.reduce((m, cols) => Math.max(m, cols.length), 0);
    if ($('tpl-csv-cols')) {
      $('tpl-csv-cols').textContent = width
        ? `в данных ${width} ${plural(width, 'столбец', 'столбца', 'столбцов')}`
        : '';
    }
    if ($('tpl-print-items')) {
      $('tpl-print-items').value = rows.map((cols) => cols.join(';')).join('\n');
    }
    currentPreviewRow = 1;
    updateTplSeriesCount();
    syncListNavUI();
    e.target.value = '';
  });
}

let loadedIndexTemplate = null;

function formatTemplateBadge(t) {
  const parts = [];
  if (t.hasDesigner || (t.elements && t.elements.length > 0)) parts.push('Дизайн');
  if (t.hasSingle) parts.push('Одиночная');
  if (t.hasSystem || t.system) parts.push('Системные');
  return parts.length ? `${t.name} [${parts.join(' + ')}]` : t.name;
}

function collectSystemSection() {
  return {
    ...currentConfig,
    address: $('address') ? $('address').value.trim() : '',
    length: parseFloat($('length')?.value) || 50,
    height: parseFloat($('cfg-height')?.value) || 14,
    density: parseInt($('density')?.value, 10) || 2,
    label: $('label') ? $('label').value : '',
    copies: parseInt($('copies')?.value, 10) || 1,
    flip: $('flip') ? $('flip').checked : false,
    threshold: intVal('threshold', 200),
    keepAlive: $('cfg-keepalive') ? ($('cfg-keepalive').value === 'true') : true,
    printMode: $('cfg-printmode') ? $('cfg-printmode').value : 'fast',
    logLevel: $('cfg-loglevel') ? $('cfg-loglevel').value : 'info',
    saveDir: $('cfg-savedir') ? $('cfg-savedir').value.trim() : '',
    saveFile: $('cfg-savefile') ? ($('cfg-savefile').value.trim() || 'niimbot_label_preview.png') : 'niimbot_label_preview.png',
    autoFileName: $('cfg-autoname') ? $('cfg-autoname').checked : false,
    imgStretch: $('img-stretch') ? $('img-stretch').checked : false,
    watchDir: $('cfg-watchdir') ? $('cfg-watchdir').value.trim() : ''
  };
}

function applySystemSection(sys) {
  if (!sys) return;
  if (sys.address !== undefined && $('address')) $('address').value = sys.address;
  if (sys.length > 0 && $('length')) $('length').value = sys.length;
  if (sys.height > 0 && $('cfg-height')) $('cfg-height').value = sys.height;
  if (sys.density >= 1 && sys.density <= 3 && $('density')) $('density').value = sys.density;
  if (sys.label !== undefined && $('label')) $('label').value = sys.label;
  if (sys.copies > 0 && $('copies')) $('copies').value = sys.copies;
  if ($('flip')) $('flip').checked = !!sys.flip;
  if (sys.threshold >= 1 && sys.threshold <= 255 && $('threshold')) $('threshold').value = sys.threshold;
  if ($('cfg-keepalive') && sys.keepAlive !== undefined) {
    $('cfg-keepalive').value = String(!!sys.keepAlive);
    if (typeof updateModeButton === 'function') updateModeButton(!!sys.keepAlive);
  }
  if (sys.printMode && $('cfg-printmode')) $('cfg-printmode').value = sys.printMode;
  if (sys.logLevel && $('cfg-loglevel')) $('cfg-loglevel').value = sys.logLevel;
  if (sys.saveDir !== undefined && $('cfg-savedir')) $('cfg-savedir').value = sys.saveDir;
  if (sys.saveFile && $('cfg-savefile')) $('cfg-savefile').value = sys.saveFile;
  if ($('cfg-autoname') && sys.autoFileName !== undefined) $('cfg-autoname').checked = !!sys.autoFileName;
  if ($('img-stretch') && sys.imgStretch !== undefined) $('img-stretch').checked = !!sys.imgStretch;
  if (sys.watchDir !== undefined && $('cfg-watchdir')) $('cfg-watchdir').value = sys.watchDir;
}

function applyCombinedTemplate(t) {
  loadedIndexTemplate = t;
  if (t.hasSystem && t.system) {
    applySystemSection(t.system);
  } else {
    if (t.length > 0 && $('length')) $('length').value = t.length;
    if (t.density >= 1 && t.density <= 3 && $('density')) $('density').value = t.density;
    if (t.label !== undefined && $('label')) $('label').value = t.label;
    if (t.copies > 0 && $('copies')) $('copies').value = t.copies;
    if (t.threshold >= 1 && t.threshold <= 255 && $('threshold')) $('threshold').value = t.threshold;
    if ($('flip')) $('flip').checked = !!t.flip;
  }
  if (t.hasSingle) {
    if (t.bcFormat && $('cfg-bcformat')) $('cfg-bcformat').value = t.bcFormat;
    if (t.gapPx !== undefined && $('cfg-gap')) $('cfg-gap').value = t.gapPx;
    if (t.textGapPx !== undefined && $('cfg-textgap')) $('cfg-textgap').value = t.textGapPx;
    if (t.fontName !== undefined && $('cfg-fontname')) $('cfg-fontname').value = t.fontName;
    if (t.fontSize !== undefined && $('cfg-fontsize')) $('cfg-fontsize').value = t.fontSize || '-1';
    if ($('cfg-bold')) $('cfg-bold').checked = !!t.bold;
    if (t.marginPx !== undefined && $('cfg-margin')) $('cfg-margin').value = t.marginPx;
    if (t.sideMarginPx !== undefined && $('cfg-sidemargin')) $('cfg-sidemargin').value = t.sideMarginPx;
    if (t.offsetPx !== undefined && $('cfg-offset')) $('cfg-offset').value = t.offsetPx;
    if (t.bcData !== undefined && $('bc-data')) { $('bc-data').value = t.bcData; if (typeof updateBcLenHint === 'function') updateBcLenHint(); }
    if (t.topText !== undefined && $('bc-top')) $('bc-top').value = t.topText;
    if (t.bottomText !== undefined && $('bc-bot')) $('bc-bot').value = t.bottomText;
    if (t.singleText !== undefined && $('single-text')) $('single-text').value = t.singleText;
    if ($('csv-header')) $('csv-header').checked = !!t.csvHeader;
    if (t.colorder !== undefined && $('colorder')) $('colorder').value = t.colorder;
    if (t.template !== undefined && $('template')) $('template').value = t.template;
  }
  const hasDes = !!(t.hasDesigner || (t.elements && t.elements.length > 0));
  if ($('tpl-inc-designer')) { $('tpl-inc-designer').checked = hasDes; $('tpl-inc-designer').disabled = true; }
  if ($('tpl-inc-single')) $('tpl-inc-single').checked = !!t.hasSingle;
  if ($('tpl-inc-system')) $('tpl-inc-system').checked = !!t.hasSystem;
  if (hasDes) {
    selectedDesignTpl = t;
    if ($('tpl-print-select')) $('tpl-print-select').value = t.name;
    if ($('tpl-print-info')) $('tpl-print-info').textContent = `Шаблон «${t.name}»: длина ${t.length || 50} мм, элементов: ${(t.elements || []).length}`;
  }
  if ($('tpl-idx-hint')) $('tpl-idx-hint').textContent = `Загружен: ${formatTemplateBadge(t)}`;
}
loadTemplates = async function() {
  try {
    const r = await fetch('/api/templates');
    const list = (await r.json()) || [];
    const sel = $('templates');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— выберите —</option>';
    list.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.name; o.textContent = formatTemplateBadge(t); o.dataset.tpl = JSON.stringify(t);
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
  } catch (e) {}
};

if ($('templates')) {
  $('templates').onchange = (e) => {
    const opt = e.target.selectedOptions && e.target.selectedOptions[0];
    if (!opt || !opt.dataset.tpl) {
      loadedIndexTemplate = null;
      if ($('tpl-inc-designer')) { $('tpl-inc-designer').checked = false; $('tpl-inc-designer').disabled = true; }
      if ($('tpl-idx-hint')) $('tpl-idx-hint').textContent = '';
      return;
    }
    applyCombinedTemplate(JSON.parse(opt.dataset.tpl));
  };
}

if ($('tpl-save')) {
  $('tpl-save').onclick = async () => {
    const incSingle = $('tpl-inc-single')?.checked;
    const incSystem = $('tpl-inc-system')?.checked;
    const incDesigner = $('tpl-inc-designer')?.checked;
    if (!incSingle && !incSystem && !incDesigner) { alert('Отметьте хотя бы одну секцию для сохранения'); return; }

    const defName = $('templates')?.value || (loadedIndexTemplate ? loadedIndexTemplate.name : '');
    const name = prompt('Название шаблона:', defName);
    if (!name || !name.trim()) return;
    const cleanName = name.trim();

    const tplObj = {
      name: cleanName, hasSingle: !!incSingle, hasSystem: !!incSystem, hasDesigner: !!incDesigner,
      length: parseFloat($('length')?.value) || 50, density: parseInt($('density')?.value, 10) || 2,
      label: $('label')?.value || '', copies: parseInt($('copies')?.value, 10) || 1,
      flip: !!$('flip')?.checked, threshold: intVal('threshold', 200)
    };
    if (incSingle) {
      Object.assign(tplObj, {
        bcFormat: $('cfg-bcformat')?.value || 'auto', gapPx: intVal('cfg-gap', 4), textGapPx: intVal('cfg-textgap', 4),
        fontName: $('cfg-fontname')?.value || '', fontSize: $('cfg-fontsize')?.value.trim() || '-1',
        bold: !!$('cfg-bold')?.checked, marginPx: intVal('cfg-margin', 4), sideMarginPx: intVal('cfg-sidemargin', 10),
        offsetPx: intVal('cfg-offset', 0), bcData: $('bc-data')?.value || '', topText: $('bc-top')?.value || '',
        bottomText: $('bc-bot')?.value || '', singleText: $('single-text')?.value || '',
        csvHeader: !!$('csv-header')?.checked, colorder: $('colorder')?.value || '', template: $('template')?.value || ''
      });
    }
    if (incSystem) tplObj.system = collectSystemSection();
        let existingByName = null;
    if ($('templates')) {
      [...$('templates').options].forEach((o) => {
        if (o.value === cleanName && o.dataset.tpl) {
          try { existingByName = JSON.parse(o.dataset.tpl); } catch (e) {}
        }
      });
    }
    const sourceDes = (loadedIndexTemplate && loadedIndexTemplate.elements) ? loadedIndexTemplate : existingByName;
    if ((incDesigner || (sourceDes && sourceDes.hasDesigner)) && sourceDes && Array.isArray(sourceDes.elements)) {
      tplObj.hasDesigner = true;
      tplObj.elements = sourceDes.elements;
    }

    const r = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tplObj) });
    if (!r.ok) { alert('Не удалось сохранить шаблон'); return; }
    await loadTemplates();
    if (typeof loadTplTabList === 'function') await loadTplTabList();
    if ($('templates')) $('templates').value = cleanName;
    loadedIndexTemplate = tplObj;
    if ($('tpl-idx-hint')) $('tpl-idx-hint').textContent = `Сохранено: ${formatTemplateBadge(tplObj)}`;
  };
}

if ($('tpl-idx-export')) {
  $('tpl-idx-export').onclick = () => {
    const opt = $('templates')?.selectedOptions && $('templates').selectedOptions[0];
    if (!opt || !opt.dataset.tpl) { alert('Выберите шаблон для экспорта'); return; }
    const t = JSON.parse(opt.dataset.tpl);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }));
    a.download = ((t.name || 'template').replace(/[\\/:*?"<>|\s]+/g, '_') || 'template') + '.niimbot.json';
    a.click();
  };
}

if ($('tpl-idx-import') && $('tpl-idx-file')) {
  $('tpl-idx-import').onclick = () => $('tpl-idx-file').click();
  $('tpl-idx-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files;
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const t = Array.isArray(parsed) ? parsed : parsed;
      if (!t.name) t.name = f.name.replace(/\.niimbot\.json$|\.json$/i, '');
      await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) });
      await loadTemplates();
      if (typeof loadTplTabList === 'function') await loadTplTabList();
      if ($('templates')) $('templates').value = t.name;
      applyCombinedTemplate(t);
    } catch (err) { alert('Ошибка импорта: ' + err.message); }
    e.target.value = '';
  });
}

loadTemplates();
