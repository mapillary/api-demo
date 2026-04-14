/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* ============================================================
   Mapillary API Demo — app.js
   Vanilla JS · MapLibre GL JS 4 · MapillaryJS 4
   ============================================================ */

'use strict';

// ─── Suppress non-fatal MapillaryJS tile-cache errors ─────────────────────────
(function () {
  const _origError = console.error.bind(console);
  console.error = function (...args) {
    const msg = args.length > 0 ? String(args[0]) : '';
    if (
      msg.includes('Failed to cache tile data') ||
      msg.includes('Failed to cache spatial images') ||
      msg.includes('Failed to cache periphery bounding box') ||
      msg.includes('Failed to fetch data') ||
      msg.includes('Param z must be a number') ||
      msg.includes('Service temporarily unavailable') ||
      msg.includes('MLYApiException') ||
      (msg.includes('MapillaryError') && msg.includes('fetch'))
    ) return;
    _origError(...args);
  };
})();

// ─── Constants ────────────────────────────────────────────────────────────────

const TILE_URL           = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token={token}';
// NOTE: computed tile URL intentionally removed — this demo uses original positions only.
const TILE_POINTS_URL    = 'https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}?access_token={token}';
const TILE_SIGNS_URL     = 'https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token={token}';
const STYLE_URL          = 'https://tiles.openfreemap.org/styles/liberty';
const GRAPH_URL          = 'https://graph.mapillary.com';

const SOURCE_ID          = 'mapillary';

const SOURCE_POINTS      = 'mapillary-points';
const SOURCE_SIGNS       = 'mapillary-signs';

const LAYER_OVW          = 'mly-overview';
const LAYER_SEQ          = 'mly-sequences';
const LAYER_IMG          = 'mly-images';

const C_LINE    = '#05CB63';
const C_LINE_HL = '#5debb4';
const C_DOT     = '#05CB63';
const C_DOT_HL  = '#5debb4';

// ─── State ────────────────────────────────────────────────────────────────────

const DEFAULT_TOKEN = 'MLY|26275324248758064|7819d63bee8179a083cdd76e20557967';
let accessToken    = DEFAULT_TOKEN;
let map            = null;
let viewer         = null;
let activeImageId  = null;
let suppressFlyTo      = false;
let lastClickedLngLat  = null;
let coneMarker     = null;
let viewerNavigable = false;
let pendingImageId  = null;

// Layer toggle state
const layerState = { points: false, signs: false };

// Active filters
const activeFilters = {
  startDate: '',
  endDate: '',
  panoOnly: false,
};

// Map event listener registry for cleanup
const mapListeners = [];
function addMapListener(type, layerId, handler) {
  if (layerId) {
    map.on(type, layerId, handler);
    mapListeners.push({ type, layerId, handler });
  } else {
    map.on(type, handler);
    mapListeners.push({ type, handler });
  }
}
function removeAllMapListeners() {
  mapListeners.forEach(({ type, layerId, handler }) => {
    try { if (layerId) map.off(type, layerId, handler); else map.off(type, handler); } catch {}
  });
  mapListeners.length = 0;
}

// Thumbnail cache — capped to prevent unbounded growth
const THUMB_CACHE_MAX = 500;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const tokenInput     = document.getElementById('token-input');
const tokenApplyBtn  = document.getElementById('token-apply-btn');
const tokenGroup     = document.getElementById('token-group');
const tokenToggleBtn = document.getElementById('token-toggle-btn');
const tokenCancelBtn = document.getElementById('token-cancel-btn');
const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const placeholder    = document.getElementById('viewer-placeholder');
const infoBar        = document.getElementById('viewer-info-bar');
const closeBtn       = document.getElementById('viewer-close-btn');
const zoomHint       = document.getElementById('zoom-hint');
const divider        = document.getElementById('divider');
const mapPanel       = document.getElementById('map-panel');
const mainContent    = document.getElementById('main-content');
const viewerTabs     = document.getElementById('viewer-tabs');

// ─── Status helpers ───────────────────────────────────────────────────────────

function setStatus(state, message) {
  statusDot.className = 'dot dot-' + state;
  statusText.textContent = message;
}

// ─── API Console ──────────────────────────────────────────────────────────────

const consoleEl      = document.getElementById('api-console');
const consoleHeader  = document.getElementById('console-header');
const consoleToggle  = document.getElementById('console-toggle-btn');
const consoleClear   = document.getElementById('console-clear-btn');
const consoleEntries = document.getElementById('console-entries');
const consoleEmpty   = document.getElementById('console-empty');
const consoleCount   = document.getElementById('console-call-count');

let callCount = 0;

consoleHeader.addEventListener('click', (e) => {
  if (e.target === consoleClear || e.target === consoleToggle) return;
  toggleConsole();
});
consoleToggle.addEventListener('click', toggleConsole);
consoleClear.addEventListener('click', () => {
  consoleEntries.innerHTML = '';
  callCount = 0;
  consoleCount.textContent = '0 calls';
  consoleEmpty.classList.remove('hidden');
});

function toggleConsole() {
  const expanded = consoleEl.classList.toggle('expanded');
  consoleToggle.textContent = expanded ? '▼' : '▲';
  consoleToggle.setAttribute('aria-expanded', String(expanded));
}

/**
 * Log an API call to the console drawer.
 * Returns a function to call when the response arrives: updateEntry(status, ms, json)
 */
