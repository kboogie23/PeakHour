/* Shared cache-only metadata editor for Library and Studio track surfaces. */
    let rootIntelligenceUpdateActive = false;

    async function runRootIntelligenceUpdate(route, payload) {
      if (rootIntelligenceUpdateActive) throw new Error('A Root Intelligence update is already running.');
      rootIntelligenceUpdateActive = true;
      const panel = document.createElement('div');
      panel.id = 'axiom-root-update-progress';
      panel.setAttribute('role', 'status');
      panel.style.cssText = 'position:fixed;top:70px;right:16px;width:320px;max-width:calc(100vw - 32px);z-index:11000;padding:12px;background:#101510;color:#f2f6ef;border:1px solid #5b6c50;border-radius:4px';
      const text = document.createElement('div');
      text.setAttribute('aria-live', 'polite');
      text.textContent = 'Reading Root Intelligence...';
      const progress = document.createElement('progress');
      progress.style.cssText = 'width:100%;margin:8px 0';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel Update';
      cancel.style.cssText = 'padding:6px 10px;background:#243021;color:#f2f6ef;border:1px solid #5b6c50;border-radius:4px';
      panel.append(text, progress, cancel);
      document.body.appendChild(panel);
      let identifier = '', cancellationRequested = false;
      async function requestRootUpdate(url, options = {}) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, {...options, signal: controller.signal});
          const data = await response.json();
          if (!response.ok || data.success === false) throw new Error(data.error || 'Root Intelligence update could not finish.');
          return data;
        } catch (error) {
          if (error.name === 'AbortError') throw new Error('Update status timed out. It may still finish; refresh Health before retrying.');
          throw error;
        } finally { window.clearTimeout(timer); }
      }
      async function sendCancel() {
        if (!identifier) return;
        cancel.disabled = true;
        try {
          await requestRootUpdate(`/api/library/root_updates/${identifier}/cancel`, {method: 'POST'});
          text.textContent = 'Stopping before saving...';
        } catch (error) { cancel.disabled = false; showToast(error.message, true); }
      }
      cancel.onclick = () => { cancellationRequested = true; void sendCancel(); };
      try {
        let data = await requestRootUpdate(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...payload, background: true})});
        if (!data.job?.id) throw new Error('Update did not return a tracked job. No completion was claimed.');
        identifier = data.job.id;
        if (cancellationRequested) await sendCancel();
        const deadline = Date.now() + 150000;
        while (['queued', 'running', 'saving'].includes(data.job.status)) {
          const job = data.job;
          text.textContent = `${job.phase} | ${Number(job.checked || 0).toLocaleString()} / ${Number(job.total || 0).toLocaleString()} | ${Number(job.elapsed_seconds || 0).toFixed(0)}s`;
          progress.max = Math.max(1, Number(job.total || 0));
          progress.value = Math.min(progress.max, Number(job.checked || 0));
          cancel.disabled = job.status === 'saving' || Boolean(job.cancel_requested);
          if (Date.now() > deadline) throw new Error('Update is taking too long. Refresh Health to check the saved result before retrying.');
          await new Promise(resolve => window.setTimeout(resolve, 350));
          data = await requestRootUpdate(`/api/library/root_updates/${identifier}`, {cache: 'no-store'});
          if (!data.job || data.job.id !== identifier) throw new Error('Update identity could not be verified. Refresh Health before retrying.');
        }
        if (data.job.status !== 'complete' || data.job.result?.success !== true) throw new Error(data.job.error || 'Update stopped without a verified completion.');
        return data.job.result;
      } finally {
        panel.remove();
        rootIntelligenceUpdateActive = false;
      }
    }

    function axiomInlinePrompt({ title = 'Edit Value', label = 'Value', value = '', placeholder = '', inputMode = 'text', bpmControls = false, identityControls = false, artist = '', year = '', genre = '', root = '' } = {}) {
      return new Promise(resolve => {
        document.getElementById('axiom-inline-edit-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'axiom-inline-edit-modal';
        modal.className = 'axiom-inline-edit-modal';
        const axiomRootOptions = ['Urban', 'Global', 'Local Music', 'Mashup / Edits', 'Electronic', 'Pop', 'Utility'];
        const rootOptions = ['<option value="">Choose root</option>']
          .concat(axiomRootOptions.map(option => `<option value="${escapeHtml(option)}"${option === root ? ' selected' : ''}>${escapeHtml(option)}</option>`))
          .join('');
        const valueControl = identityControls ? `
          <div class="axiom-inline-edit-identity-grid">
            <div>
              <label class="axiom-inline-edit-label" for="axiom-inline-edit-input">Song Title</label>
              <input id="axiom-inline-edit-input" class="axiom-inline-edit-input axiom-inline-edit-title-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder || 'Song title')}" inputmode="${escapeHtml(inputMode)}" autocomplete="off">
            </div>
            <div>
              <label class="axiom-inline-edit-label" for="axiom-inline-edit-artist">Artist</label>
              <input id="axiom-inline-edit-artist" class="axiom-inline-edit-input axiom-inline-edit-artist-input" value="${escapeHtml(artist)}" placeholder="Artist name" autocomplete="off">
            </div>
          </div>
        ` : bpmControls ? `
          <div class="axiom-inline-edit-bpm-control">
            <button type="button" class="axiom-inline-edit-step" data-bpm-step="-1" aria-label="Decrease BPM by 1">&minus;</button>
            <input id="axiom-inline-edit-input" class="axiom-inline-edit-input" type="number" min="20" max="300" step="0.1" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" inputmode="${escapeHtml(inputMode)}" autocomplete="off">
            <button type="button" class="axiom-inline-edit-step" data-bpm-step="1" aria-label="Increase BPM by 1">+</button>
          </div>
          <div class="axiom-inline-edit-metadata-grid">
            <div>
              <label class="axiom-inline-edit-label axiom-inline-edit-year-label" for="axiom-inline-edit-year">Release Year</label>
              <input id="axiom-inline-edit-year" class="axiom-inline-edit-input axiom-inline-edit-year-input" type="number" min="1900" max="${new Date().getFullYear() + 1}" step="1" value="${escapeHtml(year)}" placeholder="YYYY" inputmode="numeric" autocomplete="off">
            </div>
            <div>
              <label class="axiom-inline-edit-label axiom-inline-edit-year-label" for="axiom-inline-edit-root">AXIOM Root</label>
              <select id="axiom-inline-edit-root" class="axiom-inline-edit-input axiom-inline-edit-select">${rootOptions}</select>
            </div>
          </div>
          <label class="axiom-inline-edit-label axiom-inline-edit-genre-label" for="axiom-inline-edit-genre">Genre</label>
          <input id="axiom-inline-edit-genre" class="axiom-inline-edit-input axiom-inline-edit-genre-input" value="${escapeHtml(genre)}" placeholder="House, Hip-Hop, Pop..." autocomplete="off">
        ` : `
          <input id="axiom-inline-edit-input" class="axiom-inline-edit-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" inputmode="${escapeHtml(inputMode)}" autocomplete="off">
        `;
        modal.innerHTML = `
          <div class="axiom-inline-edit-card" role="dialog" aria-modal="true" aria-labelledby="axiom-inline-edit-title">
            <div class="axiom-inline-edit-kicker">AXIOM CACHE EDIT</div>
            <h3 id="axiom-inline-edit-title">${escapeHtml(title)}</h3>
            ${identityControls ? '' : `<label class="axiom-inline-edit-label" for="axiom-inline-edit-input">${escapeHtml(label)}</label>`}
            ${valueControl}
            <p class="axiom-inline-edit-note">Updates AXIOM intelligence only. Source audio stays untouched.</p>
            <div class="axiom-inline-edit-actions">
              <button type="button" class="axiom-inline-edit-cancel">Cancel</button>
              <button type="button" class="axiom-inline-edit-save">Save</button>
            </div>
          </div>
        `;
        const close = result => {
          modal.remove();
          resolve(result);
        };
        const readResult = () => {
          const inputValue = modal.querySelector('#axiom-inline-edit-input')?.value || '';
          if (identityControls) {
            return {
              title: inputValue,
              artist: modal.querySelector('#axiom-inline-edit-artist')?.value || ''
            };
          }
          if (!bpmControls) return inputValue;
          return {
            bpm: inputValue,
            year: modal.querySelector('#axiom-inline-edit-year')?.value || '',
            genre: modal.querySelector('#axiom-inline-edit-genre')?.value || '',
            root: modal.querySelector('#axiom-inline-edit-root')?.value || ''
          };
        };
        modal.querySelector('.axiom-inline-edit-cancel')?.addEventListener('click', () => close(null));
        modal.querySelector('.axiom-inline-edit-save')?.addEventListener('click', () => close(readResult()));
        modal.querySelectorAll('[data-bpm-step]').forEach(button => {
          button.addEventListener('click', () => {
            const input = modal.querySelector('#axiom-inline-edit-input');
            const current = parseFloat(input?.value || '');
            const baseline = Number.isFinite(current) ? current : 128;
            const step = Number(button.dataset.bpmStep || 0);
            const next = Math.min(300, Math.max(20, Math.round((baseline + step) * 10) / 10));
            if (input) {
              input.value = next.toFixed(1);
              input.focus();
              input.select();
            }
          });
        });
        // A drag from an input onto the backdrop produces a backdrop click in
        // WebKit. Only dismiss when the gesture also began on the backdrop.
        let backdropPressed = false;
        modal.addEventListener('pointerdown', event => {
          backdropPressed = event.target === modal && event.button === 0;
        });
        modal.addEventListener('pointercancel', () => { backdropPressed = false; });
        modal.addEventListener('click', event => {
          if (backdropPressed && event.target === modal) close(null);
          backdropPressed = false;
        });
        modal.addEventListener('keydown', event => {
          if (event.key === 'Escape') close(null);
          if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON') close(readResult());
        });
        document.body.appendChild(modal);
        const input = modal.querySelector('#axiom-inline-edit-input');
        input?.focus();
        input?.select();
      });
    }

    function normalizeManualTrackText(value = '') {
      return String(value || '').trim().replace(/\s+/g, ' ');
    }

    async function promptEditTrackIdentity(path, currentTitle = '', currentArtist = '') {
      if (!path) return false;
      const cachedTrack = typeof trackVisualCache !== 'undefined' ? trackVisualCache.get(path) : null;
      const playlistTrack = typeof currentPlaylist !== 'undefined' && Array.isArray(currentPlaylist)
        ? currentPlaylist.find(track => track?.path === path)
        : null;
      const metadataTrack = cachedTrack || playlistTrack || {};
      const edited = await axiomInlinePrompt({
        title: 'Edit Song',
        label: 'Song Title',
        value: currentTitle || metadataTrack.title || '',
        artist: currentArtist || metadataTrack.artist || '',
        placeholder: 'Song title',
        identityControls: true
      });
      if (edited === null) return false;
      const title = normalizeManualTrackText(edited.title);
      const artist = normalizeManualTrackText(edited.artist);
      if (!title || !artist) {
        showToast('Enter both a song title and artist name.', true);
        return false;
      }
      showToast('Updating song details inside AXIOM...');
      try {
        const resp = await fetch('/api/library/update_track_metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, title, artist })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
          showToast(data.error || 'Song details could not be updated. Source audio remains protected.', true);
          return false;
        }
        const updated = data.track || {};
        const nextTitle = updated.title || title;
        const nextArtist = updated.artist || artist;
        propagateTrackMetadata(path, { title: nextTitle, artist: nextArtist }, updated);
        updateVisibleLibraryPreparationRow(path, { ...updated, title: nextTitle, artist: nextArtist });
        if (activeLibraryPreparationSession?.path === path) {
          updateLibraryTrackPreparationModal({ ...activeLibraryPreparationSession.track, ...updated, title: nextTitle, artist: nextArtist });
        }
        showToast(data.message || 'Song details updated inside AXIOM. Source audio remains untouched.');
        runSearch();
        if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
        if (document.getElementById('lib-suggestions-list').innerHTML.trim() !== '') resetAndFetchLibSuggestions();
        return true;
      } catch (err) {
        showToast('Song details could not be updated. Source audio remains protected.', true);
        console.error('Track identity update error:', err);
        return false;
      }
    }

    async function promptSetBpm(path, currentBpm, currentYear = 0) {
      if (!path) return;
      const prefill = currentBpm ? parseFloat(currentBpm).toFixed(1) : '';
      const cachedTrack = typeof trackVisualCache !== 'undefined' ? trackVisualCache.get(path) : null;
      const playlistTrack = typeof currentPlaylist !== 'undefined' && Array.isArray(currentPlaylist)
        ? currentPlaylist.find(track => track?.path === path)
        : null;
      const resolvedYear = Number(
        currentYear
        || cachedTrack?.year
        || cachedTrack?.release_year
        || playlistTrack?.year
        || playlistTrack?.release_year
        || 0
      );
      const metadataTrack = cachedTrack || playlistTrack || {};
      const resolvedGenre = String(metadataTrack.genre || metadataTrack.dna_genre || '').trim();
      const inferredRoot = getRootFromSuggestion(metadataTrack) || '';
      const validRoots = new Set(['Urban', 'Global', 'Local Music', 'Mashup / Edits', 'Electronic', 'Pop', 'Utility']);
      const resolvedRoot = validRoots.has(inferredRoot) ? inferredRoot : '';
      const edited = await axiomInlinePrompt({
        title: 'Edit Track Data',
        label: 'Correct BPM',
        value: prefill,
        placeholder: '128.0',
        inputMode: 'decimal',
        bpmControls: true,
        year: resolvedYear || '',
        genre: resolvedGenre,
        root: resolvedRoot
      });
      if (edited === null) return;
      const newBpm = parseFloat(edited.bpm);
      if (!newBpm || newBpm < 20 || newBpm > 300) {
        showToast('Enter a BPM between 20 and 300', true);
        return;
      }
      const yearText = String(edited.year || '').trim();
      const maxYear = new Date().getFullYear() + 1;
      const newYear = yearText ? Number(yearText) : 0;
      if (yearText && (!/^\d{4}$/.test(yearText) || newYear < 1900 || newYear > maxYear)) {
        showToast(`Enter a year between 1900 and ${maxYear}`, true);
        return;
      }
      const newGenre = String(edited.genre || '').trim().replace(/\s+/g, ' ');
      const newRoot = String(edited.root || '').trim();
      const bpmSaved = await adjustBpm(path, newBpm, '_set');
      if (bpmSaved && newYear && newYear !== resolvedYear) {
        await updateInlineTrackYear(path, newYear);
      }
      if (bpmSaved && (newGenre !== resolvedGenre || newRoot !== resolvedRoot)) {
        await updateInlineTrackGenreRoot(path, newGenre, newRoot);
      }
    }

    async function updateInlineTrackYear(path, year) {
      showToast('Updating release-year intelligence...');
      try {
        const response = await fetch('/api/library/update_year', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, year, source: 'manual' })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          showToast(data.message || 'Release year could not be updated. Source audio remains protected.', true);
          return false;
        }
        const savedYear = Number(data.track?.year || year);
        propagateTrackMetadata(path, { year: savedYear, release_year: savedYear }, data.track || null);
        removeHealthTrackFromView(path, 'missing_year');
        showToast(data.message || `Release year set to ${savedYear}. Source audio remains untouched.`);
        loadLibraryStats();
        runSearch();
        if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
        return true;
      } catch (err) {
        showToast('Release year could not be updated. Source audio remains protected.', true);
        console.error('Year Update Error:', err);
        return false;
      }
    }

    async function updateInlineTrackGenreRoot(path, genre, root) {
      showToast('Updating genre and root intelligence...');
      try {
        const data = await runRootIntelligenceUpdate('/api/library/update_genre', {path, genre, root});
        const updated = data.track || {};
        propagateTrackMetadata(path, {
          genre: updated.genre || genre,
          dna_genre: updated.dna_genre || genre,
          root: updated.root || root,
          dna_root: updated.dna_root || root
        }, updated);
        showToast(data.message || 'Genre and root updated inside AXIOM. Source audio remains untouched.');
        runSearch();
        if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
        if (document.getElementById('lib-suggestions-list')?.innerHTML.trim()) resetAndFetchLibSuggestions();
        return true;
      } catch (err) {
        showToast('Genre and root could not be updated. Source audio remains protected.', true);
        console.error('Genre and root update error:', err);
        return false;
      }
    }

    function formatBpmReceiptValue(value) {
      const normalized = Number(value || 0);
      if (!Number.isFinite(normalized)) return '--';
      return normalized.toFixed(1).replace(/\.0$/, '');
    }

    function bpmUpdateReceipt(action, beforeBpm, afterBpm) {
      const before = formatBpmReceiptValue(beforeBpm);
      const after = formatBpmReceiptValue(afterBpm);
      if (action === 'half') return `BPM HALVED · ${before} → ${after} · AXIOM UPDATED`;
      if (action === 'double') return `BPM DOUBLED · ${before} → ${after} · AXIOM UPDATED`;
      return `BPM UPDATED · ${after} · AXIOM UPDATED`;
    }

    async function adjustBpm(path, currentBpm, action) {
      if (action !== '_set' && (!currentBpm || currentBpm <= 0)) return false;
      let newBpm = currentBpm;
      if (action === 'half') newBpm = currentBpm / 2;
      else if (action === 'double') newBpm = currentBpm * 2;
      else if (action === '_set') newBpm = currentBpm; // already the target value
      else return false;
      newBpm = Math.round(newBpm * 10) / 10;
      const workingVerb = action === 'half' ? 'HALVING' : action === 'double' ? 'DOUBLING' : 'UPDATING';
      const workingChange = action === '_set'
        ? formatBpmReceiptValue(newBpm)
        : `${formatBpmReceiptValue(currentBpm)} → ${formatBpmReceiptValue(newBpm)}`;
      showToast(`${workingVerb} BPM · ${workingChange}`);
      try {
        const resp = await fetch('/api/library/update_bpm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path, bpm: newBpm })
        });
        const data = await resp.json();
        if (data.success) {
          showToast(bpmUpdateReceipt(action, currentBpm, newBpm));
          propagateTrackMetadata(path, { bpm: newBpm, energy: data.track?.energy }, data.track || null);
          removeHealthTrackFromView(path, 'missing_bpm');
          loadLibraryStats();
          runSearch();
          if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
          if (document.getElementById('lib-suggestions-list').innerHTML.trim() !== '') resetAndFetchLibSuggestions();
          initSortable();
          recalculateAudit();
          return true;
        } else {
          showToast(data.error || `BPM intelligence could not be updated. Source audio remains protected.`, true);
          return false;
        }
      } catch (err) {
        showToast(`BPM intelligence could not be updated. Source audio remains protected.`, true);
        console.error("BPM Update Error:", err);
        return false;
      }
    }

    async function promptUpdateGenre(path, currentGenre = '') {
      if (!path) return;
      const typed = await axiomInlinePrompt({
        title: 'Edit Genre',
        label: 'Genre label',
        value: currentGenre || '',
        placeholder: 'Urban, Rap, Global, Top 40...'
      });
      if (typed === null) return;
      const genre = typed.trim().replace(/\s+/g, ' ');
      if (!genre) {
        showToast('Enter a genre label for this track.', true);
        return;
      }

      showToast('Updating genre intelligence...');
      try {
        const data = await runRootIntelligenceUpdate('/api/library/update_genre', {path, genre});

        const updated = data.track || {};
        propagateTrackMetadata(path, { genre: updated.genre || genre, dna_genre: updated.dna_genre || genre }, updated);
        showToast(data.message || `Genre set to ${genre}. Source audio remains untouched.`);
        runSearch();
        if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
        if (document.getElementById('lib-suggestions-list')?.innerHTML.trim()) resetAndFetchLibSuggestions();
      } catch (err) {
        showToast('Genre could not be updated. Source audio remains protected.', true);
        console.error('Genre update error:', err);
      }
    }

    async function promptUpdateKey(path, currentKey = '') {
      if (!path) return;
      const typed = await axiomInlinePrompt({
        title: 'Edit Camelot Key',
        label: 'Camelot key',
        value: currentKey || '',
        placeholder: '8A, 11B, 12A...'
      });
      if (typed === null) return;
      const camelot = typed.trim().toUpperCase();
      if (!/^(?:[1-9]|1[0-2])[AB]$/.test(camelot)) {
        showToast('Use a Camelot key like 1A, 8B, or 12A', true);
        return;
      }

      showToast('Updating harmonic key...');
      try {
        const resp = await fetch('/api/library/update_key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, camelot })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
          showToast(data.error || 'Harmonic key could not be updated. Source audio remains protected.', true);
          return;
        }

        const updated = data.track || {};
        const nextKey = updated.camelot || camelot;
        propagateTrackMetadata(path, { camelot: nextKey, key_raw: updated.key_raw || nextKey }, updated);
        removeHealthTrackFromView(path, 'missing_key');

        showToast(`Harmonic key set to ${nextKey}. Source audio remains untouched.`);
        loadLibraryStats();
        runSearch();
        if (!document.getElementById('replacement-modal')?.classList.contains('hidden')) fetchSuggestions(false);
        if (document.getElementById('lib-suggestions-list').innerHTML.trim() !== '') resetAndFetchLibSuggestions();
        initSortable();
        recalculateAudit();
      } catch (err) {
        showToast(`Harmonic key could not be updated. Source audio remains protected.`, true);
        console.error('Key Update Error:', err);
      }
    }
