// TKK Bannerbuilder — single-file vanilla JS.
// Sections: state | upload | normalize | render | export | UI wiring.

// ---------- STATE ----------

const state = {
  mode: 'banner',
  logos: [],
  config: {
    cellW: 800,
    cellH: 800,
    paddingPct: 10,
    bgColor: 'transparent',
    cols: 10,
    gap: 0,
    colorMode: 'grayscale',
    tint: { color: '#1B6EF3' },
    opticalCenter: false,
  },
};

const ALPHA_THRESHOLD = 10;
const WHITE_SUM_THRESHOLD = 720;
const BG_FEATHER = 18;

// ---------- UPLOAD ----------

function readFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  return Promise.all(files.map(loadImageFromFile));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ name: file.name, img });
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  const loaded = await readFiles(fileList);
  for (const { name, img } of loaded) {
    const result = normalizeLogo(img, null);
    state.logos.push({
      id: 'l_' + Math.random().toString(36).slice(2, 9),
      name,
      sourceImage: img,
      trimmedCanvas: result.canvas,
      inkPixels: result.inkPixels,
      centroid: result.centroid,
      scale: 1.0,
      bgRemoval: null,
      _renderCache: null,
      _renderCacheKey: null,
    });
  }
  if (state.mode === 'single' && state.logos.length > 1) {
    state.logos = state.logos.slice(-1);
  }
  refreshAll();
}

// ---------- NORMALIZE (grayscale + trim + soft bg removal) ----------

function normalizeLogo(img, bgRemoval) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const max = Math.max(w, h);
  const targetMax = 1600;
  const ratio = max > targetMax ? targetMax / max : 1;
  const sw = Math.round(w * ratio);
  const sh = Math.round(h * ratio);

  const cv = document.createElement('canvas');
  cv.width = sw;
  cv.height = sh;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, sw, sh);

  const imageData = ctx.getImageData(0, 0, sw, sh);
  const data = imageData.data;

  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) { hasAlpha = true; break; }
  }

  if (!hasAlpha) {
    for (let i = 0; i < data.length; i += 4) {
      const sum = data[i] + data[i+1] + data[i+2];
      if (sum > WHITE_SUM_THRESHOLD) {
        data[i+3] = 0;
      } else if (sum > WHITE_SUM_THRESHOLD - 60) {
        data[i+3] = Math.round(((WHITE_SUM_THRESHOLD - sum) / 60) * 255);
      }
    }
  }

  if (bgRemoval && bgRemoval.sampleRGB) {
    const [tr, tg, tb] = bgRemoval.sampleRGB;
    const tol = bgRemoval.tolerance;
    const tolSq = tol * tol;
    const featherSq = (tol + BG_FEATHER) * (tol + BG_FEATHER);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const dr = data[i] - tr;
      const dg = data[i + 1] - tg;
      const db = data[i + 2] - tb;
      const dSq = dr * dr + dg * dg + db * db;
      if (dSq <= tolSq) {
        data[i + 3] = 0;
      } else if (dSq < featherSq) {
        const d = Math.sqrt(dSq);
        const t = (d - tol) / BG_FEATHER;
        data[i + 3] = Math.round(data[i + 3] * t);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const bounds = findContentBounds(ctx, sw, sh);
  if (!bounds) {
    return { canvas: cv, inkPixels: 0, centroid: { x: cv.width / 2, y: cv.height / 2 } };
  }

  const trimmed = document.createElement('canvas');
  trimmed.width = bounds.w;
  trimmed.height = bounds.h;
  const tctx = trimmed.getContext('2d');
  tctx.drawImage(cv, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);

  const stats = computeInkStats(trimmed);
  return { canvas: trimmed, inkPixels: stats.inkPixels, centroid: stats.centroid };
}

function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function computeInkStats(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, w, h).data;
  let inkPixels = 0;
  let sumX = 0;
  let sumY = 0;
  let sumWeight = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a > ALPHA_THRESHOLD) {
        const lum = luminance(data[i], data[i + 1], data[i + 2]);
        const darkness = (255 - lum) / 255;
        const weight = (a / 255) * darkness;
        inkPixels += a / 255;
        sumX += x * weight;
        sumY += y * weight;
        sumWeight += weight;
      }
    }
  }
  if (sumWeight === 0) {
    return { inkPixels: 0, centroid: { x: w / 2, y: h / 2 } };
  }
  return {
    inkPixels: Math.round(inkPixels),
    centroid: { x: sumX / sumWeight, y: sumY / sumWeight },
  };
}