function logApiCall(method, url, surface) {
  consoleEmpty.classList.add('hidden');
  callCount++;
  consoleCount.textContent = callCount + (callCount === 1 ? ' call' : ' calls');

  const entry = document.createElement('div');
  entry.className = 'console-entry';

  const now = new Date();
  const ts  = now.toTimeString().slice(0, 8);

  // Split URL into path and query string for display
  const qIdx = url.indexOf('?');
  const displayPath   = qIdx >= 0 ? url.slice(0, qIdx) : url;
  const displayParams = qIdx >= 0 ? url.slice(qIdx) : '';
  // Shorten the URL for display — strip the base
  const shortPath = displayPath.replace('https://graph.mapillary.com', '').replace('https://tiles.mapillary.com', '') || displayPath;
  // Redact access_token from displayed URL
  const safeParams = displayParams.replace(/access_token=[^&]+/, 'access_token=…');

  const methodClass = method === 'TILES' ? 'method-tiles' : 'method-get';
  const surfaceLabel = surface || '';

  entry.innerHTML = `
    <div class="entry-row">
      <span class="entry-method ${methodClass}">${method}</span>
      <span class="entry-surface">${surfaceLabel}</span>
      <span class="entry-url"><span class="url-path">${escHtml(shortPath)}</span><span class="url-params">${escHtml(safeParams)}</span></span>
      <span class="entry-status status-pending" data-status>…</span>
      <span class="entry-time" data-time></span>
      <span class="entry-ts">${ts}</span>
    </div>
    <div class="entry-body" data-body></div>`;

  // Prepend so newest is at top
  consoleEntries.insertBefore(entry, consoleEntries.firstChild);

  // Expand/collapse on click
  entry.addEventListener('click', () => {
    const body = entry.querySelector('[data-body]');
    body.classList.toggle('visible');
  });

  // Auto-open console if collapsed
  if (!consoleEl.classList.contains('expanded')) toggleConsole();

  return function updateEntry(status, ms, json) {
    const statusEl = entry.querySelector('[data-status]');
    const timeEl   = entry.querySelector('[data-time]');
    const bodyEl   = entry.querySelector('[data-body]');

    statusEl.textContent = status;
    statusEl.className   = 'entry-status ' + (status >= 200 && status < 300 ? 'status-ok' : 'status-err');
    timeEl.textContent   = ms + 'ms';

    if (json !== undefined) {
      const pre = document.createElement('pre');
      pre.innerHTML = syntaxHighlight(JSON.stringify(json, null, 2));
      bodyEl.appendChild(pre);
    }
  };
}

/** Intercept fetch and log to console */
async function apiFetch(url, surface, label) {
  const method  = 'GET';
  const update  = logApiCall(method, url, surface || '');
  const t0      = performance.now();
  try {
    const res  = await fetch(url, { headers: { 'Authorization': `OAuth ${accessToken}` } });
    const ms   = Math.round(performance.now() - t0);
    let json;
    try { json = await res.json(); } catch { json = null; }
    update(res.status, ms, json);
    return json;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    update('ERR', ms, { error: String(err) });
    throw err;
  }
}

function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'json-num';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-str';
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Viewer tab management ────────────────────────────────────────────────────

function initTabs() {
  viewerTabs.querySelectorAll('.viewer-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      viewerTabs.querySelectorAll('.viewer-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('tab-' + tabId);
      if (panel) panel.classList.add('active');
      // Resize viewer when switching back to it
      if (tabId === 'viewer' && viewer) setTimeout(() => viewer.resize(), 50);
    });
  });
}

function switchTab(tabId) {
  viewerTabs.querySelectorAll('.viewer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabId));
  if (tabId === 'viewer' && viewer) setTimeout(() => viewer.resize(), 50);
}

// ─── Resizable divider ────────────────────────────────────────────────────────

(function initResizer() {
  let dragging = false;
  let startX   = 0;
  let startW   = 0;

  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    startX   = e.clientX;
    startW   = mapPanel.offsetWidth;
    divider.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newW = Math.max(200, Math.min(startW + (e.clientX - startX), window.innerWidth - 200));
    mapPanel.style.width = newW + 'px';
    if (map) map.resize();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor     = '';
  });
})();

// ─── Token handling ───────────────────────────────────────────────────────────

tokenToggleBtn.addEventListener('click', () => {
  tokenGroup.classList.remove('collapsed');
  tokenInput.focus();
});

tokenCancelBtn.addEventListener('click', () => {
  tokenGroup.classList.add('collapsed');
  tokenInput.value = '';
});

tokenApplyBtn.addEventListener('click', applyToken);
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyToken();
  if (e.key === 'Escape') { tokenGroup.classList.add('collapsed'); tokenInput.value = ''; }
});

function applyToken() {
  const val = tokenInput.value.trim();
  if (!val) { setStatus('error', 'Token cannot be empty'); return; }
  accessToken = val;
  tokenGroup.classList.add('collapsed');
  tokenInput.value = '';
  if (viewer) { viewer.remove(); viewer = null; }
  initMap();
}

// Auto-load with default token on startup
document.addEventListener('DOMContentLoaded', () => {
  const urlToken = new URLSearchParams(window.location.search).get('token');
  if (urlToken) {
    tokenInput.value = urlToken;
    accessToken = urlToken;
  }
  initTabs();
  initMap();
});

// ─── MapLibre initialisation ──────────────────────────────────────────────────

function initMap() {
  setStatus('loading', 'Loading map…');
  if (coneMarker)    { coneMarker.remove(); coneMarker = null; }
  if (featurePopup)  { featurePopup.remove(); featurePopup = null; }
  if (thumbPopupVisible) { thumbPopup.remove(); thumbPopupVisible = false; }
  if (map) { removeAllMapListeners(); map.remove(); map = null; }

  map = new maplibregl.Map({
    container: 'map-container',
    style: STYLE_URL,
    center: [-74.0060, 40.7128],
    zoom: 15,
    hash: true,
    attributionControl: true,
  });

  window.__mlyMap = map;

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
  }), 'top-right');

  map.on('load', onMapLoad);
  map.on('error', (e) => {
    const msg = (e.error && e.error.message) ? e.error.message : String(e);
    if (msg.includes('tiles.mapillary.com')) return;
    console.error('MapLibre error:', e);
  });
}

// ─── Add Mapillary layers after basemap loads ─────────────────────────────────

function onMapLoad() {
  const tileUrl = TILE_URL.replace('{token}', accessToken);

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [tileUrl],
    minzoom: 0,
    maxzoom: 14,
    attribution: '© <a href="https://www.mapillary.com" target="_blank">Mapillary</a>',
  });

  // Overview
  map.addLayer({
    id: LAYER_OVW,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'overview',
    minzoom: 0,
    maxzoom: 6,
    paint: {
      'circle-color': C_DOT,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 5, 4],
      'circle-opacity': 0.75,
    },
  });

  // Sequences
  map.addLayer({
    id: LAYER_SEQ,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'sequence',
    minzoom: 6,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': C_LINE,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 3, 14, 2, 18, 3],
      'line-opacity': 0.8,
    },
  });

  map.addLayer({
    id: LAYER_SEQ + '-hl',
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'sequence',
    minzoom: 6,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': C_LINE_HL,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 5, 12, 7, 14, 5, 18, 7],
      'line-opacity': 0,
    },
    filter: ['==', 'id', ''],
  });

  // Images
  map.addLayer({
    id: LAYER_IMG,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'image',
    minzoom: 14,
    paint: {
      'circle-color': C_DOT,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 9],
      'circle-opacity': 0.95,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.7,
    },
  });

  // Active image orange highlight
  map.addLayer({
    id: LAYER_IMG + '-active',
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'image',
    minzoom: 14,
    paint: {
      'circle-color': '#ff861b',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 13],
      'circle-opacity': 1,
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 1,
    },
    filter: ['==', 'id', -1],
  });

  // Image hover highlight (feature-state driven)
  map.addLayer({
    id: LAYER_IMG + '-hl',
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'image',
    minzoom: 14,
    paint: {
      'circle-color': C_DOT_HL,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 16],
      'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.5, 0],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0],
    },
  });

  bindMapEvents();
  bindLayerToggles();
  applyFiltersToLayers();
  setStatus('ok', 'Map ready — click a green layer');
}

