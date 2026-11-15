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

  // ---- fill one segment ---------------------------------------------------------------------------------------
  // The five timeline segments (the chart's phase band, the Manual Build energy ladder) each get a Fill button that runs the
  // existing autoFillSegment (studio-folders.js) for that slice of the set. The page's own model puts song i at i x "Avg Mix"
  // minutes (that is how the "Your set" line is drawn), so segment k holds the songs whose index falls in its fifth of the
  // timeline. Songs are only ever appended: a segment that still has room is the last one with songs, so nothing the DJ placed
  // moves, and a segment can only be filled once the ones before it are full (otherwise its songs would land in an earlier one).
  var SEGMENTS = [
    { name: 'Warm-up', lower: 'warm-up' }, { name: 'Build', lower: 'build' }, { name: 'Peak', lower: 'peak' },
    { name: 'Drive', lower: 'drive' }, { name: 'Cool-down', lower: 'cool-down' }
  ];
  var fill = { running: false, seg: -1, result: null };

  function numberValue(id, fallback) {
    var el = $(id), value = el ? parseFloat(el.value) : NaN;
    return value > 0 ? value : fallback;
  }
  function geometry() {
    var setLen = numberValue('set-length-selector', 120), avg = Math.max(0.5, numberValue('avg-duration-selector', 2));
    var n = workingCount(), segLen = setLen / 5;
    var segs = SEGMENTS.map(function (s, k) {
      var start = Math.ceil(k * segLen / avg - 1e-6), end = Math.ceil((k + 1) * segLen / avg - 1e-6);
      var expected = Math.max(0, end - start), count = Math.max(0, Math.min(n, end) - start);
      return { k: k, name: s.name, lower: s.lower, start: start, end: end, expected: expected, count: count, room: Math.max(0, expected - count) };
    });
    return { setLen: setLen, avg: avg, n: n, segs: segs };
  }
  function otherJobRunning() {
    return safe(function () {
      return !!(fillSetFromBPMPoints.busy || buildMagicSetAroundWorkingTracks.busy || generateSetFromAnchor.busy || (autoFillSegment.busy && !fill.running));
    }, false);
  }
  function globalReason(ignoreOwn) {
    if (safe(function () { return libraryHasTracks; }, null) === false) return 'Your Library is empty. Add songs in Library first.';
    if (fill.running && !ignoreOwn) return 'Filling...';
    if (otherJobRunning()) return 'Another Magic Set job is running. Fill works again when it finishes.';
    return '';
  }
  function segReason(g, s) {
    if (s.expected < 1) return s.name + ' is too short at this set length and mix length.';
    if (s.room < 1) return s.name + ' is full (' + s.count + ' of ' + s.expected + ' songs).';
    if (g.n < s.start) return 'Fill ' + g.segs[s.k - 1].name + ' first. Songs are added in order along the timeline.';
    return '';
  }
  // Where the buttons live: inside each phase-band cell of the chart (with the footer's "Fill empty segments" and a result chip over
  // the plot, so the chart keeps its height), and in Manual Build under the energy ladder (a strip of five, then a bar).
  function segButton(host, k) {
    return '<button type="button" class="wms-fill-seg" data-axiom-cta-skip="true" data-host="' + host + '" data-seg="' + k + '" aria-describedby="wms-why-' + host + '-' + k + '"></button>' +
      '<span class="wms-fill-why" id="wms-why-' + host + '-' + k + '"></span>';
  }
  function resultHtml(id, extra) {
    return '<span id="' + id + '" class="wms-fill-result" role="status" aria-live="polite"' + (extra || '') + '><span class="wms-fill-msg"></span>' +
      '<button type="button" class="wms-fill-undo" data-axiom-cta-skip="true" hidden></button>' +
      '<button type="button" class="wms-fill-dismiss" data-axiom-cta-skip="true" aria-label="Dismiss this message" hidden>Dismiss</button></span>';
  }
  function allButton(id) {
    return '<button type="button" id="' + id + '" class="wms-fill-all" data-axiom-cta-skip="true" title="Fill every segment that has room">Fill empty segments</button>';
  }
  function ensureFill() {
    if (!document.body.hasAttribute('data-ph-region')) return false;
    var graph = $('graph-container'), ladder = $('energy-ladder'), workspace = $('studio-workspace');
    if (!graph || !ladder || !workspace || !ladder.parentNode) return false;
    var band = graph.querySelector('.magic-phase-band'), footer = $('magic-chart-footer');
    if (band) Array.prototype.forEach.call(band.children, function (cell, k) {
      if (k < SEGMENTS.length && !cell.querySelector('.wms-fill-seg')) {
        cell.insertAdjacentHTML('beforeend', '<b class="wms-fill-count" data-seg="' + k + '"></b>' + segButton('chart', k));
      }
    });
    if (footer && !$('wms-fill-all-chart')) {
      var stats = footer.querySelector('.magic-chart-stats');
      footer.insertBefore(document.createRange().createContextualFragment(allButton('wms-fill-all-chart')), stats || null);
    }
    if (!$('wms-fill-result-chart')) graph.insertAdjacentHTML('beforeend', resultHtml('wms-fill-result-chart', ' hidden'));
    if (!$('wms-fill-ladder')) {
      var cells = SEGMENTS.map(function (s, k) { return '<div class="wms-fill-cell">' + segButton('ladder', k) + '<b class="wms-fill-count" data-seg="' + k + '"></b></div>'; }).join('');
      ladder.insertAdjacentHTML('afterend', '<div id="wms-fill-ladder" class="wms-fill-strip" role="group" aria-label="Fill one segment of the set">' + cells + '</div>' +
        '<div id="wms-fill-bar" class="wms-fill-bar">' + allButton('wms-fill-all-manual') + resultHtml('wms-fill-result-manual') + '<span id="wms-fill-hint" class="wms-fill-hint"></span></div>');
    }
    if (!workspace.dataset.fillWired) {
      workspace.dataset.fillWired = '1';
      workspace.addEventListener('click', function (event) {
        var target = event.target.closest && event.target.closest('button');
        if (!target || target.disabled) return;
        if (target.classList.contains('wms-fill-seg')) runFill(Number(target.dataset.seg));
        else if (target.classList.contains('wms-fill-all')) runFill(null);
        else if (target.classList.contains('wms-fill-undo')) undoFill();
        else if (target.classList.contains('wms-fill-dismiss')) { fill.result = null; updateFill(); }
        else return;
        event.stopPropagation();
      });
    }
    return true;
  }
  function setText(el, value) { if (el && el.textContent !== value) el.textContent = value; }
  function setAttr(el, name, value) { if (el && el.getAttribute(name) !== value) el.setAttribute(name, value); }
  // the words on a disabled button (the full sentence is its title and the screen-reader description)
  function shortReason(g, s, gr) {
    if (gr) return fill.running ? 'Wait' : (/Library/.test(gr) ? 'Library empty' : 'Busy');
    if (s.expected < 1) return 'Too short';
    if (s.room < 1) return 'Full';
    return 'Needs ' + g.segs[s.k - 1].name;
  }
  function updateFill() {
    if (!ensureFill()) return;
    var g = geometry(), gr = globalReason(false);
    var full = [], waiting = [], anyCan = false;
    g.segs.forEach(function (s) {
      s.reason = gr || segReason(g, s);
      s.can = !s.reason;
      s.short = s.can ? '' : shortReason(g, s, gr);
      if (s.can) anyCan = true;
      else if (!gr) (s.room < 1 && s.expected > 0 ? full : waiting).push(s.name);
    });
    document.querySelectorAll('.wms-fill-seg').forEach(function (btn) {
      var s = g.segs[Number(btn.dataset.seg)];
      var busy = fill.running && fill.seg === s.k;
      var description = s.reason && !busy ? s.reason : 'Add up to ' + plural(s.room, 'matching song') + ' to ' + s.name + ' (' + s.count + ' of ' + s.expected + ' there now).';
      setText(btn, busy ? 'Filling...' : (s.can ? 'Fill ' + s.lower : s.short));
      btn.disabled = !s.can;
      setAttr(btn, 'aria-label', 'Fill ' + s.lower + ', ' + s.count + ' of ' + s.expected + ' songs' + (s.can || busy ? '' : '. ' + s.reason));
      setAttr(btn, 'title', description);
      setText($(btn.getAttribute('aria-describedby')), description);
    });
    document.querySelectorAll('.wms-fill-count').forEach(function (el) {
      var s = g.segs[Number(el.dataset.seg)];
      setText(el, s.count + '/' + s.expected);
      setAttr(el, 'aria-hidden', 'true');
    });
    var allRunning = fill.running && fill.seg === -2;
    document.querySelectorAll('.wms-fill-all').forEach(function (all) {
      all.disabled = !anyCan;
      setText(all, allRunning ? 'Filling...' : 'Fill empty segments');
      setAttr(all, 'title', anyCan ? 'Fill every segment that has room, one after another. Your songs stay where they are.' : (gr || 'Every segment is full or waiting on an earlier one.'));
    });
    var hint = '';
    if (fill.running) hint = 'Filling ' + (fill.seg >= 0 ? g.segs[fill.seg].name : 'the set') + '. Fill buttons wait until it finishes.';
    else if (gr) hint = gr;
    else {
      if (full.length) hint += 'Full: ' + full.join(', ') + '. ';
      if (waiting.length) hint += 'Fill earlier segments first: ' + waiting.join(', ') + '.';
    }
    setText($('wms-fill-hint'), hint.trim());
    var result = fill.result, present = 0;
    if (result && result.paths.length) {
      var wanted = {};
      result.paths.forEach(function (p) { wanted[p] = 1; });
      present = safe(function () { return currentPlaylist.filter(function (t) { return wanted[t && t.path]; }).length; }, 0);
    }
    document.querySelectorAll('.wms-fill-result').forEach(function (box) {
      setText(box.querySelector('.wms-fill-msg'), result ? result.text : '');
      setAttr(box.querySelector('.wms-fill-msg'), 'data-tone', result ? result.tone : '');
      var undo = box.querySelector('.wms-fill-undo'), dismiss = box.querySelector('.wms-fill-dismiss');
      undo.hidden = !(present > 0);
      if (present > 0) { setText(undo, 'Remove the ' + present + ' added ' + (present === 1 ? 'song' : 'songs')); undo.disabled = fill.running || otherJobRunning(); }
      dismiss.hidden = !result || fill.running;
      if (box.id === 'wms-fill-result-chart') box.hidden = !result;
    });
  }

  function curveBpm(g) {
    var dots = safe(function () {
      return graphDots.map(function (d) { return { x: Number(d.x), y: Number(d.y) }; })
        .filter(function (d) { return isFinite(d.x) && isFinite(d.y); }).sort(function (a, b) { return a.x - b.x; });
    }, []);
    if (dots.length < 2) dots = [{ x: 0, y: numberValue('blueprint-start-bpm', 120) }, { x: g.setLen, y: numberValue('blueprint-end-bpm', 128) }];
    return function (t) {
      if (t <= dots[0].x) return dots[0].y;
      for (var i = 1; i < dots.length; i++) {
        if (t <= dots[i].x) {
          var span = dots[i].x - dots[i - 1].x;
          return span <= 0 ? dots[i].y : dots[i - 1].y + (dots[i].y - dots[i - 1].y) * (t - dots[i - 1].x) / span;
        }
      }
      return dots[dots.length - 1].y;
    };
  }
  function plainError(message) {
    var text = String(message || '').replace(/^Sub-segment \d+:\s*/, '').trim();
    if (!text || /^HTTP \d+$/.test(text)) return 'the server could not fill it' + (text ? ' (' + text + ')' : '') + '. Try again in a moment';
    if (/failed to fetch|networkerror|load failed/i.test(text)) return 'PEAK HOUR could not reach its server. Check that the app is still running';
    return text;
  }

  // One segment: ask autoFillSegment for the slots after the last song, up to the segment's end. Returns what was really added.
  async function fillOne(k) {
    var g = geometry(), s = g.segs[k];
    if (s.room < 1 || g.n < s.start) return { added: [], skipped: true };
    var before = {};
    safe(function () { currentPlaylist.forEach(function (t) { before[t && t.path] = 1; }); }, 0);
    var t0 = g.n * g.avg, t1 = s.end * g.avg, bpmAt = curveBpm(g);
    var out = await autoFillSegment({ segStart: { x: t0, y: bpmAt(t0) }, segEnd: { x: t1, y: bpmAt(t1) }, bpmAt: bpmAt, maxTracks: s.room, quiet: true });
    var added = safe(function () { return currentPlaylist.filter(function (t) { return t && !before[t.path]; }).map(function (t) { return t.path; }); }, []);
    return { added: added, room: s.room, name: s.name, error: out && out.error, stale: !!(out && out.stale), skipped: !!(out && out.skipped) };
  }

  async function runFill(only) {
    if (fill.running || typeof autoFillSegment !== 'function') return;
    if (globalReason(false)) return;
    fill.running = true; fill.seg = only === null ? -2 : only; fill.result = null;
    updateFill();
    var paths = [], parts = [], notes = [], tone = 'ok', stopped = '';
    try {
      var licensed = true;
      if (typeof ensureAxiomLicenseUsable === 'function') licensed = await ensureAxiomLicenseUsable('Magic Set');
      if (licensed === false) { stopped = 'Fill did not start: the licence check did not pass.'; tone = 'error'; }
      var order = only === null ? [0, 1, 2, 3, 4] : [only];
      for (var i = 0; i < order.length && !stopped; i++) {
        var k = order[i];
        if (globalReason(true)) { stopped = globalReason(true); tone = 'warn'; break; }
        var g = geometry(), s = g.segs[k];
        if (s.room < 1 || g.n < s.start) { if (only !== null) notes.push(segReason(g, s)); continue; }
        fill.seg = only === null ? k : only;
        updateFill();
        var out = await fillOne(k);
        if (out.skipped) { stopped = 'Another fill is already running.'; tone = 'warn'; break; }
        if (out.stale) { stopped = 'Your set changed while ' + s.name + ' was filling, so those songs were not added. Your edits were kept.'; tone = 'warn'; break; }
        if (out.error) { stopped = 'Could not fill ' + s.name + ': ' + plainError(out.error) + '.'; tone = 'error'; if (out.added.length) { paths = paths.concat(out.added); parts.push(s.name + ' ' + out.added.length); } break; }
        if (out.added.length) {
          paths = paths.concat(out.added);
          parts.push(s.name + ' ' + out.added.length);
          if (only !== null) notes.push('Added ' + plural(out.added.length, 'song') + ' to ' + s.name + (out.added.length < out.room ? '. ' + plural(out.room - out.added.length, 'slot') + ' left open, widen the BPM range to find more' : ''));
        } else {
          notes.push('No matching songs found for ' + s.name + ' — widen the BPM range');
          if (tone === 'ok') tone = 'warn';
        }
      }
    } catch (error) {
      stopped = 'Could not fill the set: ' + plainError(error && error.message) + '.';
      tone = 'error';
    }
    var text;
    if (only !== null && !stopped) text = notes.join(' ');
    else if (only === null && !stopped) text = paths.length
      ? 'Added ' + plural(paths.length, 'song') + ' (' + parts.join(', ') + ')' + (notes.length ? '. ' + notes.join('. ') : '')
      : (notes.length ? notes.join('. ') : 'Nothing to fill: every segment is full.');
    else text = (paths.length ? 'Added ' + plural(paths.length, 'song') + ' (' + parts.join(', ') + '). ' : '') + stopped;
    fill.running = false; fill.seg = -1;
    fill.result = { text: text, tone: tone, paths: paths };
    updateFill();
  }

  async function undoFill() {
    var result = fill.result;
    if (!result || !result.paths.length || fill.running || otherJobRunning()) return;
    var gone = {};
    result.paths.forEach(function (p) { gone[p] = 1; });
    var kept = currentPlaylist.filter(function (t) { return !(t && gone[t.path]); });
    var removed = currentPlaylist.length - kept.length;
    if (!removed) return;
    saveHistory();
    currentPlaylist = kept;
    safe(function () { syncEditingPlaylistIfNeeded(); }, 0);
    safe(function () { updateStudioToolsAvailability(); }, 0);
    fill.result = { text: 'Removed ' + plural(removed, 'song') + ' you had just added.', tone: 'ok', paths: [] };
    updateFill();
    await recalculateAudit();
  }

  // ---- plumbing ---------------------------------------------------------------------------------------------
  function refresh() {
    pending = false;
    updateFlow(); updateChips(); updateScore(); updateHints(); updateRoute(); decorateRows(); updateFill();
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
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ph-region'] });
    ['magic-score-value', 'magic-score-label', 'magic-dot-track-count', 'studio-set-runtime', 'studio-set-track-count', 'magic-set-subtitle'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
    ['active-playlist-container'].forEach(function (id) {
      var el = $(id);
      if (el) observer.observe(el, { childList: true });
    });
    ['btn-optimize', 'btn-build-around-tracks', 'btn-magic-set', 'btn-generate-from-anchor', 'studio-tab-route'].forEach(function (id) {
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
  window.AxiomWindowsMagicSet = { refresh: refresh, fillRunning: function () { return fill.running; } };
})();