function sampleCornerColor(img) {
  const cv = document.createElement('canvas');
  const sw = Math.min(img.naturalWidth, 200);
  const sh = Math.round(img.naturalHeight * (sw / img.naturalWidth));
  cv.width = sw;
  cv.height = sh;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  const corners = [
    [0, 0], [sw - 1, 0], [0, sh - 1], [sw - 1, sh - 1],
  ];
  let r = 0, g = 0, b = 0, n = 0;
  for (const [x, y] of corners) {
    const i = (y * sw + x) * 4;
    if (data[i + 3] > 200) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function reNormalizeLogo(logo) {
  const result = normalizeLogo(logo.sourceImage, logo.bgRemoval);
  logo.trimmedCanvas = result.canvas;
  logo.inkPixels = result.inkPixels;
  logo.centroid = result.centroid;
  logo._renderCache = null;
  logo._renderCacheKey = null;
}

function applyGrayscale(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.05)';
  ctx.drawImage(src, 0, 0);
  return cv;
}

function applyTint(src, hex) {
  const w = src.width;
  const h = src.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const lum = luminance(data[i], data[i + 1], data[i + 2]);
    const darkness = (255 - lum) / 255;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.round(data[i + 3] * darkness);
  }
  ctx.putImageData(imageData, 0, 0);
  return cv;
}

function getRenderCanvas(logo) {
  const mode = state.config.colorMode;
  if (mode === 'original') return logo.trimmedCanvas;

  const key = mode === 'grayscale' ? 'gray' : 'tint:' + state.config.tint.color;
  if (logo._renderCache && logo._renderCacheKey === key) {
    return logo._renderCache;
  }
  logo._renderCache = mode === 'grayscale'
    ? applyGrayscale(logo.trimmedCanvas)
    : applyTint(logo.trimmedCanvas, state.config.tint.color);
  logo._renderCacheKey = key;
  return logo._renderCache;
}

function invalidateRenderCache() {
  state.logos.forEach(l => {
    l._renderCache = null;
    l._renderCacheKey = null;
  });
}

function autoBalanceInkArea() {
  if (state.logos.length < 2) return;
  const { cellW, cellH, paddingPct } = state.config;
  const innerW = cellW - 2 * (cellW * paddingPct / 100);
  const innerH = cellH - 2 * (cellH * paddingPct / 100);

  const renderedAreas = state.logos.map(logo => {
    const lw = logo.trimmedCanvas.width;
    const lh = logo.trimmedCanvas.height;
    if (lw === 0 || lh === 0 || logo.inkPixels === 0) return 0;
    const fitScale = Math.min(innerW / lw, innerH / lh);
    return logo.inkPixels * fitScale * fitScale;
  });

  const positive = renderedAreas.filter(a => a > 0).sort((a, b) => a - b);
  if (positive.length === 0) return;
  const target = positive[Math.floor(positive.length / 2)];

  state.logos.forEach((logo, i) => {
    if (renderedAreas[i] <= 0) return;
    const ratio = Math.sqrt(target / renderedAreas[i]);
    logo.scale = Math.max(0.5, Math.min(1.5, ratio));
  });

  refreshAll();
}