// ─── Layer toggles (computed, points, signs) ──────────────────────────────────

function buildFilterExpression() {
  const filters = [];
  if (activeFilters.startDate) {
    const ts = new Date(activeFilters.startDate).getTime();
    if (!isNaN(ts)) filters.push(['>=', ['get', 'captured_at'], ts]);
  }
  if (activeFilters.endDate) {
    const ts = new Date(activeFilters.endDate).getTime() + 86400000;
    if (!isNaN(ts)) filters.push(['<=', ['get', 'captured_at'], ts]);
  }
  if (activeFilters.panoOnly) filters.push(['==', ['get', 'is_pano'], true]);
  if (filters.length === 0) return null;
  return filters.length === 1 ? filters[0] : ['all', ...filters];
}

function applyFiltersToLayers() {
  if (!map) return;
  const expr = buildFilterExpression();
  [LAYER_OVW, LAYER_SEQ, LAYER_IMG, LAYER_IMG + '-hl'].forEach((id) => {
    if (map.getLayer(id)) map.setFilter(id, expr || undefined);
  });
  // Preserve active-image filter on top of global filter
  if (activeImageId && map.getLayer(LAYER_IMG + '-active')) {
    const idFilter = ['==', ['to-string', ['get', 'id']], String(activeImageId)];
    map.setFilter(LAYER_IMG + '-active', expr ? ['all', expr, idFilter] : idFilter);
  }
  // If the active image is now hidden by the filter, remove the cone
  if (activeImageId && expr) {
    const isVisible = isImageVisibleUnderFilter(activeImageId, expr);
    if (!isVisible && coneMarker) {
      coneMarker.remove();
      coneMarker = null;
      if (map.getLayer(LAYER_IMG + '-active')) {
        map.setFilter(LAYER_IMG + '-active', ['==', 'id', -1]);
      }
    }
  }
}

function isImageVisibleUnderFilter(imageId, filterExpr) {
  // Query the rendered features for the active image ID to check if it passes the current filter
  if (!map || !map.getLayer(LAYER_IMG)) return true;
  const features = map.querySourceFeatures(SOURCE_ID, {
    sourceLayer: 'image',
    filter: filterExpr ? ['all', filterExpr, ['==', ['to-string', ['get', 'id']], String(imageId)]] : ['==', ['to-string', ['get', 'id']], String(imageId)],
  });
  return features.length > 0;
}

function updateFiltersActiveState() {
  const btn = document.getElementById('filters-toggle-btn');
  if (!btn) return;
  const hasActive = !!(activeFilters.startDate || activeFilters.endDate || activeFilters.panoOnly);
  btn.dataset.filtersActive = String(hasActive);
}

// Flatpickr instances for date pickers
let fpStart = null;
let fpEnd   = null;

function initDatePickers() {
  if (typeof flatpickr === 'undefined') return;
  fpStart = flatpickr('#filter-start-date', {
    dateFormat: 'Y-m-d',
    maxDate: 'today',
    disableMobile: true,
    onChange: (selectedDates, dateStr) => {
      activeFilters.startDate = dateStr;
      if (fpEnd) fpEnd.set('minDate', dateStr || null);
    },
  });
  fpEnd = flatpickr('#filter-end-date', {
    dateFormat: 'Y-m-d',
    maxDate: 'today',
    disableMobile: true,
    onChange: (selectedDates, dateStr) => {
      activeFilters.endDate = dateStr;
      if (fpStart) fpStart.set('maxDate', dateStr || 'today');
    },
  });
}

function bindLayerToggles() {
  document.getElementById('toggle-points').addEventListener('click', () => toggleLayer('points'));
  document.getElementById('toggle-signs').addEventListener('click',  () => toggleLayer('signs'));
  // Filters panel
  const filtersToggle = document.getElementById('filters-toggle-btn');
  const filtersPanel  = document.getElementById('filters-panel');
  if (filtersToggle && filtersPanel) {
    initDatePickers();
    filtersToggle.addEventListener('click', () => {
      const open = filtersPanel.classList.toggle('open');
      filtersToggle.dataset.active = String(open);
    });
    document.getElementById('filter-apply-btn').addEventListener('click', () => {
      // Close any open flatpickr calendars before closing the panel
      if (fpStart) fpStart.close();
      if (fpEnd)   fpEnd.close();
      // Dates are updated live by flatpickr onChange; just read the other fields here
      activeFilters.panoOnly  = document.getElementById('filter-pano-only').checked;
      applyFiltersToLayers();
      updateFiltersActiveState();
      filtersPanel.classList.remove('open');
      filtersToggle.dataset.active = 'false';
    });
    document.getElementById('filter-reset-btn').addEventListener('click', () => {
      activeFilters.startDate = '';
      activeFilters.endDate   = '';
      activeFilters.panoOnly  = false;
      if (fpStart) { fpStart.clear(); fpStart.set('maxDate', 'today'); }
      if (fpEnd)   { fpEnd.clear();   fpEnd.set('minDate', null); }
      document.getElementById('filter-pano-only').checked = false;
      applyFiltersToLayers();
      updateFiltersActiveState();
      filtersPanel.classList.remove('open');
      filtersToggle.dataset.active = 'false';
    });
  }
}

function toggleLayer(name) {
  layerState[name] = !layerState[name];
  const btn = document.getElementById('toggle-' + name);
  btn.dataset.active = String(layerState[name]);

  if (layerState[name]) {
    addExtraLayer(name);
  } else {
    removeExtraLayer(name);
  }
}

