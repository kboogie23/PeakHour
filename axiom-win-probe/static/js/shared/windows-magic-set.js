// PEAK HOUR (Windows edition): behaviour for the redesigned Magic Set view (windows-magic-set.css).
// It only reads values the page already has (the set, the BPM markers, the score card) and writes labels,
// state attributes and CSS variables. Nothing here changes what Generate Set, Build Around or Suggest Order do.
(function () {
  'use strict';
  if (window.__phMagicSetLoaded) return;
  window.__phMagicSetLoaded = true;

  var MIN_TRACKS = 5;
  var $ = function (id) { return document.getElementById(id); };
  var pending = false;

  function safe(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function activeList() { return safe(function () { return getActiveSetList(); }, []) || []; }
  function workingCount() { return safe(function () { return currentPlaylist.length; }, 0); }
  function setCount() { return Math.max(workingCount(), safe(function () { return currentRoutePlaylist.length; }, 0)); }
  function dotCount() { return safe(function () { return graphDots.length; }, 0); }
  function inMagic() { return document.body.classList.contains('studio-magic-mode'); }
  function viewName() {
    if (inMagic()) return 'magic';
    return safe(function () { return activeStudioView; }, 'manual') === 'route' ? 'route' : 'manual';
  }
  function text(id, value) { var el = $(id); if (el && el.textContent !== value) el.textContent = value; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---- 1 / 2 / 3 flow -------------------------------------------------------------------------
  function updateFlow() {
    var flow = $('magic-flow');
    if (!flow) return;
    var n = setCount();
    var view = viewName();
    var current;
    if (view !== 'magic') current = 'refine';
    else if (n > 0) current = 'refine';
    else current = dotCount() >= 2 ? 'build' : 'shape';
    var order = ['shape', 'build', 'refine'];
    order.forEach(function (step, index) {
      var li = flow.querySelector('[data-magic-step="' + step + '"]');
      if (!li) return;
      var state = step === current ? 'current' : (index < order.indexOf(current) ? 'done' : 'todo');
      if (step === 'shape' || step === 'build') { if (n > 0 && state === 'todo') state = 'done'; }
      if (view !== 'magic' && n === 0 && step !== 'refine') state = 'todo';
      li.dataset.state = state;
      var button = li.querySelector('button');
      if (state === 'current') button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    var refine = $('magic-flow-refine');
    if (refine) {
      var locked = n === 0;
      refine.setAttribute('aria-disabled', locked ? 'true' : 'false');
      refine.title = locked ? 'Build or add songs first, then refine them here.' : '';
    }
    text('magic-flow-build-note', n > 0 ? plural(n, 'track') + ' in the set' : 'Generate Set or Build Around');
    text('magic-flow-refine-note', n === 0 ? 'Opens once the set has songs'
      : (n < MIN_TRACKS ? 'Manual Build · Suggest Order needs ' + MIN_TRACKS + '+' : 'Manual Build and Suggest Order'));
    document.body.dataset.magicView = view;
    document.body.dataset.magicStep = current;
  }

  function flowClick(step) {
    var n = setCount();
    if (step === 'shape' || step === 'build') {
      if (!inMagic() && typeof openMagicSetWorkspace === 'function') openMagicSetWorkspace();
      var target = $(step === 'shape' ? 'set-length-selector' : 'btn-magic-set');
      if (target) setTimeout(function () { target.focus(); }, 60);
      return;
    }
    if (n === 0) {
      if (typeof showToast === 'function') showToast('Build or add songs first, then refine them.', true);
      return;
    }
    if (inMagic() && typeof viewMagicSetInStudio === 'function') viewMagicSetInStudio();
    else if (viewName() === 'route' && typeof setStudioView === 'function') setStudioView('manual', { userActivated: true });
    var list = $('active-playlist-container');
    if (list && list.scrollTo) list.scrollTo({ top: 0 });
  }

  // ---- stat chips, score ring ------------------------------------------------------------------
  function updateChips() {
    var list = activeList();
    var n = list.length;
    text('magic-chip-tracks', String(n));
    var runtime = $('studio-set-runtime');
    text('magic-chip-time', runtime && n ? runtime.textContent.trim() : '0 min');
    var bpms = list.map(function (t) { return Number(t && t.bpm) || 0; }).filter(function (b) { return b > 0; });
    text('magic-chip-bpm', bpms.length ? Math.round(Math.min.apply(null, bpms)) + '-' + Math.round(Math.max.apply(null, bpms)) : '--');
    var changes = 0, pairs = 0;
    for (var i = 1; i < list.length; i++) {
      var a = list[i - 1] && list[i - 1].camelot, b = list[i] && list[i].camelot;
      if (!a || !b) continue;
      pairs++;
      if (String(a).toUpperCase() !== String(b).toUpperCase()) changes++;
    }
    text('magic-chip-keys', pairs ? String(changes) : '--');
  }

  var SCORE_HINT = {
    Ready: 'Build a set to see its score.',
    Excellent: 'Blends cleanly all the way through.',
    Strong: 'Most transitions blend easily.',
    Playable: 'A few jumps need care.',
    Review: 'Check the red transitions.'
  };
  function updateScore() {
    var card = document.querySelector('.magic-score-card');
    if (!card) return;
    var value = Number(($('magic-score-value') || {}).textContent) || 0;
    var label = (($('magic-score-label') || {}).textContent || 'Ready').trim();
    card.style.setProperty('--wms-score', String(Math.max(0, Math.min(100, value))));
    card.dataset.tone = value >= 80 ? 'good' : (value >= 65 ? 'ok' : (value > 0 ? 'low' : 'none'));
    text('magic-score-hint', SCORE_HINT[label] || SCORE_HINT.Ready);
  }

  // ---- hints, disabled reasons, empty state ------------------------------------------------------
  function updateHints() {
    var n = setCount(), working = workingCount();
    var around = $('btn-build-around-tracks');
    var hint = $('magic-build-hint');
    if (hint) {
      var msg;
      if (working === 0) msg = around && around.disabled
        ? 'Build Around unlocks when the Working Set has a song.'
        : 'Generate Set fills the timeline from your BPM curve.';
      else msg = 'Keeps your ' + plural(working, 'song') + ' and fills the rest around them.';
      text('magic-build-hint', msg);
    }
    var optimize = $('btn-optimize');
    var suggest = $('magic-suggest-hint');
    if (optimize) {
      var locked = working < MIN_TRACKS;
      var reason = locked ? 'Add ' + plural(MIN_TRACKS - working, 'more track') + ' to unlock Suggest Order (it needs ' + MIN_TRACKS + ' or more to find a key path).' : '';
      optimize.title = locked ? reason : 'Reorder the set so each key flows into the next';
      if (suggest) text('magic-suggest-hint', locked ? 'Suggest Order unlocks at ' + MIN_TRACKS + ' tracks (' + working + ' now)' : '');
    }
    var graph = $('graph-container');
    if (graph) graph.dataset.magicEmpty = (n === 0 && dotCount() === 0) ? 'true' : 'false';
  }

  // ---- harmonic route banner -------------------------------------------------------------------------
  function keyClass(key) {
    var m = /^(\d{1,2})([AB])$/i.exec(String(key || '').trim());
    return m ? 'wms-k' + (Number(m[1]) % 12) : 'wms-k-none';
  }
  function updateRoute() {
    var banner = $('magic-route-banner');
    if (!banner) return;
    var show = viewName() === 'route';
    banner.hidden = !show;
    if (!show) return;
    var ol = $('magic-route-keys');
    var keys = [];
    activeList().forEach(function (t) {
      var k = (t && t.camelot) || '--';
      if (!keys.length || keys[keys.length - 1] !== k) keys.push(k);
    });
    var shown = keys.slice(0, 18);
    var html = shown.map(function (k) { return '<li class="' + keyClass(k) + '">' + String(k).replace(/[<>&]/g, '') + '</li>'; }).join('');
    if (keys.length > shown.length) html += '<li class="more">+' + (keys.length - shown.length) + '</li>';
    if (ol.dataset.sig !== html) { ol.innerHTML = html; ol.dataset.sig = html; }
  }

  // ---- track rows: key colour, duration, number ---------------------------------------------------------
  function fmtDuration(seconds) {
    seconds = Math.round(Number(seconds) || 0);
    if (seconds <= 0) return '--:--';
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function decorateRows() {
    var container = $('active-playlist-container');
    if (!container) return;
    var rows = container.querySelectorAll('.playlist-row');
    if (!rows.length) return;
    var list = activeList();
    rows.forEach(function (row, index) {
      var track = list[index];
      var pill = row.querySelector('.camelot-pill');
      if (pill && track) {
        var cls = keyClass(track.camelot);
        if (!pill.classList.contains(cls)) {
          pill.className = pill.className.replace(/\bwms-k\S*/g, '').trim() + ' ' + cls;
        }
      }
      var time = row.querySelector('.wms-duration');
      var value = track ? fmtDuration(safe(function () { return studioTrackDurationSeconds(track); }, 0)) : '--:--';
      if (!time) {
        time = document.createElement('div');
        time.className = 'wms-duration';
        time.setAttribute('aria-label', 'Duration');
        var harmonic = row.querySelector('.studio-harmonic-metric');
        if (harmonic && harmonic.parentNode) harmonic.parentNode.insertBefore(time, harmonic.nextSibling);
        else row.appendChild(time);
      }
      if (time.textContent !== value) time.textContent = value;
    });
  }

  // ---- chart: zone shading behind the plot, plot offsets for the phase band ------------------------------
  function styleChart(chart) {
    if (!document.body.hasAttribute('data-ph-region') || !chart.canvas || chart.canvas.id !== 'bpmChart') return;
    var options = chart.config && chart.config.options;
    if (!options) return;
    var light = document.body.classList.contains('light-mode');
    var label = light ? '#3d4452' : '#c4c8d0', grid = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
    var font = { size: 12, weight: '600' };
    options.layout = options.layout || {};
    options.layout.padding = Object.assign({}, options.layout.padding, { bottom: 6 });
    ['x', 'y'].forEach(function (axis) {
      var scale = options.scales && options.scales[axis];
      if (!scale) return;
      scale.ticks = Object.assign({}, scale.ticks, { color: label, font: font });
      scale.grid = Object.assign({}, scale.grid, { color: grid });
      if (scale.title) scale.title = Object.assign({}, scale.title, { color: label, display: false });
    });
    ((chart.config.data && chart.config.data.datasets) || []).forEach(function (dataset) {
      if (dataset.pointRadius === 8) { dataset.pointHoverRadius = 11; dataset.pointHitRadius = 14; }
    });
  }

  function registerChartPlugin() {
    if (typeof Chart === 'undefined' || !Chart.register || registerChartPlugin.done) return;
    registerChartPlugin.done = true;
    var zones = ['rgba(120,170,200,0.07)', 'rgba(230,170,40,0.07)', 'rgba(220,60,60,0.11)', 'rgba(230,170,40,0.07)', 'rgba(120,170,200,0.07)'];
    Chart.register({
      id: 'phMagicZones',
      // The redesign's chart styling lives here, not in studio-render.js (shared with the macOS edition): bigger, brighter axis
      // labels, a tight bottom (the BPM axis title is gone), larger hit area on the curve points. Only with the PEAK HOUR look.
      beforeInit: function (chart) { styleChart(chart); },
      beforeDatasetsDraw: function (chart) {
        if (!chart.canvas || chart.canvas.id !== 'bpmChart' || !chart.chartArea) return;
        var area = chart.chartArea, ctx = chart.ctx, width = (area.right - area.left) / zones.length;
        ctx.save();
        zones.forEach(function (color, i) {
          ctx.fillStyle = color;
          ctx.fillRect(area.left + i * width, area.top, width, area.bottom - area.top);
          if (i) {
            ctx.fillStyle = 'rgba(255,255,255,0.10)';
            ctx.fillRect(area.left + i * width, area.top, 1, area.bottom - area.top);
          }
        });
        ctx.restore();
      },
      afterLayout: function (chart) {
        if (!chart.canvas || chart.canvas.id !== 'bpmChart' || !chart.chartArea) return;
        var graph = chart.canvas.parentElement;
        if (!graph) return;
        var left = Math.round(chart.canvas.offsetLeft + chart.chartArea.left);
        var right = Math.round(chart.canvas.offsetLeft + chart.chartArea.right);
        var top = Math.round(chart.canvas.offsetTop + chart.chartArea.top);
        var bottom = Math.round(chart.canvas.offsetTop + chart.chartArea.bottom);
        if (graph.dataset.plot !== [left, right, top, bottom].join()) {
          graph.dataset.plot = [left, right, top, bottom].join();
          graph.style.setProperty('--wms-plot-left', left + 'px');
          graph.style.setProperty('--wms-plot-right', right + 'px');
          graph.style.setProperty('--wms-plot-top', top + 'px');
          graph.style.setProperty('--wms-plot-bottom', bottom + 'px');
        }
      }
    });
  }

  // ---- plumbing ---------------------------------------------------------------------------------------------
  function refresh() {
    pending = false;
    updateFlow(); updateChips(); updateScore(); updateHints(); updateRoute(); decorateRows();
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(refresh);
  }

  function init() {
    registerChartPlugin();
    var flow = $('magic-flow');
    if (flow) flow.addEventListener('click', function (event) {
      var li = event.target.closest && event.target.closest('[data-magic-step]');
      if (li) flowClick(li.dataset.magicStep);
    });
    var observer = new MutationObserver(schedule);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    ['magic-score-value', 'magic-score-label', 'magic-dot-track-count', 'studio-set-runtime', 'studio-set-track-count', 'magic-set-subtitle'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    ['active-playlist-container'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true });
    });
    ['btn-optimize', 'btn-build-around-tracks', 'studio-tab-route'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['disabled', 'class', 'aria-pressed'] });
    });
    var controls = $('studio-build-controls');
    if (controls) { controls.addEventListener('change', schedule); controls.addEventListener('click', schedule); }
    var graph = $('graph-container');
    if (graph) graph.addEventListener('click', function () { setTimeout(schedule, 30); });
    window.addEventListener('resize', schedule);
    // BPM points look draggable: the pointer turns into a vertical-resize arrow over one, a crosshair elsewhere
    var canvas = $('bpmChart'), cursorPending = false;
    if (canvas) canvas.addEventListener('mousemove', function (event) {
      if (cursorPending) return;
      cursorPending = true;
      requestAnimationFrame(function () {
        cursorPending = false;
        try {
          if (event.buttons) return;
          var rect = canvas.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
          var near = bpmChartInstance.getDatasetMeta(1).data.some(function (pt) { return Math.hypot(pt.x - mx, pt.y - my) < 20; });
          canvas.style.cursor = near ? 'ns-resize' : 'crosshair';
        } catch (e) { /* no chart yet */ }
      });
    }, { passive: true });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.AxiomWindowsMagicSet = { refresh: refresh };
})();