function findContentBounds(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

// ---------- RENDER ----------

function fillCellBackground(ctx, x, y, w, h, bgColor) {
  if (bgColor === 'transparent') return;
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);
}

function drawLogoInCell(ctx, logo, cx, cy, cw, ch, paddingPct) {
  const padX = (cw * paddingPct) / 100;
  const padY = (ch * paddingPct) / 100;
  const innerW = cw - 2 * padX;
  const innerH = ch - 2 * padY;
  const src = getRenderCanvas(logo);
  const lw = src.width;
  const lh = src.height;
  if (lw === 0 || lh === 0) return;
  const fitScale = Math.min(innerW / lw, innerH / lh);
  const drawW = lw * fitScale * logo.scale;
  const drawH = lh * fitScale * logo.scale;

  let dx, dy;
  if (state.config.opticalCenter && logo.centroid) {
    const scale = fitScale * logo.scale;
    dx = cx + cw / 2 - logo.centroid.x * scale;
    dy = cy + ch / 2 - logo.centroid.y * scale;
  } else {
    dx = cx + (cw - drawW) / 2;
    dy = cy + (ch - drawH) / 2;
  }
  ctx.drawImage(src, dx, dy, drawW, drawH);
}

function renderSingle() {
  if (state.logos.length === 0) return null;
  const { cellW, cellH, paddingPct, bgColor } = state.config;
  const cv = document.createElement('canvas');
  cv.width = cellW;
  cv.height = cellH;
  const ctx = cv.getContext('2d');
  fillCellBackground(ctx, 0, 0, cellW, cellH, bgColor);
  drawLogoInCell(ctx, state.logos[0], 0, 0, cellW, cellH, paddingPct);
  return cv;
}

function renderBanner() {
  if (state.logos.length === 0) return null;
  const { cellW, cellH, paddingPct, bgColor, cols, gap } = state.config;
  const n = state.logos.length;
  const realCols = Math.min(cols, n);
  const rows = Math.ceil(n / realCols);

  const totalW = realCols * cellW + (realCols - 1) * gap;
  const totalH = rows * cellH + (rows - 1) * gap;

  const cv = document.createElement('canvas');
  cv.width = totalW;
  cv.height = totalH;
  const ctx = cv.getContext('2d');

  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, totalW, totalH);
  }

  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / realCols);
    const c = i % realCols;
    const cx = c * (cellW + gap);
    const cy = r * (cellH + gap);
    drawLogoInCell(ctx, state.logos[i], cx, cy, cellW, cellH, paddingPct);
  }

  return cv;
}

// ---------- EXPORT ----------

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function exportCurrent() {
  const cv = state.mode === 'single' ? renderSingle() : renderBanner();
  if (!cv) return;
  const ts = new Date().toISOString().slice(0, 10);
  const name = state.mode === 'single'
    ? `bannerbuilder-logo-${ts}.png`
    : `bannerbuilder-banner-${state.logos.length}-${ts}.png`;
  downloadCanvas(cv, name);
}

// ---------- UI WIRING ----------