function addExtraLayer(name) {
  const configs = {
    points: {
      sourceId: SOURCE_POINTS,
      tileUrl: TILE_POINTS_URL.replace('{token}', accessToken),
      maxzoom: 14,
      layers: [
        {
          id: 'mly-feat-points',
          type: 'circle',
          sourceLayer: 'point',
          minzoom: 14,
          paint: {
            'circle-color': '#f59e0b',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 8],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
          },
        },
      ],
      surface: 'Map Features',
    },
    signs: {
      sourceId: SOURCE_SIGNS,
      tileUrl: TILE_SIGNS_URL.replace('{token}', accessToken),
      maxzoom: 14,
      layers: [
        {
          id: 'mly-feat-signs',
          type: 'circle',
          sourceLayer: 'traffic_sign',
          minzoom: 14,
          paint: {
            'circle-color': '#f87171',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 18, 9],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
          },
        },
      ],
      surface: 'Traffic Signs',
    },
  };

  const cfg = configs[name];
  if (!cfg) return;

  // Log tile source as a console entry
  logApiCall('TILES', cfg.tileUrl.replace(accessToken, '…'), cfg.surface);

  if (!map.getSource(cfg.sourceId)) {
    map.addSource(cfg.sourceId, {
      type: 'vector',
      tiles: [cfg.tileUrl],
      minzoom: 0,
      maxzoom: cfg.maxzoom,
    });
  }

  cfg.layers.forEach((l) => {
    if (map.getLayer(l.id)) return;
    const layerDef = {
      id: l.id,
      type: l.type,
      source: cfg.sourceId,
      'source-layer': l.sourceLayer,
      minzoom: l.minzoom || 0,
      paint: l.paint,
    };
    if (l.layout) layerDef.layout = l.layout;
    map.addLayer(layerDef);

    // Click handler for map feature layers
    if (name === 'points' || name === 'signs') {
      const clickH  = (e) => { if (!e.features.length) return; const fid = e.features[0].properties.id; if (fid) fetchMapFeature(fid, e.lngLat, name); };
      const enterH  = () => { map.getCanvas().style.cursor = 'pointer'; };
      const leaveH  = () => { map.getCanvas().style.cursor = ''; };
      map.on('click',      l.id, clickH);
      map.on('mouseenter', l.id, enterH);
      map.on('mouseleave', l.id, leaveH);
      mapListeners.push({ type: 'click',      layerId: l.id, handler: clickH });
      mapListeners.push({ type: 'mouseenter', layerId: l.id, handler: enterH });
      mapListeners.push({ type: 'mouseleave', layerId: l.id, handler: leaveH });
    }
  });
}

function removeExtraLayer(name) {
  const layerIds = {
    points: ['mly-feat-points'],
    signs:  ['mly-feat-signs'],
  };
  const sourceIds = {
    points: SOURCE_POINTS,
    signs:  SOURCE_SIGNS,
  };
  (layerIds[name] || []).forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
  const sid = sourceIds[name];
  if (sid && map.getSource(sid)) map.removeSource(sid);
}

// ─── Fetch map feature entity ─────────────────────────────────────────────────

// Persistent popup for map features
let featurePopup = null;

async function fetchMapFeature(featureId, lngLat, featureType) {
  const url = `${GRAPH_URL}/${featureId}?fields=id,object_value,object_type,first_seen_at,last_seen_at,images&access_token=${accessToken}`;
  try {
    const data = await apiFetch(url, 'Map Feature', 'Map Feature entity');
    if (!data) return;

    const objectValue = data.object_value || '';
    const isSign = featureType === 'signs';
    const spriteBase = 'https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/';
    const spriteDir  = isSign ? 'package_signs' : 'package_objects';
    const svgUrl     = objectValue ? `${spriteBase}${spriteDir}/${objectValue}.svg` : null;

    // Fetch thumbnail from first associated image
    let firstImgId = null;
    let thumbSrc   = null;
    if (data.images && data.images.data && data.images.data.length > 0) {
      firstImgId = data.images.data[0].id;
      try {
        const tRes  = await fetch(`${GRAPH_URL}/${firstImgId}?fields=thumb_256_url&access_token=${accessToken}`);
        const tData = await tRes.json();
        thumbSrc = tData.thumb_256_url || null;
      } catch { /* no thumb */ }
    }

    const label    = (objectValue || featureId).replace(/--/g, ' › ').replace(/-/g, ' ');
    const type     = (data.object_type || '').replace(/-/g, ' ');
    const date     = data.first_seen_at ? new Date(data.first_seen_at).toLocaleDateString() : '';
    const imgCount = data.images ? data.images.data.length : 0;

    const svgHtml  = svgUrl
      ? `<div class="feat-popup-icon"><img src="${svgUrl}" alt="${escHtml(objectValue)}" onerror="this.parentElement.style.display='none'" /></div>`
      : '';
    const thumbHtml = thumbSrc
      ? `<img class="feat-popup-thumb" src="${thumbSrc}" alt="Feature image" />`
      : '';

    const html = `
      <div class="feat-popup">
        ${thumbHtml}
        <div class="feat-popup-body">
          ${svgHtml}
          <div class="feat-popup-type">${escHtml(type)}</div>
          <div class="feat-popup-value">${escHtml(label)}</div>
          ${date ? `<div class="feat-popup-meta">First seen: ${date}</div>` : ''}
          ${imgCount ? `<div class="feat-popup-meta">${imgCount} image${imgCount !== 1 ? 's' : ''}</div>` : ''}
          <div class="feat-popup-id">${escHtml(featureId)}</div>
        </div>
      </div>`;

    if (!featurePopup) {
      featurePopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'mly-feat-popup' });
    }
    featurePopup.setLngLat(lngLat).setHTML(html).addTo(map);

    // Update info tab
    document.getElementById('info-api-url').textContent = `graph.mapillary.com/${featureId}?fields=id,object_value,…`;
    renderInfoGrid(document.getElementById('info-content'), {
      id:             featureId,
      object_value:   objectValue || 'n/a',
      object_type:    data.object_type  || 'n/a',
      first_seen_at:  data.first_seen_at ? new Date(data.first_seen_at).toISOString().slice(0,10) : 'n/a',
      last_seen_at:   data.last_seen_at  ? new Date(data.last_seen_at).toISOString().slice(0,10)  : 'n/a',
      images_count:   imgCount,
    }, featureId);

    // Open the first associated image in the viewer
    if (firstImgId) {
      suppressFlyTo = true;
      lastClickedLngLat = lngLat;
      // Hide the thumbnail hover popup when clicking a feature/sign
      hideThumbPopup();
      openImageInViewer(String(firstImgId));
    }
  } catch (err) {
    console.warn('Map feature fetch failed:', err);
  }
}

