// AXIOM Playlists, Favorites, and saved-set browser behavior.

    let playlistVaultReviewReady = false;
    let playlistStorageReadFailed = false;
    function isPlaylistVaultReview() {
      return typeof axiomUiPreviewMode === 'function' && axiomUiPreviewMode() === 'playlist-vault';
    }

    function loadSavedPlaylists() {
      if (isPlaylistVaultReview() && playlistVaultReviewReady) return;
      if (window.AXIOM_ACCESS_CONTEXT?.mode === 'guest') {
        savedPlaylists = [];
        return;
      }
      try {
        const raw = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
        const loaded = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(loaded)) throw new Error('Invalid saved playlist data.');
        savedPlaylists = loaded;
        playlistStorageReadFailed = false;
        return true;
      } catch (err) {
        // Keep both the last usable view and the stored recovery evidence.
        if (!playlistStorageReadFailed && typeof showToast === 'function') {
          showToast('Saved playlists could not be read. They have not been replaced. Use Backup Set for your current work and retry loading Playlists.', true);
        }
        playlistStorageReadFailed = true;
        return false;
      }
    }

    function persistSavedPlaylists() {
      if (isPlaylistVaultReview()) return;
      if (window.AXIOM_ACCESS_CONTEXT?.mode === 'guest') return;
      if (playlistStorageReadFailed) throw new Error('Saved playlists need recovery before they can be changed. Use Backup Set for your current work.');
      // A read can fail between loading and saving; do not overwrite that state.
      const before = localStorage.getItem(PLAYLISTS_STORAGE_KEY);
      if (before !== null && !Array.isArray(JSON.parse(before))) throw new Error('Saved playlist data needs recovery.');
      const text = JSON.stringify(savedPlaylists);
      localStorage.setItem(PLAYLISTS_STORAGE_KEY, text);
      if (localStorage.getItem(PLAYLISTS_STORAGE_KEY) !== text) throw new Error('Playlist save could not be verified. Use Backup Set before quitting.');
    }

    function verifySavedPlaylist(record) {
      if (!record?.id) return false;
      if (loadSavedPlaylists() === false) return false;
      const found = savedPlaylists.find(set => set.id === record.id);
      return Boolean(
        found
        && JSON.stringify(found) === JSON.stringify(record)
      );
    }

    // ── FAVORITES ──────────────────────────────────────────────────────────

    async function loadFavorites() {
      try {
        const resp = await fetch('/api/favorites');
        const data = await resp.json();
        if (!resp.ok || data.error) {
          throw new Error(data.error || 'Favorites could not be loaded.');
        }
        if (data.account_required || data.license_required) {
          favoritesTracks = [];
          _refreshFavoritesNav();
          return;
        }
        favoritesTracks = Array.isArray(data.tracks) ? data.tracks : [];
        // One-time migration: if server is empty but localStorage has data, upload it
        if (favoritesTracks.length === 0) {
          try {
            const legacy = localStorage.getItem(FAVORITES_STORAGE_KEY);
            if (legacy) {
              const legacyTracks = JSON.parse(legacy);
              if (Array.isArray(legacyTracks) && legacyTracks.length > 0) {
                favoritesTracks = legacyTracks;
                if (await _saveFavorites(legacyTracks)) {
                  const verification = await fetch('/api/favorites');
                  const saved = await verification.json();
                  if (verification.ok && !saved.error && !saved.account_required && !saved.license_required
                      && JSON.stringify(saved.tracks) === JSON.stringify(legacyTracks)
                      && localStorage.getItem(FAVORITES_STORAGE_KEY) === legacy) {
                    localStorage.removeItem(FAVORITES_STORAGE_KEY);
                  } else {
                    showToast('Favorites migration could not be verified. Your previous saved copy was kept.', true);
                  }
                }
              }
            }
          } catch (_) {
            showToast('Favorites migration could not be verified. Your previous saved copy was kept.', true);
          }
        }
      } catch (error) {
        showToast(error.message || 'Favorites could not be loaded. Your saved copies were kept.', true);
      }
      _refreshFavoritesNav();
    }

    async function _saveFavorites(nextTracks = null) {
      const save = async () => {
        try {
          // Apply queued edits to the latest confirmed list, then serialize
          // requests so a slow older save cannot overwrite a newer one.
          const proposed = typeof nextTracks === 'function' ? nextTracks(favoritesTracks) : nextTracks || favoritesTracks;
          if (!proposed) return false;
          const snapshot = JSON.parse(JSON.stringify(proposed));
          const resp = await fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: snapshot }),
          });
          const data = await resp.json();
          if (!resp.ok || data.success !== true
              || (data.count !== undefined && Number(data.count) !== snapshot.length)) {
            throw new Error(data.error || 'Favorites could not be saved.');
          }
          favoritesTracks = snapshot;
          _refreshFavoritesNav();
          updateFavoritesStars();
          if (document.getElementById('favorites-panel')?.classList.contains('open')) renderFavoritesPanel();
          return true;
        } catch (error) {
          showToast(error.message || 'Favorites could not be saved. Try again; your saved list was kept.', true);
          return false;
        }
      };
      const pending = (_saveFavorites.queue || Promise.resolve()).then(save, save);
      _saveFavorites.queue = pending;
      return pending;
    }

    function favoritesHasTrack(track) {
      const key = trackIdentity(track);
      return Boolean(key && favoritesTracks.some(t => trackIdentity(t) === key));
    }

    async function toggleFavorite(track) {
      if (!track || !track.path) return;
      if (favoritesHasTrack(track)) {
        if (await removeFromFavorites(track.path)) showToast(`Removed from Favorites: ${track.title || 'Track'}`);
        return;
      }
      await addToFavorites(track);
    }

    async function addToFavorites(track) {
      if (!track || !track.path) return;
      if (favoritesHasTrack(track)) {
        showToast(`Already in Favorites: ${track.title || 'Track'}`, true);
        return;
      }
      const nextTrack = {
        path: track.path,
        title: track.title || track.filename || '',
        artist: track.artist || '',
        bpm: track.bpm || 0,
        camelot: track.camelot || '',
        energy: track.energy || '',
        genre: track.genre || '',
      };
      const saved = await _saveFavorites(current => {
        if (current.some(item => trackIdentity(item) === trackIdentity(nextTrack))) {
          showToast(`Already in Favorites: ${track.title || 'Track'}`, true);
          return null;
        }
        return current.concat(nextTrack);
      });
      if (saved) showToast(`Saved to Favorites: ${track.title || 'Track'}`);
      return saved;
    }

    async function removeFromFavorites(path) {
      return _saveFavorites(current => {
        const remaining = current.filter(t => t.path !== path);
        return remaining.length < current.length ? remaining : null;
      });
    }

    async function clearFavorites() {
      if (!favoritesTracks.length) return;
      if (!confirm(`Remove all ${favoritesTracks.length} tracks from Favorites?`)) return;
      await _saveFavorites([]);
    }

    function _refreshFavoritesNav() {
      const count = favoritesTracks.length;
      // Sidebar badge
      const sidebarBadge = document.getElementById('fav-sidebar-badge');
      if (sidebarBadge) {
        sidebarBadge.textContent = count;
        sidebarBadge.classList.toggle('hidden', count === 0);
      }
      // Panel header badge (kept in sync)
      const panelBadge = document.getElementById('fav-panel-count-badge');
      if (panelBadge) panelBadge.textContent = `${count} track${count !== 1 ? 's' : ''}`;
    }

    /** Refresh star button appearance for all rendered rows without re-rendering. */
    function updateFavoritesStars() {
      document.querySelectorAll('.fav-star-btn[data-fav-path]').forEach(btn => {
        const starred = favoritesTracks.some(track => String(track.path || '') === String(btn.dataset.favPath || ''));
        btn.classList.toggle('fav-star-active', starred);
        btn.title = starred ? 'Remove from Favorites' : 'Add to Favorites';
        btn.innerHTML = starred ? '&#9733;' : '&#9734;';
      });
      document.querySelectorAll('.anchor-decision-btn[data-fav-path]').forEach(btn => {
        const saved = favoritesTracks.some(track => String(track.path || '') === String(btn.dataset.favPath || ''));
        btn.classList.toggle('active', saved);
        btn.title = saved ? 'Remove from saved songs' : 'Save for later';
        btn.textContent = saved ? 'Saved' : 'Save';
      });
    }

    function openFavoritesPanel() {
      const panel = document.getElementById('favorites-panel');
      panel.classList.add('open');
      renderFavoritesPanel();
    }

    function closeFavoritesPanel() {
      document.getElementById('favorites-panel').classList.remove('open');
    }

    function renderFavoritesPanel() {
      const countBadge = document.getElementById('fav-panel-count-badge');
      const trackList = document.getElementById('fav-panel-tracks');
      if (!trackList) return;

      const count = favoritesTracks.length;
      if (countBadge) countBadge.textContent = `${count} track${count !== 1 ? 's' : ''}`;

      if (!count) {
        trackList.innerHTML = '<div id="fav-panel-empty">Star tracks to collect<br>them here</div>';
        return;
      }

      trackList.innerHTML = favoritesTracks.map((t, i) => {
        const safePath = escapeJs(t.path || '');
        const title = escapeHtml(t.title || 'Untitled');
        const artist = escapeHtml(t.artist || 'Unknown Artist');
        const bpm = t.bpm ? `${parseFloat(t.bpm).toFixed(0)} BPM` : '';
        const key = t.camelot ? ` · ${escapeHtml(t.camelot)}` : '';
        const meta = [artist, bpm + key].filter(Boolean).join(' · ');
        return `
          <div class="fav-panel-track">
            <div class="fav-panel-track-info">
              <div class="fav-panel-track-title">${title}</div>
              <div class="fav-panel-track-meta">${meta}</div>
            </div>
            <button class="fav-panel-remove" onclick="removeFromFavorites('${safePath}')" title="Remove">&times;</button>
          </div>`;
      }).join('');
    }

    async function exportFavoritesToSerato() {
      if (!requireAxiomInstalledApp('Favorites Serato export')) return;
      if (!(await ensureAxiomLicenseUsable('Favorites Serato export'))) return;
      if (!favoritesTracks.length) {
        showToast('Favorites is empty.', true);
        return;
      }
      const btn = document.getElementById('btn-export-favorites-serato');
      const defaultName = 'AXIOM Favorites';
      const crateName = await showAxiomTextPrompt({
        kicker: 'Serato Handoff',
        title: 'Name Your Favorites Crate',
        copy: 'This is the crate name that will appear in Serato.',
        defaultValue: defaultName,
        placeholder: 'Serato crate name...',
        confirmText: 'Add To Serato'
      });
      if (!crateName) return;
      const browserDelivery = await prepareAxiomBrowserSeratoDelivery();

      setAxiomButtonBusy(btn, true, 'Exporting...');
      showToast(`Exporting ${favoritesTracks.length} favorite track${favoritesTracks.length === 1 ? '' : 's'} to Serato. Source audio untouched.`);
      try {
        const resp = await fetch('/api/favorites/export_serato', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlist: favoritesTracks, name: crateName }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || 'Export failed');

        await deliverAxiomBrowserSeratoPlaylist(data, browserDelivery);
        downloadAxiomBrowserExportFiles(data);

        const msg = !data.browser_download
          ? `Favorites crate verified with ${Number(data.total_in_crate || data.added_tracks || 0).toLocaleString()} tracks. Fully quit and reopen Serato to load it.`
          : data.browser_root_written
            ? `Favorites playlist ready inside ${data.browser_root_delivery?.folder_name || 'your music folder'} for Serato import.`
            : `Favorites playlist downloaded. Move the MUSIC_FOLDER_ROOT M3U8 into your connected music folder before importing it.`;
        showToast(msg, false);
        showSeratoExportSuccess(data, crateName);
      } catch (err) {
        showToast('Favorites export failed. Source audio untouched.', true);
        console.error('Favorites export error:', err);
      } finally {
        setAxiomButtonBusy(btn, false);
      }
    }

    // ── END FAVORITES ──────────────────────────────────────────────────────

    function makePlaylistId() {
      return `set-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function playlistDurationLabel(tracks) {
      const total = (tracks || []).reduce((sum, track) => sum + (parseFloat(track.duration_min) || 0), 0);
      if (!total) return '';
      if (total >= 60) return `${Math.floor(total / 60)}h ${Math.round(total % 60)}m`;
      return `${Math.round(total)}m`;
    }

    function stableBrowserTrackForSave(track) {
      const copy = { ...(track || {}) };
      const stablePath = copy.export_path || copy.browser_relative_path || copy.relative_path || copy.webkitRelativePath || copy.filename || copy.path;
      if (copy.browser_file && stablePath && /^blob:/i.test(String(copy.path || ''))) {
        copy.path = stablePath;
      }
      if (/^blob:/i.test(String(copy.browser_playback_path || ''))) delete copy.browser_playback_path;
      if (!copy.export_path && stablePath && copy.browser_file) copy.export_path = stablePath;
      if (!copy.browser_relative_path && stablePath && copy.browser_file) copy.browser_relative_path = stablePath;
      return copy;
    }

    function browserSafeExportPath(track = {}) {
      const stable = track.export_path || track.browser_relative_path || track.relative_path || track.webkitRelativePath || '';
      if (stable) return String(stable);
      const path = String(track.path || '');
      if (path && !path.startsWith('blob:') && !path.startsWith('data:') && !path.startsWith('/axiom/demo/')) return path;
      return track.filename || '';
    }

    function exportPreflightSummary(tracks = []) {
      const list = Array.isArray(tracks) ? tracks : [];
      const missingPath = list.filter(track => !browserSafeExportPath(track));
      const missingBpm = list.filter(track => !trackHasUsableBpm(track));
      const missingKey = list.filter(track => !(track.camelot || track.key_raw));
      const missingYear = list.filter(track => !track.year && !track.release_year);
      const healthGapTracks = list.filter(track => (
        !browserSafeExportPath(track)
        || !trackHasUsableBpm(track)
        || !(track.camelot || track.key_raw)
        || (!track.year && !track.release_year)
      )).length;
      return {
        total: list.length,
        missingPath: missingPath.length,
        missingBpm: missingBpm.length,
        missingKey: missingKey.length,
        missingYear: missingYear.length,
        healthGapTracks,
        needsWarning: Boolean(missingPath.length || missingBpm.length || missingKey.length || missingYear.length)
      };
    }

    function exportPreflightMessage(summary = {}, label = 'export') {
      const lines = [];
      if (summary.missingPath) lines.push(`${summary.missingPath} track${summary.missingPath === 1 ? '' : 's'} missing a file path may be skipped or need relinking.`);
      if (summary.missingBpm) lines.push(`${summary.missingBpm} track${summary.missingBpm === 1 ? '' : 's'} missing BPM will weaken set order and DJ app sorting.`);
      if (summary.missingKey) lines.push(`${summary.missingKey} track${summary.missingKey === 1 ? '' : 's'} missing key will weaken harmonic handoff.`);
      if (summary.missingYear) lines.push(`${summary.missingYear} track${summary.missingYear === 1 ? '' : 's'} missing year will weaken era/timeline context.`);
      return [
        `AXIOM found library health issues before this ${label}.`,
        ...lines,
        'You can continue, but Library Health should be fixed for the cleanest crate.'
      ].join('\n\n');
    }

    async function confirmExportPreflight(type, tracks = []) {
      if (type === 'csv' || type === 'serato' || type === 'djay') return true;
      const summary = exportPreflightSummary(tracks);
      if (!summary.needsWarning) return true;
      const label = type === 'serato'
        ? 'Serato handoff'
        : type === 'djay'
          ? 'djay Pro handoff'
        : type === 'xml'
          ? 'Rekordbox XML export'
          : `${String(type || 'set').toUpperCase()} export`;
      return showAxiomConfirm('Review Export Health', exportPreflightMessage(summary, label), 'EXPORT ANYWAY', 'primary');
    }

    function prepareTracksForPlaylistSave(tracks) {
      const stableTracks = (tracks || []).map(stableBrowserTrackForSave);
      return dedupePlaylistTracks(JSON.parse(JSON.stringify(stableTracks)));
    }

    function upsertSavedPlaylist(name, tracks, options = {}) {
      if (loadSavedPlaylists() === false) throw new Error('Saved playlists could not be read. Use Backup Set; your existing playlists have not been replaced.');
      const cleanTracks = prepareTracksForPlaylistSave(tracks);
      if (!cleanTracks.length) return null;
      const normalizedName = String(name || 'AXIOM SET').trim() || 'AXIOM SET';
      const existingIndex = options.forceNew ? -1 : editingPlaylistId
        ? savedPlaylists.findIndex(set => set.id === editingPlaylistId)
        : savedPlaylists.findIndex(set => set.name.toLowerCase() === normalizedName.toLowerCase());
      const existing = existingIndex >= 0 ? savedPlaylists[existingIndex] : null;
      const record = {
        id: existing ? existing.id : makePlaylistId(),
        name: editingPlaylistId && existing ? existing.name : normalizedName,
        tracks: cleanTracks,
        setBrief: options.setBrief || setBriefPayload(),
        updatedAt: new Date().toISOString(),
      };
      if (existingIndex >= 0) savedPlaylists.splice(existingIndex, 1, record);
      else savedPlaylists.unshift(record);
      selectedPlaylistId = record.id;
      persistSavedPlaylists();
      if (!verifySavedPlaylist(record)) {
        throw new Error('AXIOM could not confirm the set in Playlists. Try Backup Set before closing the browser.');
      }
      refreshPlaylistsView();
      return record;
    }

    function getLibraryGapDownloadList() {
      loadSavedPlaylists();
      return savedPlaylists.find(set => set.kind === 'download-later') || null;
    }

    function saveLibraryGapDownloadList() {
      if (window.AXIOM_ACCESS_CONTEXT?.mode === 'guest') {
        showToast('Sign in to save a Download Later list.', true);
        return null;
      }
      const missing = (libraryGapPayload?.results || []).filter(item => item.status === 'not_found');
      if (!missing.length) {
        showToast('There are no missing tracks to save.', true);
        return null;
      }
      loadSavedPlaylists();
      const existingIndex = savedPlaylists.findIndex(set => set.kind === 'download-later');
      const existing = existingIndex >= 0 ? savedPlaylists[existingIndex] : null;
      const existingTracks = Array.isArray(existing?.tracks) ? existing.tracks : [];
      const seen = new Set(existingTracks.map(track => libraryGapSongLineKey(`${track.artist || ''} - ${track.title || ''}`)));
      const nextTracks = existingTracks.slice();
      let addedCount = 0;
      missing.forEach(item => {
        const request = item.requested || {};
        const title = String(request.title || request.raw || 'Missing Track').trim();
        const artist = String(request.artist || 'Unknown Artist').trim();
        const identity = libraryGapSongLineKey(`${artist} - ${title}`);
        if (!identity || seen.has(identity)) return;
        seen.add(identity);
        const requestedVersions = Array.isArray(item.requested_versions) ? item.requested_versions.filter(Boolean) : [];
        nextTracks.push({
          path: `missing://${encodeURIComponent(identity)}`,
          title,
          artist,
          requested_versions: requestedVersions,
          requested_version: requestedVersions.join(' / '),
          is_missing_request: true,
          source: 'library-gap-checker'
        });
        addedCount += 1;
      });
      const record = {
        id: existing?.id || makePlaylistId(),
        name: existing?.name || 'Download Later',
        kind: 'download-later',
        tracks: nextTracks,
        updatedAt: new Date().toISOString()
      };
      if (existingIndex >= 0) savedPlaylists.splice(existingIndex, 1, record);
      else savedPlaylists.unshift(record);
      selectedPlaylistId = record.id;
      persistSavedPlaylists();
      refreshPlaylistsView();
      const button = document.getElementById('gap-recovery-save-list');
      if (button) {
        button.textContent = `Saved ${record.tracks.length} · View List`;
        button.classList.add('saved');
        button.onclick = openLibraryGapDownloadList;
      }
      const message = addedCount
        ? `${addedCount} missing track${addedCount === 1 ? '' : 's'} saved to Playlists > Download Later.`
        : `All ${record.tracks.length} missing tracks are already saved in Playlists > Download Later.`;
      showToast(message);
      return { record, addedCount };
    }

    function openLibraryGapDownloadList() {
      const record = getLibraryGapDownloadList();
      if (!record) {
        showToast('Save missing tracks first.', true);
        return;
      }
      selectedPlaylistId = record.id;
      window.closeLibraryGapRecovery?.();
      showTab('playlists');
      refreshPlaylistsView();
    }

    async function copyDownloadLaterTrack(index, event) {
      event?.stopPropagation?.();
      const set = getSelectedPlaylist();
      const track = set?.kind === 'download-later' ? set.tracks?.[index] : null;
      if (!track) return;
      const query = [track.artist, track.title, track.requested_version].filter(Boolean).join(' ');
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(query);
        else {
          const input = document.createElement('textarea');
          input.value = query;
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        showToast(`Copied search: ${track.artist} - ${track.title}`);
      } catch (_) {
        showToast('Could not copy that search.', true);
      }
    }

    function saveCurrentSetToPlaylists() {
      const sourceTracks = getActiveStudioOutputTracks();
      if (!sourceTracks.length) {
        showToast("Set is empty. Add tracks first.", true);
        return null;
      }
      showSetNameModal(`AXIOM SET ${savedPlaylists.length + 1}`, (name) => {
        if (!name) return;
        try {
          const record = upsertSavedPlaylist(name, sourceTracks);
          if (record) showSaveSetSuccess(record.name, record.tracks.length, 'playlists');
        } catch (err) {
          console.error('Save set failed:', err);
          showToast(err?.message || 'Save failed. Use Backup Set before closing the browser.', true);
        }
      });
    }

    function saveSetToPlaylists(event) {
      if (event) event.preventDefault();
      if (window.AXIOM_REQUIRE_ACCOUNT_FEATURE && !window.AXIOM_REQUIRE_ACCOUNT_FEATURE('Save Set')) return;
      if (!requirePaidStudioFeature('Save Set')) return;
      if (editingPlaylistId) return saveEditedPlaylistFromStudio();
      return saveCurrentSetToPlaylists();
    }

    function saveEditedPlaylistFromStudio() {
      if (window.AXIOM_REQUIRE_ACCOUNT_FEATURE && !window.AXIOM_REQUIRE_ACCOUNT_FEATURE('Save Set')) return true;
      if (!requirePaidStudioFeature('Save Set')) return true;
      if (!editingPlaylistId) return false;
      const set = savedPlaylists.find(item => item.id === editingPlaylistId);
      if (!set) {
        editingPlaylistId = null;
        return false;
      }
      const cleanTracks = prepareTracksForPlaylistSave(getActiveStudioOutputTracks());
      if (!cleanTracks.length) {
        showToast("Set is empty. Add tracks before saving.", true);
        return true;
      }
      try {
        set.tracks = cleanTracks;
        set.setBrief = setBriefPayload();
        set.updatedAt = new Date().toISOString();
        selectedPlaylistId = set.id;
        persistSavedPlaylists();
        if (!verifySavedPlaylist(set)) {
          showToast('Save could not be confirmed in Playlists. Use Backup Set before closing.', true);
          return true;
        }
      } catch (err) {
        console.error('Update saved set failed:', err);
        showToast(err?.message || 'Save failed. Use Backup Set before closing.', true);
        return true;
      }
      refreshPlaylistsView();
      showSaveSetSuccess(set.name, cleanTracks.length, 'updated');
      return true;
    }

    function readPlaylistFile(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = event => {
          try {
            const parsed = JSON.parse(event.target.result);
            resolve({ file, tracks: Array.isArray(parsed) ? parsed : null });
          } catch (err) {
            resolve({ file, tracks: null });
          }
        };
        reader.onerror = () => resolve({ file, tracks: null });
        reader.readAsText(file);
      });
    }

    function importPlaylistFiles() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.multiple = true;
      input.hidden = true;
      input.setAttribute('aria-label', 'Choose playlist JSON files');
      document.body.appendChild(input);
      input.onchange = async e => {
        const files = Array.from(e.target.files || []);
        if (!files.length) {
          input.remove();
          return;
        }
        let imported = 0;
        let failed = 0;
        for (const result of await Promise.all(files.map(readPlaylistFile))) {
          if (!result.tracks || result.tracks.length === 0) {
            failed++;
            continue;
          }
          const name = result.file.name.replace(/\.json$/i, '');
          if (upsertSavedPlaylist(name, result.tracks)) imported++;
        }
        refreshPlaylistsView();
        const msg = failed > 0 ? `Imported ${imported} playlist${imported === 1 ? '' : 's'} — ${failed} skipped` : `Imported ${imported} playlist${imported === 1 ? '' : 's'}`;
        showToast(msg, imported === 0);
        input.remove();
      };
      input.click();
    }

    function refreshPlaylistsView() {
      loadSavedPlaylists();
      if (savedPlaylists.length && !savedPlaylists.some(set => set.id === selectedPlaylistId)) {
        selectedPlaylistId = savedPlaylists[0].id;
      }
      renderSavedPlaylists();
      renderSelectedPlaylist();
    }

    function renderSavedPlaylists() {
      ensurePlaylistVaultStyles();
      const list = document.getElementById('saved-playlists-list');
      const count = document.getElementById('saved-playlists-count');
      if (!list || !count) return;
      count.innerText = savedPlaylists.length;
      if (!savedPlaylists.length) {
        list.innerHTML = `<div class="text-center py-12 text-axiom-muted text-[10px] font-black uppercase tracking-widest">Save a set in Studio to create your first crate</div>`;
        return;
      }
      list.innerHTML = savedPlaylists.map(set => {
        const isDownloadList = set.kind === 'download-later' || set.kind === 'to-buy';
        return `
        <div class="playlist-crate-wrapper" data-playlist-id="${escapeJs(set.id)}">
          <div onclick="selectSavedPlaylist('${escapeJs(set.id)}')"
            class="playlist-crate-row ${isDownloadList ? 'playlist-download-later-crate' : ''} ${set.id === selectedPlaylistId ? 'active' : ''} w-full text-left p-4 cursor-pointer" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectSavedPlaylist('${escapeJs(set.id)}')}">
            <div class="playlist-crate-heading">
              <img class="playlist-crate-art" src="${axiomRecordVaultStaticUrl('assets/record-vault/crate.png')}" alt="" />
              <div class="min-w-0">
                <p class="playlist-crate-title text-white text-sm font-black uppercase truncate">${escapeHtml(set.name)}</p>
                <p class="text-[9px] text-axiom-muted font-black uppercase tracking-widest mt-1">${isDownloadList ? `${set.tracks.length} tracks to ${set.kind === 'to-buy' ? 'buy' : 'download'}` : `${set.tracks.length} tracks ${playlistDurationLabel(set.tracks) ? '//' : ''} ${playlistDurationLabel(set.tracks)}`}</p>
              </div>
            </div><div class="playlist-crate-actions">
                ${isDownloadList ? '' : `<button onclick="editSavedPlaylist('${escapeJs(set.id)}', event)" class="playlist-edit-cta" type="button">Edit Set</button>`}
                ${isDownloadList ? '' : `<button onclick="exportSavedPlaylist('${escapeJs(set.id)}', event)" class="playlist-export-cta" type="button">Export</button>`}
                <button onclick="renameSavedPlaylist('${escapeJs(set.id)}', event)" class="playlist-quiet-action" type="button">Rename</button>
                <button onclick="deleteSavedPlaylist('${escapeJs(set.id)}', event)" class="playlist-quiet-action delete" type="button">Delete</button>
              </div>
          </div>
        </div>
      `;
      }).join('');
    }

    async function renameSavedPlaylist(id, event) {
      if (event) event.stopPropagation();
      const set = savedPlaylists.find(item => item.id === id);
      if (!set) return;
      const nextName = await showAxiomTextPrompt({
        kicker: 'AXIOM Playlists',
        title: 'Rename This Set',
        copy: 'Choose the name AXIOM should show in your saved crates.',
        defaultValue: set.name,
        placeholder: 'Set name...',
        confirmText: 'Rename Set'
      });
      if (!nextName) return;
      const cleanName = nextName.trim();
      if (!cleanName) return;
      set.name = cleanName;
      set.updatedAt = new Date().toISOString();
      persistSavedPlaylists();
      renderSavedPlaylists();
      renderSelectedPlaylist();
      showToast(`Renamed: ${cleanName}`);
    }

    // ── Undo state (one pending deletion at a time; rapid deletes each get own timer) ──
    let _undoPending = null;   // { set, index, timer, progressAnim }

    function deleteSavedPlaylist(id, event) {
      if (event) event.stopPropagation();
      const set = savedPlaylists.find(item => item.id === id);
      if (!set) return;

      // Find wrapper element and animate it out
      const wrapper = document.querySelector(`.playlist-crate-wrapper[data-playlist-id="${id}"]`);
      if (wrapper) {
        const fullH = wrapper.scrollHeight;
        wrapper.style.maxHeight = fullH + 'px';
        wrapper.style.opacity = '1';
        wrapper.style.marginBottom = '';
        // Force reflow so the browser registers the starting values
        void wrapper.offsetHeight;
        wrapper.style.maxHeight = '0px';
        wrapper.style.opacity = '0';
        wrapper.style.marginBottom = '-12px';
      }

      // Record original index for undo re-insertion
      const originalIndex = savedPlaylists.findIndex(item => item.id === id);

      // If there's already a pending undo, commit it immediately (no more undo for it)
      if (_undoPending) {
        clearTimeout(_undoPending.timer);
        cancelAnimationFrame(_undoPending.progressAnim);
        _commitDelete(_undoPending.set.id);
        _undoPending = null;
      }

      // Wait for animation, then remove from data
      setTimeout(() => {
        if (selectedPlaylistId === id) {
          selectedPlaylistId = savedPlaylists.length ? savedPlaylists.find(s => s.id !== id)?.id ?? null : null;
        }
        if (editingPlaylistId === id) editingPlaylistId = null;
        savedPlaylists = savedPlaylists.filter(item => item.id !== id);
        persistSavedPlaylists();
        renderSavedPlaylists();
        renderSelectedPlaylist();
      }, 260);

      // Show undo snackbar
      _showUndoSnackbar(set, originalIndex);
    }

    function _commitDelete(id) {
      // Called when undo window expires — nothing extra needed, data already removed
    }

    function _showUndoSnackbar(set, originalIndex) {
      const snackbar = document.getElementById('playlist-undo-snackbar');
      const label    = document.getElementById('undo-snackbar-label');
      const bar      = document.getElementById('undo-progress-bar');
      if (!snackbar || !label || !bar) return;

      label.textContent = `Deleted "${set.name}"`;
      bar.style.transition = 'none';
      bar.style.transform  = 'scaleX(1)';

      // Show
      snackbar.classList.add('show');

      // Animate progress bar over 5 s
      let startTime = null;
      const DURATION = 5000;
      function tick(ts) {
        if (!startTime) startTime = ts;
        const elapsed = ts - startTime;
        const pct = Math.min(elapsed / DURATION, 1);
        bar.style.transition = 'none';
        bar.style.transform  = `scaleX(${1 - pct})`;
        if (pct < 1 && _undoPending) {
          _undoPending.progressAnim = requestAnimationFrame(tick);
        }
      }
      const animId = requestAnimationFrame(tick);

      const timer = setTimeout(() => {
        _dismissUndoSnackbar();
        _undoPending = null;
      }, DURATION);

      _undoPending = { set, originalIndex, timer, progressAnim: animId };
    }

    function _dismissUndoSnackbar() {
      const snackbar = document.getElementById('playlist-undo-snackbar');
      if (snackbar) snackbar.classList.remove('show');
    }

    function undoDeletePlaylist() {
      if (!_undoPending) return;
      const { set, originalIndex, timer, progressAnim } = _undoPending;
      clearTimeout(timer);
      cancelAnimationFrame(progressAnim);
      _undoPending = null;
      _dismissUndoSnackbar();

      // Re-insert at original position
      const clampedIndex = Math.min(originalIndex, savedPlaylists.length);
      savedPlaylists.splice(clampedIndex, 0, set);
      persistSavedPlaylists();
      renderSavedPlaylists();
      renderSelectedPlaylist();

      // Animate the restored row in (expand + fade)
      requestAnimationFrame(() => {
        const wrapper = document.querySelector(`.playlist-crate-wrapper[data-playlist-id="${set.id}"]`);
        if (wrapper) {
          const fullH = wrapper.scrollHeight;
          wrapper.style.maxHeight  = '0px';
          wrapper.style.opacity    = '0';
          wrapper.style.marginBottom = '-12px';
          wrapper.style.transition = 'none';
          void wrapper.offsetHeight;
          wrapper.style.transition = '';
          wrapper.style.maxHeight  = fullH + 'px';
          wrapper.style.opacity    = '1';
          wrapper.style.marginBottom = '';
          setTimeout(() => {
            wrapper.style.maxHeight = '';
          }, 260);
        }
      });
    }

    function exportSavedPlaylist(id, event) {
      if (event) event.stopPropagation();
      if (exportSavedPlaylist.busy) {
        showToast('A playlist export is already in progress.');
        return;
      }
      const set = savedPlaylists.find(item => item.id === id);
      if (!set || ['download-later', 'to-buy'].includes(set.kind)) return;
      if (!set.tracks?.length) { showToast('This playlist is empty.', true); return; }
      const selection = JSON.parse(JSON.stringify({tracks:set.tracks, name:set.name, label:'Saved playlist order'}));
      closeAxiomDialog();
      ensurePlaylistVaultStyles();
      const overlay = document.createElement('div');
      overlay.id = 'axiom-dialog-overlay';
      overlay.className = 'axiom-dialog-overlay record-vault-export vault-playlist playlist-export-choice';
      overlay.innerHTML = playlistVaultMarkup({
        titleId:'playlist-export-title', title:'Export Your Set',
        copy:`Send <strong>${escapeHtml(selection.name)}</strong> straight to your DJ software in its saved song order.`,
        content:`<div class="vault-export-summary"><div><strong>${selection.tracks.length}</strong><span>TRACKS</span></div><div><b>Saved playlist</b><span>RUNNING ORDER</span></div></div>`,
        actions:'<button type="button" class="axiom-dialog-btn" onclick="closeAxiomDialog()">Cancel</button><button type="button" class="axiom-dialog-btn" data-export-target="serato">Export to Serato</button><button type="button" class="axiom-dialog-btn primary" data-export-target="djay">Export to djay Pro</button>'
      });
      document.body.appendChild(overlay);
      overlay.querySelectorAll('[data-export-target]').forEach(button => button.addEventListener('click', async () => {
        if (exportSavedPlaylist.busy) return;
        exportSavedPlaylist.busy = true;
        closeAxiomDialog();
        try { await exportPlaylist(button.dataset.exportTarget, selection); }
        catch (error) { showToast(error.message || 'Playlist export could not start.', true); }
        finally { exportSavedPlaylist.busy = false; }
      }));
      overlay.addEventListener('click', e => { if (e.target === overlay) closeAxiomDialog(); });
      document.addEventListener('keydown', _axiomDialogEscape);
      overlay.querySelector('[data-export-target]')?.focus();
    }

    function editSavedPlaylist(id, event) {
      if (event) event.stopPropagation();
      const set = savedPlaylists.find(item => item.id === id);
      if (!set) return;
      if (window.AxiomStudioAutosave?.archiveCurrent() === false) return;
      editingPlaylistId = id;
      selectedPlaylistId = id;
      currentPlaylist = JSON.parse(JSON.stringify(set.tracks || []));
      currentSetBrief = normalizeSetBrief(set.setBrief || set.set_brief || DEFAULT_SET_BRIEF);
      resetModalSuggestionDecisions();
      currentRoutePlaylist = [];
      activeStudioView = 'manual';
      magicSetStudioCtaReady = false;
      setGraphMode(false);
      showTab('studio');
      document.getElementById('studio-start-view')?.classList.add('hidden');
      document.getElementById('studio-active-view')?.classList.remove('hidden');
      setStudioView('manual');
      applySetBriefToStudioControls();
      updateStudioToolsAvailability();
      initSortable();
      recalculateAudit();
      showToast(`Editing crate: ${set.name}`);
    }

    function selectSavedPlaylist(id) {
      selectedPlaylistId = id;
      playlistListenIndex = -1;
      renderSavedPlaylists();
      renderSelectedPlaylist();
    }

    function getSelectedPlaylist() {
      return savedPlaylists.find(set => set.id === selectedPlaylistId) || null;
    }

    function renderSelectedPlaylist() {
      const title = document.getElementById('playlist-listen-title');
      const kicker = document.getElementById('playlist-listen-kicker');
      const total = document.getElementById('playlist-listen-total');
      const list = document.getElementById('playlist-listen-tracks');
      if (!title || !kicker || !total || !list) return;
      const set = getSelectedPlaylist();
      const exportBtn = document.getElementById('playlist-listen-export-btn');
      const canExport = Boolean(set?.tracks?.length && !['to-buy', 'download-later'].includes(set.kind));
      if (exportBtn) {
        exportBtn.classList.toggle('hidden', !canExport);
        exportBtn.onclick = canExport ? (e) => exportSavedPlaylist(set.id, e) : null;
      }
      if (!set) {
        title.innerText = 'Choose a Playlist';
        kicker.innerText = 'Ready';
        total.innerText = '';
        const editBtn = document.getElementById('playlist-listen-edit-btn');
        if (editBtn) {
          editBtn.classList.add('hidden');
          editBtn.onclick = null;
        }
        list.innerHTML = `<div class="playlist-empty-state"><div><img src="${axiomRecordVaultStaticUrl('assets/record-vault/crate.png')}" alt="" /><strong>Your next set starts here</strong>Choose a saved set to listen, rename or refine it in Studio.</div></div>`;
        return;
      }
      title.innerText = set.name;
      if (set.kind === 'to-buy') {
        renderPurchasePlaylist(set, list, kicker, total);
        return;
      }
      if (set.kind === 'download-later') {
        kicker.innerText = 'Saved missing tracks · copy a search when you are ready to download';
        total.innerText = set.tracks.length;
        const editBtn = document.getElementById('playlist-listen-edit-btn');
        if (editBtn) {
          editBtn.classList.add('hidden');
          editBtn.onclick = null;
        }
        list.innerHTML = set.tracks.map((track, index) => `
          <div class="playlist-download-later-row">
            <span class="playlist-download-later-dot" aria-hidden="true"></span>
            <div class="min-w-0">
              <p class="playlist-track-title text-white text-sm font-black uppercase truncate">${escapeHtml(track.title || 'Missing Track')}</p>
              <p class="text-[10px] text-axiom-muted font-bold uppercase truncate">${escapeHtml(track.artist || 'Unknown Artist')}${track.requested_version ? ` · ${escapeHtml(track.requested_version)}` : ''}</p>
            </div>
            <span class="playlist-download-later-status">To Download</span>
            <button type="button" onclick="copyDownloadLaterTrack(${index}, event)">Copy Search</button>
          </div>
        `).join('');
        return;
      }
      kicker.innerText = 'Autoplay enabled in this view';
      total.innerText = set.tracks.length;
      const editBtn = document.getElementById('playlist-listen-edit-btn');
      if (editBtn) {
        editBtn.classList.remove('hidden');
        editBtn.onclick = (e) => editSavedPlaylist(set.id, e);
      }
      list.innerHTML = set.tracks.map((track, index) => {
        const isPlaying = currentPlayingPath && track.path === currentPlayingPath;
        return `
          <div onclick="playSavedPlaylistTrack(${index}, event)" class="playlist-listen-row playlist-listen-grid grid items-center gap-4 p-4 cursor-pointer ${isPlaying ? 'playing-track' : ''}" data-path="${escapeHtml(track.path || '')}" tabindex="-1">
            <button onclick="playSavedPlaylistTrack(${index}, event)" class="w-12 h-12 rounded-full bg-axiom-accent text-black flex items-center justify-center hover:scale-105 transition-transform" title="Play">
              <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <div class="playlist-track-info min-w-0 -ml-2">
              <img class="playlist-track-cover" src="${escapeHtml(getTrackArtwork(track) || axiomRecordVaultStaticUrl('assets/record-vault/record.png'))}" alt="" /><div class="min-w-0">
              <p class="playlist-track-title text-white text-sm font-black uppercase truncate">${escapeHtml(track.title || 'Unknown Title')}</p>
              <p class="text-[10px] text-axiom-muted font-bold uppercase truncate">${escapeHtml(track.artist || 'Unknown Artist')}</p>
            </div></div>
            <div class="text-right text-axiom-accent text-xs font-black">${track.bpm ? parseFloat(track.bpm).toFixed(1) : '--'}</div>
            <div class="text-right text-white/70 text-xs font-black">${track.camelot || '--'}</div>
            <div class="playlist-duration-cell text-right text-white/40 text-[10px] font-black uppercase">${track.duration_min ? `${parseFloat(track.duration_min).toFixed(1)}m` : ''}</div>
          </div>
        `;
      }).join('');
      highlightPlayingTrack(currentPlayingPath);
    }

    function playSavedPlaylistTrack(index, event) {
      const set = getSelectedPlaylist();
      const track = set?.tracks?.[index];
      if (!track) return;
      playlistListenIndex = index;
      playAudioFile(track.path, track.title || 'Unknown Title', track.artist || 'Unknown Artist', track.bpm || 0, track.camelot || '', track.energy || '', event, track.genre || '');
      renderSelectedPlaylist();
    }

    function playNextSavedPlaylistTrack() {
      const set = getSelectedPlaylist();
      if (!set || playlistListenIndex < 0) return;
      const nextIndex = playlistListenIndex + 1;
      if (nextIndex >= set.tracks.length) {
        playlistListenIndex = -1;
        showToast("Playlist finished");
        return;
      }
      playSavedPlaylistTrack(nextIndex);
    }

    // Local review data never reads or writes the owner's saved-set collection.
    window.addEventListener('load', () => {
      if (!isPlaylistVaultReview()) return;
      window.setTimeout(() => {
        libraryHasTracks = true;
        const tracks = libraryGapReviewTracks().map(track => ({...track,duration_min:3.5}));
        savedPlaylists = [
          {id:'review-night',name:'Friday Night',tracks:tracks.slice(0,5)},
          {id:'review-warmup',name:'The Warm Up',tracks:tracks.slice(2,6)},
          {id:'review-classics',name:'After Hours Classics',tracks:tracks.slice(3)}
        ];
        currentPlaylist = tracks.slice(0,5);
        selectedPlaylistId = savedPlaylists[0].id;
        playlistVaultReviewReady = true;
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        document.body.classList.remove('axiom-start-mode');
        closeAxiomReleaseSplash('later');
        showTab('playlists');
        refreshPlaylistsView();
      },1000);
    });