const el = {
  fileInput: document.getElementById('file-input'),
  dropzone: document.getElementById('dropzone'),
  dropzoneTitle: document.getElementById('dropzone-title'),
  dropzoneSub: document.getElementById('dropzone-sub'),
  logoList: document.getElementById('logo-list'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  cellSize: document.getElementById('cell-size'),
  customSizeRow: document.getElementById('custom-size-row'),
  cellW: document.getElementById('cell-w'),
  cellH: document.getElementById('cell-h'),
  padding: document.getElementById('padding'),
  paddingVal: document.getElementById('padding-val'),
  bgBtns: document.querySelectorAll('.bg-btn'),
  bgCustom: document.getElementById('bg-custom'),
  cols: document.getElementById('cols'),
  colsVal: document.getElementById('cols-val'),
  gap: document.getElementById('gap'),
  gapVal: document.getElementById('gap-val'),
  bannerStep: document.getElementById('banner-step'),
  exportNum: document.getElementById('export-num'),
  downloadBtn: document.getElementById('download-btn'),
  exportHint: document.getElementById('export-hint'),
  previewLabel: document.getElementById('preview-label'),
  previewDim: document.getElementById('preview-dim'),
  previewStage: document.getElementById('preview-stage'),
  previewCanvas: document.getElementById('preview-canvas'),
  gridMeta: document.getElementById('grid-meta'),
  tintBtns: document.querySelectorAll('.tint-btn'),
  tintColor: document.getElementById('tint-color'),
  opticalCenter: document.getElementById('optical-center'),
  autoBalanceBtn: document.getElementById('auto-balance-btn'),
  logoToolbar: document.getElementById('logo-toolbar'),
};

function setMode(mode) {
  state.mode = mode;
  el.modeBtns.forEach(btn => btn.classList.toggle('is-active', btn.dataset.mode === mode));
  el.bannerStep.hidden = mode !== 'banner';
  el.exportNum.textContent = mode === 'banner' ? '4' : '3';
  el.fileInput.multiple = mode === 'banner';
  el.dropzoneTitle.textContent = mode === 'banner' ? 'Sleep logos hier' : 'Sleep logo hier';
  el.dropzoneSub.textContent = mode === 'banner'
    ? 'of klik om meerdere te kiezen (PNG, JPG, SVG)'
    : 'of klik om te kiezen (PNG, JPG, SVG)';
  if (mode === 'single' && state.logos.length > 1) {
    state.logos = state.logos.slice(0, 1);
  }
  refreshAll();
}

function renderLogoList() {
  el.logoList.innerHTML = '';
  for (let i = 0; i < state.logos.length; i++) {
    const logo = state.logos[i];
    const li = document.createElement('li');
    li.className = 'logo-item';
    li.innerHTML = `
      <div class="logo-thumb"></div>
      <div class="logo-meta">
        <span class="logo-name" title="${escapeHtml(logo.name)}">${escapeHtml(logo.name)}</span>
        <div class="logo-scale">
          <span>Scale</span>
          <input type="range" min="50" max="150" value="${Math.round(logo.scale * 100)}" data-id="${logo.id}">
          <span data-scale-val="${logo.id}">${Math.round(logo.scale * 100)}%</span>
        </div>
      </div>
      <div class="logo-controls">
        <button class="icon-btn ${logo.bgRemoval ? 'is-active' : ''}" data-action="bg" data-id="${logo.id}" title="Achtergrond verwijderen (kleur-sample)">bg</button>
        ${state.mode === 'banner' ? `
          <button class="icon-btn" data-action="up" data-id="${logo.id}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
          <button class="icon-btn" data-action="down" data-id="${logo.id}" ${i === state.logos.length - 1 ? 'disabled' : ''}>&darr;</button>
        ` : ''}
        <button class="icon-btn" data-action="remove" data-id="${logo.id}">x</button>
      </div>
    `;
    const thumbBox = li.querySelector('.logo-thumb');
    const thumb = document.createElement('canvas');
    thumb.width = 36;
    thumb.height = 36;
    const tctx = thumb.getContext('2d');
    const src = getRenderCanvas(logo);
    const lw = src.width;
    const lh = src.height;
    const s = Math.min(36 / lw, 36 / lh);
    const dw = lw * s;
    const dh = lh * s;
    tctx.drawImage(src, (36 - dw) / 2, (36 - dh) / 2, dw, dh);
    thumbBox.appendChild(thumb);

    if (logo.bgRemoval) {
      const bgRow = document.createElement('div');
      bgRow.className = 'logo-bg-row';
      bgRow.innerHTML = `
        <span class="bg-row-label">BG-tolerantie</span>
        <input type="range" min="5" max="120" value="${logo.bgRemoval.tolerance}" data-bg-tol="${logo.id}">
        <span class="value-tag" data-bg-tol-val="${logo.id}">${logo.bgRemoval.tolerance}</span>
      `;
      li.appendChild(bgRow);
    }

    el.logoList.appendChild(li);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function refreshPreview() {
  const cv = state.mode === 'single' ? renderSingle() : renderBanner();
  const emptyEl = el.previewStage.querySelector('.empty-state');

  if (!cv) {
    el.previewCanvas.hidden = true;
    if (emptyEl) emptyEl.style.display = '';
    el.previewDim.textContent = '';
    el.downloadBtn.disabled = true;
    el.exportHint.textContent = state.mode === 'single'
      ? 'Upload eerst een logo'
      : 'Upload eerst logos';
    el.previewLabel.textContent = state.mode === 'single' ? 'Preview' : 'Banner preview';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  const pcv = el.previewCanvas;
  pcv.hidden = false;
  pcv.width = cv.width;
  pcv.height = cv.height;
  const pctx = pcv.getContext('2d');
  pctx.clearRect(0, 0, cv.width, cv.height);
  pctx.drawImage(cv, 0, 0);

  el.previewDim.textContent = `${cv.width} x ${cv.height} px`;
  el.previewLabel.textContent = state.mode === 'single' ? 'Logo preview' : 'Banner preview';
  el.downloadBtn.disabled = false;
  el.exportHint.textContent = 'Achtergrond-ruit is enkel preview, niet onderdeel van export';

  if (state.mode === 'banner') {
    const n = state.logos.length;
    const realCols = Math.min(state.config.cols, n);
    const rows = Math.ceil(n / realCols);
    el.gridMeta.textContent = `${realCols} kol x ${rows} rij = ${n} cellen`;
  }
}

function refreshToolbar() {
  const show = state.mode === 'banner' && state.logos.length >= 2;
  el.logoToolbar.hidden = !show;
}

function refreshAll() {
  renderLogoList();
  refreshToolbar();
  refreshPreview();
}

el.modeBtns.forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

el.fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) addFiles(e.target.files);
  e.target.value = '';
});

el.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropzone.classList.add('is-drag');
});
el.dropzone.addEventListener('dragleave', () => {
  el.dropzone.classList.remove('is-drag');
});
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('is-drag');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