// ─── Thumbnail popup ─────────────────────────────────────────────────────────

const thumbCache = new Map();
let thumbTimer   = null;
let lastThumbId  = null;

const thumbPopup = new maplibregl.Popup({
  closeButton: false,
  closeOnClick: false,
  offset: 12,
  className: 'mly-thumb-popup',
  maxWidth: 'none',
});
let thumbPopupVisible = false;

async function fetchThumb(imageId) {
  if (thumbCache.has(imageId)) return thumbCache.get(imageId);
  try {
    const url  = `${GRAPH_URL}/${imageId}?fields=thumb_256_url&access_token=${accessToken}`;
    const res  = await fetch(url);
    const data = await res.json();
    const thumb = data.thumb_256_url || null;
    if (thumbCache.size >= THUMB_CACHE_MAX) {
      thumbCache.delete(thumbCache.keys().next().value);
    }
    thumbCache.set(imageId, thumb);
    return thumb;
  } catch {
    thumbCache.set(imageId, null);
    return null;
  }
}

function showThumbPopup(lngLat, imageId, thumbUrl) {
  if (!thumbUrl) return;
  const html = `<div class="thumb-popup"><img src="${thumbUrl}" alt="Image ${imageId}" /></div>`;
  thumbPopup.setLngLat(lngLat).setHTML(html);
  if (!thumbPopupVisible) { thumbPopup.addTo(map); thumbPopupVisible = true; }
}

function hideThumbPopup() {
  clearTimeout(thumbTimer);
  thumbTimer = null;
  if (thumbPopupVisible) { thumbPopup.remove(); thumbPopupVisible = false; }
  lastThumbId = null;
}

// ─── Map interaction ──────────────────────────────────────────────────────────

let hoveredSeqId = null;
let hoveredImgId = null;

function bindMapEvents() {
  const clickable = [LAYER_OVW, LAYER_SEQ, LAYER_IMG];

  clickable.forEach((id) => {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  });

  // Sequence hover highlight
  map.on('mousemove', LAYER_SEQ, (e) => {
    if (!e.features.length) return;
    const sid = e.features[0].properties.id;
    if (sid === hoveredSeqId) return;
    hoveredSeqId = sid;
    map.setFilter(LAYER_SEQ + '-hl', ['==', 'id', sid]);
    map.setPaintProperty(LAYER_SEQ + '-hl', 'line-opacity', 0.5);
  });
  map.on('mouseleave', LAYER_SEQ, () => {
    hoveredSeqId = null;
    map.setPaintProperty(LAYER_SEQ + '-hl', 'line-opacity', 0);
  });

  // Image hover highlight + thumbnail popup
  function setHoverState(id, value) {
    if (id === null) return;
    map.setFeatureState(
      { source: SOURCE_ID, sourceLayer: 'image', id },
      { hover: value }
    );
  }

  map.on('mousemove', LAYER_IMG, (e) => {
    if (!e.features.length) return;
    const feat = e.features[0];
    const iid  = feat.properties.id;

    if (iid === lastThumbId) return;
    lastThumbId = iid;
    clearTimeout(thumbTimer);

    if (hoveredImgId !== null && hoveredImgId !== iid) {
      setHoverState(hoveredImgId, false);
    }
    hoveredImgId = iid;

    const lngLat = e.lngLat;
    if (thumbCache.has(iid)) {
      setHoverState(iid, false);
      showThumbPopup(lngLat, iid, thumbCache.get(iid));
      return;
    }

    setHoverState(iid, true);
    thumbTimer = setTimeout(async () => {
      const thumb = await fetchThumb(iid);
      if (lastThumbId === iid) showThumbPopup(lngLat, iid, thumb);
    }, 300);
  });

  map.on('mouseleave', LAYER_IMG, () => {
    setHoverState(hoveredImgId, false);
    hoveredImgId = null;
    hideThumbPopup();
  });

  // Click handlers
    // Helper: pick the feature geometrically closest to the click point
  function pickClosestFeature(e, layers) {
    const TOL = 8; // pixel tolerance
    const bbox = [{ x: e.point.x - TOL, y: e.point.y - TOL }, { x: e.point.x + TOL, y: e.point.y + TOL }];
    const features = map.queryRenderedFeatures(bbox, { layers });
    if (!features.length) return null;
    // Sort by distance from click point to feature's projected pixel position
    const clickX = e.point.x, clickY = e.point.y;
    features.sort((a, b) => {
      const pa = map.project([a.geometry.coordinates[0], a.geometry.coordinates[1]]);
      const pb = map.project([b.geometry.coordinates[0], b.geometry.coordinates[1]]);
      const da = (pa.x - clickX) ** 2 + (pa.y - clickY) ** 2;
      const db = (pb.x - clickX) ** 2 + (pb.y - clickY) ** 2;
      return da - db;
    });
    return features[0];
  }

  map.on('click', LAYER_IMG, (e) => {
    e.originalEvent.stopPropagation();
    const feat = pickClosestFeature(e, [LAYER_IMG]);
    if (!feat) return;
    // Close any open feature/sign popup when clicking an image dot
    if (featurePopup) featurePopup.remove();
    suppressFlyTo = true;
    lastClickedLngLat = e.lngLat;
    openImageInViewer(String(feat.properties.id));
  });
  map.on('click', LAYER_SEQ, (e) => {
    e.originalEvent.stopPropagation();
    const feat = pickClosestFeature(e, [LAYER_SEQ]);
    if (!feat) return;
    // Close any open feature/sign popup when clicking a sequence
    if (featurePopup) featurePopup.remove();
    suppressFlyTo = true;
    lastClickedLngLat = e.lngLat;
    const imageId = String(feat.properties.image_id);
    if (imageId && imageId !== 'undefined' && imageId !== 'null' && imageId !== '0') {
      openImageInViewer(imageId);
    }
  });
  map.on('click', LAYER_OVW, (e) => {
    e.originalEvent.stopPropagation();
    const feat = pickClosestFeature(e, [LAYER_OVW]);
    if (!feat) return;
    // Close any open feature/sign popup when clicking an overview dot
    if (featurePopup) featurePopup.remove();
    suppressFlyTo = true;
    lastClickedLngLat = e.lngLat;
    openImageInViewer(String(feat.properties.id));
  });

  map.on('zoom', updateZoomHint);
  updateZoomHint();
}

