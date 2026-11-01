    function showAxiomDjExportName(options = {}) {
      if (isAxiomLite()) return showAxiomTextPrompt(options);
      ensureAxiomRecordVaultStyles();
      const djay = options.destination === 'djay';
      const provider = djay ? 'djay Pro' : 'Serato';
      return new Promise(resolve => {
        closeAxiomDialog();
        const overlay = document.createElement('div');
        overlay.id = 'axiom-dialog-overlay';
        overlay.className = `axiom-dialog-overlay record-vault-export ${djay ? 'vault-djay' : 'vault-serato'}`;
        overlay.innerHTML = `<div class="axiom-dialog-card vault-export-card" role="dialog" aria-modal="true" aria-labelledby="axiom-text-prompt-title">
          <div class="vault-brand"><b>AXIOM<small>PRO</small></b><span>EXPORT TO ${djay ? 'DJAY PRO' : 'SERATO DJ PRO'}</span></div>
          <button id="axiom-text-prompt-close" class="axiom-dialog-close" type="button" aria-label="Close">×</button>
          <div class="vault-export-layout"><div class="vault-export-copy">
            <p class="vault-export-kicker">${djay ? 'PLAYLIST' : 'CRATE'} HANDOFF</p>
            <h2 id="axiom-text-prompt-title">NAME YOUR <em>${djay ? 'DJAY' : 'SERATO'}</em> ${djay ? 'PLAYLIST' : 'CRATE'}</h2>
            <p class="vault-export-description">${escapeHtml(options.copy || `Quit ${provider} before export. Your music stays untouched.`)}</p>
            <label class="vault-name-field" for="axiom-text-prompt-input">${djay ? 'Playlist' : 'Crate'} name</label>
            <input id="axiom-text-prompt-input" type="text" class="axiom-dialog-input" value="${escapeHtml(options.defaultValue || '')}" placeholder="${escapeHtml(options.placeholder || 'Name your set')}" maxlength="100" autocomplete="off" />
            <div class="vault-export-summary"><div><strong>${Number(options.trackCount || 0)}</strong><span>TRACKS</span></div><div><b>${escapeHtml(options.orderSource || 'Set order')}</b><span>ORDER SOURCE</span></div></div>
            <div class="axiom-dialog-actions"><button id="axiom-text-prompt-cancel" class="axiom-dialog-btn" type="button">Cancel</button><button id="axiom-text-prompt-confirm" class="axiom-dialog-btn primary" type="button">${escapeHtml(options.confirmText || 'Continue')}</button></div>
          </div><div class="vault-export-art" aria-hidden="true"><img src="${axiomRecordVaultStaticUrl(`assets/record-vault/${djay ? 'djay-stack' : 'serato-sleeves'}.png`)}" alt="" /></div></div>
        </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#axiom-text-prompt-input');
        const confirm = overlay.querySelector('#axiom-text-prompt-confirm');
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', keydown);
          overlay.remove();
          resolve(value);
        };
        const submit = () => { const name = input.value.trim(); if (name) finish(name); };
        const keydown = event => { if (event.key === 'Escape') finish(null); if (event.key === 'Enter' && event.target === input) submit(); };
        input.addEventListener('input', () => { confirm.disabled = !input.value.trim(); });
        confirm.disabled = !input.value.trim();
        confirm.addEventListener('click', submit);
        overlay.querySelector('#axiom-text-prompt-close').addEventListener('click', () => finish(null));
        overlay.querySelector('#axiom-text-prompt-cancel').addEventListener('click', () => finish(null));
        overlay.addEventListener('click', event => { if (event.target === overlay) finish(null); });
        document.addEventListener('keydown', keydown);
        input.focus(); input.select();
      });
    }

    // Export delivery helpers for browser and native Serato/djay handoffs.
    function formatSeratoExportPath(path) {
      if (!path) return 'AXIOM handoff prepared';
      return String(path).replace(`${window.location.origin}/`, '');
    }

    function downloadAxiomBrowserFile(filename, content, type = 'text/plain;charset=utf-8') {
      const blob = new Blob([content], { type });
      downloadAxiomBrowserBlob(filename, blob);
    }

    function downloadAxiomBrowserBlob(filename, blob) {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'AXIOM_EXPORT.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }

    function findAxiomMusicRootPlaylistFile(files = []) {
      return (Array.isArray(files) ? files : []).find(file => /_MUSIC_FOLDER_ROOT\.m3u8$/i.test(String(file?.filename || '')));
    }

    function recordAxiomBrowserExport(data = {}) {
      try {
        const existingRaw = localStorage.getItem(EXPORT_HISTORY_STORAGE_KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const files = [
          data.crate_filename,
          ...(Array.isArray(data.browser_download_files) ? data.browser_download_files.map(file => file?.filename).filter(Boolean) : [])
        ].filter(Boolean);
        const record = {
          id: `export-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          createdAt: new Date().toISOString(),
          name: data.name || data.crate_name || data.crate_filename || 'AXIOM Serato Handoff',
          exportedTracks: Number(data.exported_tracks || 0),
          totalTracks: Number(data.total_tracks || data.exported_tracks || 0),
          missingTracks: Number(data.missing_tracks || 0),
          orderSource: data.order_source || getActiveStudioOutputLabel(),
          files,
          sourceAudioUntouched: data.source_audio_untouched !== false,
          browserDownload: Boolean(data.browser_download)
        };
        const next = [record, ...(Array.isArray(existing) ? existing : [])].slice(0, 25);
        localStorage.setItem(EXPORT_HISTORY_STORAGE_KEY, JSON.stringify(next));
        window.lastAxiomBrowserExport = record;
        return record;
      } catch (err) {
        console.warn('AXIOM export history unavailable:', err);
        return null;
      }
    }

    function downloadAxiomBrowserExportFiles(data = {}) {
      if (data.browser_download) recordAxiomBrowserExport(data);
      if (data.browser_root_written) return;
      const packageFiles = [];
      if (data.browser_download && data.crate_content) {
        packageFiles.push({
          filename: data.crate_filename || 'AXIOM_SET.m3u8',
          content: data.crate_content,
          content_type: data.content_type || 'application/vnd.apple.mpegurl;charset=utf-8'
        });
      }
      if (Array.isArray(data.browser_download_files)) {
        data.browser_download_files.forEach(file => {
          if (!file || !file.content) return;
          packageFiles.push({
            filename: file.filename || 'AXIOM_EXPORT.txt',
            content: file.content,
            content_type: file.content_type || 'text/plain;charset=utf-8'
          });
        });
      }
      const rootPlaylist = findAxiomMusicRootPlaylistFile(packageFiles);
      if (data.browser_primary_download === 'music_root_m3u8' && rootPlaylist) {
        downloadAxiomBrowserFile(rootPlaylist.filename, rootPlaylist.content, rootPlaylist.content_type);
        return;
      }
      packageFiles.forEach(file => downloadAxiomBrowserFile(file.filename, file.content, file.content_type));
    }

    async function prepareAxiomBrowserSeratoDelivery() {
      if (typeof window.AXIOM_BROWSER_PREPARE_SERATO_EXPORT !== 'function') return null;
      try {
        return await window.AXIOM_BROWSER_PREPARE_SERATO_EXPORT();
      } catch (err) {
        console.warn('AXIOM could not prepare music-folder delivery:', err);
        return { available: true, granted: false, message: err?.message || 'Folder permission was not granted.' };
      }
    }

    async function deliverAxiomBrowserSeratoPlaylist(data = {}, prepared = null) {
      if (!data.browser_download || typeof window.AXIOM_BROWSER_DELIVER_SERATO_PLAYLIST !== 'function') return null;
      if (prepared && !prepared.granted) {
        data.browser_root_delivery = prepared;
        return prepared;
      }
      try {
        const delivery = await window.AXIOM_BROWSER_DELIVER_SERATO_PLAYLIST(data);
        data.browser_root_delivery = delivery;
        if (delivery?.success) {
          data.browser_root_written = true;
          data.browser_serato_crate_written = Boolean(delivery.crate_written);
          data.browser_root_written_path = delivery.display_path;
          data.download_crate_path = data.crate_path;
          data.crate_path = delivery.display_path;
          data.exported_tracks = Number(delivery.exported_tracks || data.exported_tracks || 0);
          data.missing_tracks = Math.max(0, Number(data.total_tracks || 0) - data.exported_tracks - Number(data.duplicate_tracks || 0));
          data.serato_restart_hint = 'Fully quit and reopen Serato so it reloads the new crate from Subcrates.';
        } else if (data.browser_download) {
          data.exported_tracks = Number(data.browser_manual_tracks || data.exported_tracks || 0);
        }
        return delivery;
      } catch (err) {
        const delivery = { success: false, message: err?.message || 'Music-folder delivery failed.' };
        data.browser_root_delivery = delivery;
        console.warn('AXIOM music-folder delivery failed:', err);
        return delivery;
      }
    }

    async function copySeratoCratePath(path) {
      if (!path) {
        showToast('Crate path is not available.', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(path);
        showToast('Crate path copied.');
      } catch (err) {
        showToast('Copy unavailable. Path is shown in the handoff panel.', true);
      }
    }

    function showSeratoExportSuccess(data, playlistName, destination = 'serato') {
      if (!isAxiomLite()) ensureAxiomRecordVaultStyles();
      closeSeratoSuccessModal();

      const exported = Number(data.exported_tracks || 0);
      const total = Number(data.total_tracks || exported);
      const skipped = Number(data.missing_tracks || 0);
      const duplicates = Number(data.duplicate_tracks || 0);
      const djayMode = destination === 'djay' || data.target === 'djay';
      const notInDjay = djayMode ? Number(data.not_in_djay_tracks || 0) : 0;
      const reviewFixture = data.review_fixture === true;
      const browserIntegrationProof = data.browser_integration_proof === true;
      const modernSerato = !browserIntegrationProof && !djayMode && data.serato_library_registered === true && data.database_readback_verified === true;
      const safeName = escapeHtml(playlistName || (djayMode ? 'AXIOM djay Playlist' : 'AXIOM Serato Crate'));
      const djayPlaylistName = data.djay_playlist_name || playlistName || 'AXIOM djay Playlist';
      const djayLocation = `My Collection > Playlists > ${djayPlaylistName}`;
      const cratePath = browserIntegrationProof
        ? (data.proof_target || 'Disposable Serato 4 library copy')
        : djayMode ? djayLocation : modernSerato
          ? (data.serato_visibility_path || `Crates sidebar > ${data.serato_playlist_name}`)
          : formatSeratoExportPath(data.crate_path);
      const topLevelCratePath = formatSeratoExportPath(data.top_level_crate_path);
      const reportPath = formatSeratoExportPath(data.report_path);
      const receiptPath = formatSeratoExportPath(data.receipt_path);
      const backupPath = formatSeratoExportPath(data.backup_path);
      const orderSource = escapeHtml(data.order_source || getActiveStudioOutputLabel());
      const orderShort = /route|harmonic/i.test(orderSource) ? 'Route' : 'Live';
      const lookupTargets = Array.isArray(data.serato_lookup) && data.serato_lookup.length
        ? data.serato_lookup
        : [`AXIOM SETS > ${playlistName || 'AXIOM Serato Crate'}`];
      const lookupCopy = lookupTargets.map(item => `<strong>${escapeHtml(item)}</strong>`).join(' or ');
      const lookupText = lookupTargets.map(item => String(item || '')).filter(Boolean).join(' or ');
      const browserMode = Boolean(data.browser_download);
      const rootWritten = Boolean(data.browser_root_written && data.browser_root_written_path);
      const browserCrateWritten = Boolean(data.browser_serato_crate_written);
      const deliveryError = data.browser_root_delivery?.message || '';
      let note = browserIntegrationProof
        ? 'This was a browser-only writer check. The exact playlist name, membership, order, backup, read-back, and unchanged audio were verified in a disposable copy, then that copy was removed. No playlist was added to active Serato and Serato was not opened. Installed handoff and visible playback still require a separately approved installed build.'
        : reviewFixture
        ? 'Browser rehearsal only: the populated set, naming step, exact track count, and success receipt completed without writing to Serato. Final proof still requires the exact TestFlight-installed build in Serato DJ Pro.'
        : djayMode
        ? `${data.djay_reopened ? 'djay Pro has reopened.' : 'Open djay Pro now.'} Find the playlist under My Collection > Playlists. AXIOM kept the set order and verified the library backup.`
        : modernSerato
        ? `${data.serato_opened ? 'Serato DJ Pro has opened.' : 'Open Serato DJ Pro.'} Look for ${lookupText}. Library membership and track order were verified; confirm it in Serato.`
        : browserCrateWritten
        ? `Fully quit and reopen Serato. Look for ${lookupText}; Serato reloads crates from Subcrates when it starts.`
        : data.serato_opened
        ? `Serato DJ Pro has opened. Look for ${lookupText}.`
        : !browserMode
        ? `Crate files were saved. Open Serato and check for ${lookupText}. ${skipped} unavailable tracks and ${duplicates} duplicates were skipped.`
        : (skipped || duplicates
          ? `${skipped} unavailable track${skipped === 1 ? '' : 's'} and ${duplicates} duplicate${duplicates === 1 ? '' : 's'} were safely left out. The downloaded M3U8 requires manual import in Serato.`
          : (deliveryError || data.serato_restart_hint || 'Import the downloaded MUSIC_FOLDER_ROOT M3U8 manually in Serato.'));
      const titleCopy = browserIntegrationProof ? 'Browser Writer Check Passed — Active Serato Not Changed' : reviewFixture ? 'Browser UI Check Complete' : djayMode ? 'Playlist Added to djay Pro' : modernSerato ? 'Playlist Registered in Serato' : (browserCrateWritten ? 'Crate File Saved' : (browserMode ? 'Manual Playlist Downloaded' : 'Crate File Saved'));
      const bodyCopy = browserIntegrationProof
        ? `<strong>${safeName}</strong> was written by AXIOM's real Serato exporter into an isolated copy with <strong>${exported} tracks</strong> in <strong>${orderSource}</strong>. The disposable database read-back matched exactly, then the copy was removed. This did <strong>not</strong> add the playlist to active Serato or open Serato.`
        : reviewFixture
        ? `<strong>${safeName}</strong> completed the safe browser handoff with <strong>${exported} tracks</strong> in <strong>${orderSource}</strong>. No Serato files, databases, or source audio were changed.`
        : djayMode
        ? `<strong>${escapeHtml(djayPlaylistName)}</strong> was added to <strong>djay Pro &gt; My Collection &gt; Playlists</strong> in <strong>${orderSource}</strong>. AXIOM backed up and verified djay's playlist library before updating it. Source audio remains untouched.`
        : modernSerato
        ? `<strong>${escapeHtml(data.serato_playlist_name)}</strong> was registered in Serato's library in <strong>${orderSource}</strong>. AXIOM verified the library backup and exact track order. Existing cues, beatgrids, track metadata, and source audio remain untouched.`
        : browserCrateWritten
        ? `<strong>${safeName}</strong> was written to your Serato <strong>Subcrates</strong> folder in <strong>${orderSource}</strong>. AXIOM created one crate file only: source audio and Serato database untouched.`
        : browserMode
        ? `<strong>${safeName}</strong> was not added to Subcrates automatically. Import the downloaded <strong>_MUSIC_FOLDER_ROOT.m3u8</strong> manually in Serato. Source audio and Serato database untouched.`
        : `<strong>${safeName}</strong> has been added to Serato's crate folder in <strong>${orderSource}</strong>. In Serato, look for ${lookupCopy}. AXIOM created crate handoff files only: source audio untouched, Serato database untouched.`;
      if (notInDjay) note += ` ${notInDjay} track${notInDjay === 1 ? ' was' : 's were'} skipped because ${notInDjay === 1 ? 'it is' : 'they are'} not in djay My Collection.`;
      if (data.report_warning) note += ` ${data.report_warning}`;
      const pathLabel = browserIntegrationProof ? 'Proof Target' : reviewFixture ? 'Test Target' : djayMode || modernSerato ? 'Find It Here' : (browserCrateWritten || !browserMode ? 'Crate' : 'Manual Playlist');
      const copyButtonLabel = browserIntegrationProof ? 'Copy Proven Playlist Name' : reviewFixture ? 'Copy Test Playlist Name' : djayMode ? 'Copy Playlist Location' : modernSerato ? 'Copy Playlist Name' : (browserCrateWritten || !browserMode ? 'Copy Crate Path' : 'Copy Playlist Path');
      const copyPath = browserIntegrationProof ? data.serato_playlist_name : djayMode ? djayLocation : modernSerato ? data.serato_playlist_name : data.crate_path;

      const overlay = document.createElement('div');
      overlay.id = 'serato-success-overlay';
      overlay.className = `serato-success-overlay${isAxiomLite() ? '' : ` record-vault-export ${djayMode ? 'vault-djay' : 'vault-serato'}`}`;
      overlay.innerHTML = `
        <div class="serato-success-card${djayMode ? ' djay-success' : ''}" role="dialog" aria-modal="true" aria-labelledby="serato-success-title">
          <button class="serato-success-close" type="button" onclick="closeSeratoSuccessModal()" aria-label="Close">×</button>
          ${!isAxiomLite() ? `<div class="vault-brand"><b>AXIOM<small>PRO</small></b><span>EXPORT TO ${djayMode ? 'DJAY PRO' : 'SERATO DJ PRO'}</span></div><div class="vault-receipt-art" aria-hidden="true"><img src="${axiomRecordVaultStaticUrl(`assets/record-vault/${djayMode ? 'djay-stack' : 'serato-sleeves'}.png`)}" alt="" /></div>` : ''}
          <div class="serato-success-content">
            <div class="serato-success-header">
              <div class="serato-success-mark" aria-hidden="true">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                  <path d="M20 7L10 17l-5-5" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div>
                <div class="serato-success-kicker">${browserIntegrationProof ? 'Browser Check Only · Disposable Copy · No Serato Launch' : reviewFixture ? 'No Serato Write Performed' : djayMode ? 'djay Pro Handoff Complete' : modernSerato ? 'Serato Library Updated' : (browserCrateWritten || !browserMode ? 'Crate File Saved' : 'Manual Import Required')}</div>
                <h2 id="serato-success-title" class="serato-success-title">${titleCopy}</h2>
                ${!isAxiomLite() ? `<div class="vault-finished-name">${escapeHtml(djayMode ? djayPlaylistName : modernSerato ? data.serato_playlist_name : playlistName)}</div>` : ''}
                <p class="serato-success-copy">
                  ${bodyCopy}
                </p>
              </div>
            </div>

            <div class="serato-success-stats">
              <div class="serato-success-stat">
                <strong>${exported}</strong>
                <span>Tracks exported</span>
              </div>
              <div class="serato-success-stat">
                <strong>${total}</strong>
                <span>Set size</span>
              </div>
              <div class="serato-success-stat">
                <strong>${skipped + duplicates + notInDjay}</strong>
                <span>Protected skips</span>
              </div>
              <div class="serato-success-stat">
                <strong>${orderShort}</strong>
                <span>Order source</span>
              </div>
            </div>

            <div class="serato-success-details">
              <div class="serato-success-detail">
                <span>${pathLabel}</span>
                <code title="${escapeHtml(cratePath)}">${escapeHtml(cratePath)}</code>
              </div>
              ${data.top_level_crate_path ? `
                <div class="serato-success-detail">
                  <span>Top Level Copy</span>
                  <code title="${escapeHtml(topLevelCratePath)}">${escapeHtml(topLevelCratePath)}</code>
                </div>
              ` : ''}
              ${data.report_path ? `
                <div class="serato-success-detail">
                  <span>Report</span>
                  <code title="${escapeHtml(reportPath)}">${escapeHtml(reportPath)}</code>
                </div>
              ` : ''}
              ${data.receipt_path ? `
                <div class="serato-success-detail">
                  <span>Receipt</span>
                  <code title="${escapeHtml(receiptPath)}">${escapeHtml(receiptPath)}</code>
                </div>
              ` : ''}
              ${data.backup_path ? `
                <div class="serato-success-detail">
                  <span>Backup</span>
                  <code title="${escapeHtml(backupPath)}">${escapeHtml(backupPath)}</code>
                </div>
              ` : ''}
            </div>

            <div class="serato-success-note">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3l7 3v5c0 4.55-2.9 8.62-7 10-4.1-1.38-7-5.45-7-10V6l7-3Z" stroke="var(--accent)" stroke-width="1.8"/>
                <path d="M9 12l2 2 4-5" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>${escapeHtml(note)}</span>
            </div>

            <div class="serato-success-actions">
              <button class="serato-success-btn" type="button" data-copy-path="${escapeHtml(copyPath || '')}" onclick="copySeratoCratePath(this.dataset.copyPath)">${copyButtonLabel}</button>
              <button class="serato-success-btn primary" type="button" onclick="closeSeratoSuccessModal()">Done</button>
            </div>
          </div>
        </div>
      `;

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeSeratoSuccessModal();
      });
      document.body.appendChild(overlay);
      document.addEventListener('keydown', handleSeratoSuccessEscape);
    }

    window.closeSeratoSuccessModal = closeSeratoSuccessModal;
    window.copySeratoCratePath = copySeratoCratePath;
    window.showSeratoExportSuccess = showSeratoExportSuccess;