el.cellSize.addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'custom') {
    el.customSizeRow.hidden = false;
    state.config.cellW = parseInt(el.cellW.value) || 800;
    state.config.cellH = parseInt(el.cellH.value) || 800;
  } else {
    el.customSizeRow.hidden = true;
    const n = parseInt(v);
    state.config.cellW = n;
    state.config.cellH = n;
  }
  refreshPreview();
});

el.cellW.addEventListener('input', () => {
  state.config.cellW = parseInt(el.cellW.value) || 800;
  refreshPreview();
});
el.cellH.addEventListener('input', () => {
  state.config.cellH = parseInt(el.cellH.value) || 800;
  refreshPreview();
});

el.padding.addEventListener('input', () => {
  state.config.paddingPct = parseInt(el.padding.value);
  el.paddingVal.textContent = state.config.paddingPct + '%';
  refreshPreview();
});

el.bgBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (e.target === el.bgCustom) return;
    el.bgBtns.forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    if (btn.dataset.bg === 'custom') {
      state.config.bgColor = el.bgCustom.value;
    } else {
      state.config.bgColor = btn.dataset.bg;
    }
    refreshPreview();
  });
});

el.bgCustom.addEventListener('input', () => {
  el.bgBtns.forEach(b => b.classList.remove('is-active'));
  el.bgBtns.forEach(b => { if (b.dataset.bg === 'custom') b.classList.add('is-active'); });
  state.config.bgColor = el.bgCustom.value;
  refreshPreview();
});

el.cols.addEventListener('input', () => {
  state.config.cols = parseInt(el.cols.value);
  el.colsVal.textContent = state.config.cols;
  refreshPreview();
});