function updateZoomHint() {
  if (!map) return;
  const z = map.getZoom();
  if (z >= 14) {
    zoomHint.classList.add('hidden');
  } else {
    zoomHint.textContent = z >= 6
      ? 'Zoom to level 14+ to see individual images'
      : 'Zoom in to see Mapillary coverage';
    zoomHint.classList.remove('hidden');
  }
}

// ─── MapillaryJS viewer ───────────────────────────────────────────────────────

function openImageInViewer(imageId) {
  if (!imageId || imageId === 'undefined' || imageId === 'null' || imageId === '0') return;

  setStatus('loading', 'Loading image…');
  showViewer(imageId);

  if (!viewer) {
    viewerNavigable = false;
    pendingImageId  = null;
    initViewer(imageId);
  } else if (!viewerNavigable) {
    pendingImageId = imageId;
  } else {
    viewer.moveTo(imageId).catch((err) => {
      const msg = String(err && err.message || err);
      if (msg.includes('not navigable') || msg.includes('not supported when viewer is not navigable')) {
        // Viewer is temporarily non-navigable; queue and wait for next navigable event
        pendingImageId = imageId;
        // Fallback: if viewer stays stuck, re-init it after 2s
        setTimeout(() => {
          if (pendingImageId === imageId && !viewerNavigable) {
            console.warn('Viewer stuck non-navigable — re-initialising for', imageId);
            viewer.remove();
            viewer = null;
            viewerNavigable = false;
            pendingImageId = null;
            initViewer(imageId);
          }
        }, 2000);
      } else {
        console.warn('moveTo failed:', err);
        setStatus('error', 'Could not load image');
      }
    });
  }

  // Note: fetchImageData is called in the viewer 'image' event handler,
  // not here, to avoid duplicate API calls.
}
function initViewer(initialImageId) {
  const { Viewer } = mapillary;

  viewer = new Viewer({
    accessToken,
    container: 'mly-container',
    imageId: initialImageId,
    component: {
      cover: false,
      sequence: { visible: true },
    },
  });

  viewer.on('navigable', (event) => {
    viewerNavigable = event.navigable;
    if (viewerNavigable && pendingImageId) {
      const id = pendingImageId;
      pendingImageId = null;
      viewer.moveTo(id).catch((err) => console.warn('moveTo (pending) failed:', err));
    }
  });

  viewer.on('error', (event) => {
    const msg = event && event.message ? event.message : String(event);
    if (
      msg.includes('Failed to cache tile data') ||
      msg.includes('Failed to cache spatial images') ||
      msg.includes('Failed to cache periphery bounding box') ||
      msg.includes('Failed to fetch data') ||
      msg.includes('Param z must be a number') ||
      msg.includes('Service temporarily unavailable') ||
      msg.includes('MLYApiException')
    ) return;
    console.warn('[MapillaryJS]', msg);
  });

  viewer.on('image', (event) => {
    const img = event.image;
    activeImageId = img.id;
    updateInfoBar(img.id);
    setStatus('ok', 'Viewing image');

    if (map && map.getLayer(LAYER_IMG + '-active')) {
      const baseExpr = buildFilterExpression();
      const idFilter = ['==', ['to-string', ['get', 'id']], String(img.id)];
      map.setFilter(LAYER_IMG + '-active', baseExpr ? ['all', baseExpr, idFilter] : idFilter);
    }

    // Use the tile feature's exact coordinate so the cone is pixel-perfect on the orange circle.
    // Query after a short delay to let MapLibre render the filtered feature.
    const compassAngle = img.compassAngle || 0;
    const fallbackLngLat = img.lngLat || img.originalLngLat || lastClickedLngLat;
    if (fallbackLngLat) updateConeMarker(fallbackLngLat.lng, fallbackLngLat.lat, compassAngle);
    setTimeout(() => {
      if (!map || activeImageId !== img.id) return;
      const features = map.querySourceFeatures(SOURCE_ID, {
        sourceLayer: 'image',
        filter: ['==', ['to-string', ['get', 'id']], String(img.id)],
      });
      if (features.length > 0 && features[0].geometry && features[0].geometry.coordinates) {
        const [tileLng, tileLat] = features[0].geometry.coordinates;
        updateConeMarker(tileLng, tileLat, compassAngle);
      }
    }, 200);

    // Always fetch image data (attribution, detections, sequence) regardless of suppressFlyTo
    fetchImageData(img.id);

    if (suppressFlyTo) {
      suppressFlyTo = false;
      return;
    }
    const flyLngLat = img.lngLat || img.originalLngLat;
    if (flyLngLat) {
      map.flyTo({
        center: [flyLngLat.lng, flyLngLat.lat],
        zoom: Math.max(map.getZoom(), 17),
        duration: 600,
        essential: true,
      });
    }
  });
}

// ─── Fetch all API data for an image ─────────────────────────────────────────

async function fetchImageData(imageId) {
  // Run all three fetches in parallel
  await Promise.all([
    fetchImageEntity(imageId),
    fetchDetections(imageId),
  ]);
  // Sequence fetch depends on sequence_id from image entity — handled inside fetchImageEntity
}

async function fetchImageEntity(imageId) {
  const fields = 'id,captured_at,compass_angle,is_pano,thumb_256_url,sequence,creator';
  const url = `${GRAPH_URL}/${imageId}?fields=${fields}&access_token=${accessToken}`;
  document.getElementById('info-api-url').textContent = `graph.mapillary.com/${imageId}?fields=${fields.split(',').slice(0,3).join(',')}…`;

  try {
    const data = await apiFetch(url, 'Entity', 'Image entity');
    if (!data) return;

    const infoContent = document.getElementById('info-content');
    const creatorUsername = data.creator && data.creator.username ? data.creator.username : null;
    const capturedDate = data.captured_at ? new Date(data.captured_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : null;

    renderInfoGrid(infoContent, {
      id:             data.id,
      captured_at:    capturedDate || 'n/a',
      compass_angle:  data.compass_angle != null ? Math.round(data.compass_angle) + '°' : 'n/a',
      is_pano:        data.is_pano != null ? String(data.is_pano) : 'n/a',
      creator:        creatorUsername || 'n/a',
      sequence:       data.sequence || 'n/a',
      thumb_256_url:  data.thumb_256_url ? '(available)' : 'n/a',
    }, imageId);

    // Update viewer info bar with attribution
    updateAttribution(creatorUsername, capturedDate, imageId);

    // Now fetch sequence
    if (data.sequence) fetchSequence(data.sequence, imageId);
  } catch (err) {
    console.warn('Image entity fetch failed:', err);
    // Clear the loading state so the bar doesn't stay stuck
    updateAttribution(null, null, imageId);
  }
}
async function fetchDetections(imageId) {
  const url = `${GRAPH_URL}/${imageId}/detections?fields=id,value,created_at&limit=50&access_token=${accessToken}`;
  document.getElementById('detections-api-url').textContent = `graph.mapillary.com/${imageId}/detections`;

  try {
    const data = await apiFetch(url, 'Entity', 'Detections');
    if (!data || !data.data) return;

    const container = document.getElementById('detections-content');
    if (data.data.length === 0) {
      container.innerHTML = '<div class="data-placeholder">No detections found for this image</div>';
      return;
    }

    container.innerHTML = '';
    data.data.forEach((det) => {
      const item = document.createElement('div');
      item.className = 'detection-item';
      item.innerHTML = `
        <span class="detection-icon"></span>
        <span class="detection-value">${escHtml(det.value || 'unknown')}</span>
        <span class="detection-id">${escHtml(String(det.id || '').slice(0, 12))}…</span>`;
      container.appendChild(item);
    });
  } catch (err) {
    console.warn('Detections fetch failed:', err);
  }
}

async function fetchSequence(sequenceId, currentImageId) {
  const url = `${GRAPH_URL}/image_ids?sequence_id=${sequenceId}&access_token=${accessToken}`;
  document.getElementById('sequence-api-url').textContent = `graph.mapillary.com/image_ids?sequence_id=${sequenceId.slice(0,12)}…`;

  try {
    const data = await apiFetch(url, 'Entity', 'Sequence');
    if (!data || !data.data) return;

    const container = document.getElementById('sequence-content');
    const ids = data.data.map(d => String(d.id));
    const total = ids.length;

    const meta = document.createElement('div');
    meta.className = 'seq-meta';
    meta.innerHTML = `Sequence <span>${escHtml(sequenceId.slice(0,16))}…</span> · <span>${total}</span> images`;
    container.innerHTML = '';
    container.appendChild(meta);

    ids.forEach((id, i) => {
      const row = document.createElement('div');
      row.className = 'seq-image-row' + (id === String(currentImageId) ? ' active-seq-img' : '');
      row.innerHTML = `
        <span class="seq-idx">${i + 1}</span>
        <span class="seq-id">${escHtml(id)}</span>
        ${id === String(currentImageId) ? '<span class="seq-active-badge">current</span>' : ''}`;
      row.addEventListener('click', () => {
        suppressFlyTo = false;
        openImageInViewer(id);
        switchTab('viewer');
      });
      container.appendChild(row);
    });

    // Scroll active image into view
    const activeRow = container.querySelector('.active-seq-img');
    if (activeRow) setTimeout(() => activeRow.scrollIntoView({ block: 'nearest' }), 100);
  } catch (err) {
    console.warn('Sequence fetch failed:', err);
  }
}

function renderInfoGrid(container, fields, imageId) {
  container.innerHTML = '';
  const colorMap = {
    id: 'val-green',
    sequence_id: 'val-blue',
    is_pano: 'val-orange',
    compass_angle: 'val-orange',
  };
  Object.entries(fields).forEach(([k, v]) => {
    const keyEl = document.createElement('div');
    keyEl.className = 'data-key';
    keyEl.textContent = k;

    const valEl = document.createElement('div');
    valEl.className = 'data-val ' + (colorMap[k] || '');

    // Make creator username a clickable link
    if (k === 'creator' && v && v !== 'n/a') {
      const link = document.createElement('a');
      link.href = 'https://www.mapillary.com/app/user/' + encodeURIComponent(v);
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'info-username-link';
      link.textContent = String(v);
      valEl.appendChild(link);
    } else {
      valEl.textContent = String(v);
    }

    container.appendChild(keyEl);
    container.appendChild(valEl);
  });
}

// ─── Show / close viewer ──────────────────────────────────────────────────────

function showViewer(imageId) {
  mainContent.classList.add('viewer-open');
  placeholder.classList.add('hidden');
  infoBar.classList.remove('hidden');
  viewerTabs.classList.remove('hidden');
  updateInfoBar(imageId);
  setTimeout(() => {
    if (map) map.resize();
    if (viewer) viewer.resize();
  }, 370);
}

// Track which imageId has already had attribution loaded
let loadedAttributionId = null;
function updateInfoBar(imageId) {
  // Only reset to loading state if we don't already have attribution for this image
  if (loadedAttributionId === imageId) return;
  const attrEl = document.getElementById('viewer-attribution');
  if (attrEl) attrEl.innerHTML = '<span class="attr-loading" style="opacity:0.5;font-style:italic">Loading attribution…</span>';
}

function updateAttribution(username, capturedDate, imageId) {
  const attrEl = document.getElementById('viewer-attribution');
  if (!attrEl) return;
  if (!username && !capturedDate) {
    attrEl.innerHTML = '<span class="attr-loading" style="opacity:0.5">Attribution unavailable</span>';
    return;
  }
  const parts = [];
  if (username) parts.push('by <a href="https://www.mapillary.com/app/user/' + encodeURIComponent(username) + '" target="_blank" rel="noopener" class="attr-username">' + escHtml(username) + '<\/a>');
  if (capturedDate) parts.push('<span class="attr-date">' + capturedDate.slice(0, 10) + '<\/span>');
  attrEl.innerHTML = 'Image ' + parts.join(' ');
  // Mark this image as having attribution loaded
  if (imageId) loadedAttributionId = String(imageId);
  else if (activeImageId) loadedAttributionId = String(activeImageId);
}

// ─── Orientation cone marker ─────────────────────────────────────────────────

function updateConeMarker(lng, lat, compassAngle) {
  if (!map) return;

  if (!coneMarker) {
    const el = document.createElement('div');
    el.className = 'orientation-cone';
    // SVG cone pointing straight up (north = 0°); MapLibre Marker rotation handles the bearing.
    // The fan spans ±40° from the forward direction.
    const r = 36;
    const half = 40 * Math.PI / 180;
    const x1 = Math.sin(-half) * r, y1 = -Math.cos(half) * r;
    const x2 = Math.sin( half) * r, y2 = -Math.cos(half) * r;
    el.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="-30 -30 60 60"
           style="overflow:visible;position:absolute;left:-30px;top:-30px">
        <path d="M0,0 L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0,1 ${x2.toFixed(2)},${y2.toFixed(2)} Z"
              fill="#ff861b" opacity="0.60"/>
      </svg>`;
    // Use rotationAlignment:'map' so the cone rotates with the map bearing.
    // The rotation prop sets the initial compass angle; we update it via setRotation().
    coneMarker = new maplibregl.Marker({
      element: el,
      anchor: 'top-left',  // 0×0 container — top-left IS the anchor point
      rotationAlignment: 'map',
      rotation: compassAngle,
    })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    coneMarker.setLngLat([lng, lat]);
    coneMarker.setRotation(compassAngle);
  }
}

// ─── Close viewer ─────────────────────────────────────────────────────────────

closeBtn.addEventListener('click', () => {
  mainContent.classList.remove('viewer-open');
  placeholder.classList.remove('hidden');
  infoBar.classList.add('hidden');
  viewerTabs.classList.add('hidden');
  setStatus('ok', 'Map ready — click a green layer');
  if (coneMarker) { coneMarker.remove(); coneMarker = null; }
  if (map && map.getLayer(LAYER_IMG + '-active')) {
    map.setFilter(LAYER_IMG + '-active', ['==', 'id', -1]);
  }
  setTimeout(() => { if (map) map.resize(); }, 370);
});

// ─── Window resize ────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (map) map.resize();
  if (viewer) viewer.resize();
});

// ─── Auto-init from URL param (?token=XXX) ────────────────────────────────────

(function autoInit() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    tokenInput.value = urlToken;
    accessToken = urlToken;
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    initMap();
  }
})();

// ─── Geocoder (Nominatim) ─────────────────────────────────────────────────────

(function initGeocoder() {
  const geocoderInput   = document.getElementById('geocoder-input');
  const geocoderClear   = document.getElementById('geocoder-clear');
  const suggestionsList = document.getElementById('geocoder-suggestions');

  let debounceTimer = null;
  let activeIndex   = -1;
  let lastResults   = [];

  geocoderInput.addEventListener('input', () => {
    const q = geocoderInput.value.trim();
    geocoderClear.classList.toggle('hidden', q.length === 0);
    if (q.length < 2) { hideSuggestions(); return; }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
  });

  geocoderClear.addEventListener('click', () => {
    geocoderInput.value = '';
    geocoderClear.classList.add('hidden');
    hideSuggestions();
    geocoderInput.focus();
  });

  geocoderInput.addEventListener('keydown', (e) => {
    const items = suggestionsList.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      updateActive(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && lastResults[activeIndex]) {
        selectResult(lastResults[activeIndex]);
      } else if (geocoderInput.value.trim().length >= 2) {
        clearTimeout(debounceTimer);
        fetchSuggestions(geocoderInput.value.trim(), true);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
      geocoderInput.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#geocoder-wrap')) hideSuggestions();
  });

  function updateActive(items) {
    items.forEach((li, i) => {
      li.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    });
  }

  async function fetchSuggestions(query, flyToFirst = false) {
    try {
      const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      lastResults  = data;
      activeIndex  = -1;
      if (flyToFirst && data.length > 0) { selectResult(data[0]); return; }
      renderSuggestions(data);
    } catch (err) {
      console.warn('Geocoder error:', err);
    }
  }

  function renderSuggestions(results) {
    suggestionsList.innerHTML = '';
    if (!results.length) { hideSuggestions(); return; }

    results.forEach((r) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const parts = r.display_name.split(', ');
      const main  = parts.slice(0, 2).join(', ');
      const sub   = parts.slice(2).join(', ');

      li.innerHTML = `<div class="suggestion-main">${escHtml(main)}</div>${sub ? `<div class="suggestion-sub">${escHtml(sub)}</div>` : ''}`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); selectResult(r); });
      suggestionsList.appendChild(li);
    });

    suggestionsList.classList.add('visible');
  }

  function selectResult(result) {
    geocoderInput.value = result.display_name.split(', ').slice(0, 2).join(', ');
    geocoderClear.classList.remove('hidden');
    hideSuggestions();

    if (!map) return;

    const lng  = parseFloat(result.lon);
    const lat  = parseFloat(result.lat);
    const bbox = result.boundingbox;

    const ANIM_MS = 900;
    if (bbox) {
      map.fitBounds(
        [[parseFloat(bbox[2]), parseFloat(bbox[0])], [parseFloat(bbox[3]), parseFloat(bbox[1])]],
        { padding: 40, maxZoom: 16, duration: ANIM_MS }
      );
    } else {
      map.flyTo({ center: [lng, lat], zoom: 16, duration: ANIM_MS });
    }
    // Wait for the map to finish flying AND tiles to fully render before querying features
    function waitForIdleThenOpen() {
      map.once('idle', () => openNearestImage(lng, lat));
    }
    setTimeout(waitForIdleThenOpen, ANIM_MS + 50);
  }

  function openNearestImage(lng, lat) {
    // Use the map's rendered tile features to find the nearest image — more reliable than
    // the Graph API bbox search which may return empty results due to token scope.
    if (!map) return;
    const center = map.project([lng, lat]);
    // Query a generous pixel radius around the target point
    const r = 120;
    const features = map.queryRenderedFeatures(
      [[ center.x - r, center.y - r ], [ center.x + r, center.y + r ]],
      { layers: [LAYER_IMG] }
    );
    if (!features || features.length === 0) return;

    // Pick the feature whose geometry is closest to the target lngLat
    let best = null, bestDist = Infinity;
    for (const f of features) {
      const fId = f.properties && (f.properties.id || f.id);
      if (!fId) continue;
      // Apply active filters
      if (activeFilters.panoOnly && !f.properties.is_pano) continue;
      if (activeFilters.startDate) {
        const ts = f.properties.captured_at;
        if (ts && ts < new Date(activeFilters.startDate).getTime()) continue;
      }
      if (activeFilters.endDate) {
        const ts = f.properties.captured_at;
        if (ts && ts > new Date(activeFilters.endDate).getTime() + 86400000) continue;
      }
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) continue;
      const d = Math.hypot(coords[0] - lng, coords[1] - lat);
      if (d < bestDist) { bestDist = d; best = { id: fId, coords }; }
    }
    if (best) {
      openImageInViewer(String(best.id));
    }
  }

  function hideSuggestions() {
    suggestionsList.classList.remove('visible');
    suggestionsList.innerHTML = '';
    activeIndex = -1;
  }
})();