el.gap.addEventListener('input', () => {
  state.config.gap = parseInt(el.gap.value);
  el.gapVal.textContent = state.config.gap + 'px';
  refreshPreview();
});

el.logoList.addEventListener('click', (e) => {
  const btn = e.target.closest('.icon-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const idx = state.logos.findIndex(l => l.id === id);
  if (idx < 0) return;
  const logo = state.logos[idx];
  if (action === 'remove') {
    state.logos.splice(idx, 1);
  } else if (action === 'up' && idx > 0) {
    [state.logos[idx-1], state.logos[idx]] = [state.logos[idx], state.logos[idx-1]];
  } else if (action === 'down' && idx < state.logos.length - 1) {
    [state.logos[idx+1], state.logos[idx]] = [state.logos[idx], state.logos[idx+1]];
  } else if (action === 'bg') {
    if (logo.bgRemoval) {
      logo.bgRemoval = null;
    } else {
      const sample = sampleCornerColor(logo.sourceImage);
      if (!sample) {
        alert('Kon geen achtergrond-kleur uit de hoeken halen. Logo lijkt al transparant.');
        return;
      }
      logo.bgRemoval = { sampleRGB: sample, tolerance: 30 };
    }
    reNormalizeLogo(logo);
  }
  refreshAll();
});

el.logoList.addEventListener('input', (e) => {
  if (e.target.type !== 'range') return;
  const id = e.target.dataset.id || e.target.dataset.bgTol;
  if (!id) return;
  const logo = state.logos.find(l => l.id === id);
  if (!logo) return;
  if (e.target.dataset.bgTol) {
    if (!logo.bgRemoval) return;
    logo.bgRemoval.tolerance = parseInt(e.target.value);
    const valEl = el.logoList.querySelector(`[data-bg-tol-val="${id}"]`);
    if (valEl) valEl.textContent = logo.bgRemoval.tolerance;
    reNormalizeLogo(logo);
    const thumbBox = e.target.closest('.logo-item').querySelector('.logo-thumb');
    thumbBox.innerHTML = '';
    const thumb = document.createElement('canvas');
    thumb.width = 36;
    thumb.height = 36;
    const tctx = thumb.getContext('2d');
    const src = getRenderCanvas(logo);
    const s = Math.min(36 / src.width, 36 / src.height);
    const dw = src.width * s;
    const dh = src.height * s;
    tctx.drawImage(src, (36 - dw) / 2, (36 - dh) / 2, dw, dh);
    thumbBox.appendChild(thumb);
    refreshPreview();
  } else {
    logo.scale = parseInt(e.target.value) / 100;
    const valEl = el.logoList.querySelector(`[data-scale-val="${id}"]`);
    if (valEl) valEl.textContent = Math.round(logo.scale * 100) + '%';
    refreshPreview();
  }
});

el.tintBtns.forEach(btn => {
  btn.addEventListener('click', (e) => {
    if (e.target === el.tintColor) return;
    el.tintBtns.forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const mode = btn.dataset.mode;
    state.config.colorMode = mode;
    if (mode === 'tint') {
      state.config.tint.color = el.tintColor.value;
    }
    invalidateRenderCache();
    refreshAll();
  });
});

el.tintColor.addEventListener('input', () => {
  el.tintBtns.forEach(b => b.classList.remove('is-active'));
  el.tintBtns.forEach(b => { if (b.dataset.mode === 'tint') b.classList.add('is-active'); });
  state.config.colorMode = 'tint';
  state.config.tint.color = el.tintColor.value;
  invalidateRenderCache();
  refreshAll();
});

el.opticalCenter.addEventListener('change', () => {
  state.config.opticalCenter = el.opticalCenter.checked;
  refreshPreview();
});

el.autoBalanceBtn.addEventListener('click', autoBalanceInkArea);

el.downloadBtn.addEventListener('click', exportCurrent);

setMode('banner');
