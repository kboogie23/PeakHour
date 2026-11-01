    // Studio set export and verified Serato/djay delivery.
    const LITE_SERATO_EXPORT_FREE_USES = 5;
    const LITE_SERATO_EXPORT_PACK_SIZE = 5;
    const LITE_SERATO_EXPORT_USAGE_KEY = 'axiomLiteSeratoExportUsage.v1';
    const LITE_SERATO_EXPORT_PRODUCT_ID = 'com.axiomdj.lite.serato5';

    function liteSeratoExportState() {
      let value = {};
      try { value = JSON.parse(localStorage.getItem(LITE_SERATO_EXPORT_USAGE_KEY) || '{}') || {}; } catch (_) { value = {}; }
      return {
        freeUsed: Math.max(0, Math.min(LITE_SERATO_EXPORT_FREE_USES, Number(value.freeUsed) || 0)),
        purchasedCredits: Math.max(0, Number(value.purchasedCredits) || 0),
        processedTransactions: Array.isArray(value.processedTransactions)
          ? value.processedTransactions.map((id) => String(id || '')).filter(Boolean).slice(-100)
          : [],
      };
    }

    function saveLiteSeratoExportState(state = {}) {
      localStorage.setItem(LITE_SERATO_EXPORT_USAGE_KEY, JSON.stringify({
        freeUsed: Math.max(0, Math.min(LITE_SERATO_EXPORT_FREE_USES, Number(state.freeUsed) || 0)),
        purchasedCredits: Math.max(0, Number(state.purchasedCredits) || 0),
        processedTransactions: Array.isArray(state.processedTransactions)
          ? state.processedTransactions.map((id) => String(id || '')).filter(Boolean).slice(-100)
          : [],
      }));
    }

    function liteSeratoExportHasCredit() {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite()) return true;
      const state = liteSeratoExportState();
      return state.freeUsed < LITE_SERATO_EXPORT_FREE_USES || state.purchasedCredits > 0;
    }

    function requestLiteSeratoExportPackPurchase() {
      const nativeBridge = window.webkit?.messageHandlers?.axiomNative;
      if (nativeBridge?.postMessage && window.__AXIOM_NATIVE_STOREKIT_READY === true) {
        nativeBridge.postMessage({ action: 'purchaseAxiomProduct', productId: LITE_SERATO_EXPORT_PRODUCT_ID });
        showToast('Apple purchase sheet requested for 5 more Serato exports.', false, { important: true });
        return true;
      }
      showToast('App Store purchase setup is not available in this test build. The $5 Serato export pack will be available in the Mac App Store version of AXIOM Lite.', true, { important: true });
      return false;
    }

    function showLiteSeratoExportLimit() {
      const message = `You have used your ${LITE_SERATO_EXPORT_FREE_USES} free Serato exports. Buy ${LITE_SERATO_EXPORT_PACK_SIZE} more for $5 in AXIOM Lite.`;
      if (typeof showToastWithAction === 'function') {
        showToastWithAction(message, 'Buy 5 More — $5', requestLiteSeratoExportPackPurchase);
      } else {
        showToast(message, true, { important: true });
      }
      return false;
    }

    function consumeLiteSeratoExportCredit() {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite()) return true;
      const state = liteSeratoExportState();
      if (state.freeUsed < LITE_SERATO_EXPORT_FREE_USES) state.freeUsed += 1;
      else if (state.purchasedCredits > 0) state.purchasedCredits -= 1;
      else return showLiteSeratoExportLimit();
      saveLiteSeratoExportState(state);
      return true;
    }

    window.__AXIOM_LITE_SERATO_PACK_PURCHASED = function(payload = {}) {
      if (typeof isAxiomLite !== 'function' || !isAxiomLite() || payload.verified !== true || !payload.transactionId) return false;
      const state = liteSeratoExportState();
      const transactionId = String(payload.transactionId);
      if (state.processedTransactions.includes(transactionId)) return false;
      state.purchasedCredits += LITE_SERATO_EXPORT_PACK_SIZE;
      state.processedTransactions.push(transactionId);
      saveLiteSeratoExportState(state);
      showToast(`${LITE_SERATO_EXPORT_PACK_SIZE} more Serato exports are ready.`, false, { important: true });
      return true;
    };

    window.__AXIOM_LITE_SERATO_PURCHASE_FAILED = function(message) {
      showToast(String(message || 'The AXIOM Lite Serato export purchase could not be completed.'), true, { important: true });
    };

    function showDjayExportFailure(message) {
      closeAxiomDialog();
      const detail = String(message || 'djay Pro export could not be completed.');
      const version = document.getElementById('app-version-pill')?.textContent?.trim() || 'Version unavailable';
      const build = document.getElementById('app-build-pill')?.textContent?.trim() || 'Build unavailable';
      const reasonOffset = detail.indexOf('Compatibility detail:');
      const reason = reasonOffset >= 0 ? `${detail.slice(reasonOffset)}\n\n` : '';
      const report = `${reason}${version}\nBuild: ${build}\n\n${detail}`;
      const overlay = document.createElement('div');
      overlay.id = 'axiom-dialog-overlay';
      overlay.className = 'axiom-dialog-overlay active djay-export-failure';
      overlay.innerHTML = `<style>
        #axiom-dialog-overlay.djay-export-failure .axiom-dialog-card {background:#101510!important;color:#f4f7ef!important;-webkit-text-fill-color:#f4f7ef!important}
        #axiom-dialog-overlay.djay-export-failure :is(h2,p,textarea,button) {color:#f4f7ef!important;-webkit-text-fill-color:#f4f7ef!important}
        #axiom-dialog-overlay.djay-export-failure textarea {background:#071005!important}
        #axiom-dialog-overlay.djay-export-failure button {background:#202820!important}
      </style><div class="axiom-dialog-card" role="dialog" aria-modal="true" aria-labelledby="djay-export-error-title" style="max-height:calc(100vh - 40px);overflow:auto">
        <h2 id="djay-export-error-title" class="axiom-dialog-title" style="color:#f4f7ef!important;-webkit-text-fill-color:#f4f7ef!important">djay Pro export needs attention</h2>
        <p>The complete error is below. Copy it for support. Your set is still available in AXIOM.</p>
        <textarea readonly aria-label="Complete djay export error" style="display:block;box-sizing:border-box;width:100%;min-height:180px;margin:18px 0;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(report)}</textarea>
        <div class="axiom-dialog-actions"><button type="button" class="axiom-dialog-btn" data-copy-error>Copy Error</button><button type="button" class="axiom-dialog-btn" data-close-error>Close</button></div>
        <p data-copy-status role="status"></p>
      </div>`;
      const copy = overlay.querySelector('[data-copy-error]');
      copy.addEventListener('click', async () => {
        const status = overlay.querySelector('[data-copy-status]');
        try {
          await navigator.clipboard.writeText(report);
          status.textContent = 'Copied. Share this error with AXIOM support.';
        } catch (_) {
          const field = overlay.querySelector('textarea');
          field.focus(); field.select();
          status.textContent = 'Text selected. Press Command-C on Mac or Ctrl-C on Windows to copy.';
        }
      });
      overlay.querySelector('[data-close-error]').addEventListener('click', closeAxiomDialog);
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeAxiomDialog();
        if (event.key !== 'Tab') return;
        const first = overlay.querySelector('textarea');
        const last = overlay.querySelector('[data-close-error]');
        if (event.shiftKey && event.target === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && event.target === last) {event.preventDefault(); first.focus();}
      });
      document.body.appendChild(overlay);
      overlay.querySelector('textarea').focus();
    }

    async function requestAxiomDjExport(payload) {
      const send = async () => {
        const response = await fetch('/api/studio/export_serato_crate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return { response, data: await response.json() };
      };
      let result = await send();
      // This response is returned before the writer touches any output. Only
      // the native picker can establish the grant; never send a raw path.
      if (payload.target === 'serato' && result.response.status === 403 &&
          result.data.serato_export_folder_required === true) {
        if (typeof axiomNativePick !== 'function') {
          throw new Error('Open AXIOM in its installed window to allow Serato crate exports.');
        }
        let picked;
        try {
          picked = await axiomNativePick('chooseSeratoExportFolder');
        } catch (error) {
          if (error?.cancelled) return null;
          throw error;
        }
        if (picked?.cancelled) return null;
        if (!picked?.success) throw new Error(picked?.error || 'Serato folder permission was not granted.');
        result = await send();
      }
      return result;
    }

    async function requestAxiomBrowserSeratoProof(payload) {
      const query = new URLSearchParams({
        review: axiomReviewMode(),
        ui_preview: axiomUiPreviewMode()
      });
      const response = await fetch(`/api/review/serato_export_proof?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || 'The Serato browser integration proof failed.');
      }
      const verified = data.browser_integration_proof === true
        && data.serato_library_registered === true
        && data.database_readback_verified === true
        && data.exact_order_verified === true
        && data.backup_verified === true
        && data.source_audio_untouched === true
        && data.active_serato_database_untouched === true;
      if (!verified) throw new Error('The Serato browser proof returned an incomplete verification receipt.');
      return data;
    }

    async function saveAxiomPlaylistFile(blob, filename) {
      if (window.webkit?.messageHandlers?.axiomNative?.postMessage) {
        try {
          const result = await axiomNativePick('savePlaylistFile', 300000, undefined,
            { filename, content: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer()) });
          if (!result?.success) throw new Error(result?.error || 'The playlist was not saved.');
          return true;
        } catch (error) {
          if (error.cancelled) return false;
          throw error;
        }
      }
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      return true;
    }

    async function exportPlaylist(type = 'm3u', savedSelection = null) {
      // Snapshot a saved set before any dialogs or license requests can yield.
      const suppliedSelection = savedSelection ? JSON.parse(JSON.stringify(savedSelection)) : null;
      closeExportDropdown();
      if (type === 'djay' && isAxiomLite()) {
        if (typeof openLiteProInfo === 'function') openLiteProInfo();
        showToast('djay Pro export is an AXIOM Pro feature. See Pro features in Settings.', true);
        return;
      }
      if (type === 'serato' && isAxiomLite() && !liteSeratoExportHasCredit()) {
        showLiteSeratoExportLimit();
        return;
      }
      if (['serato', 'djay'].includes(type) && isAxiomWebPreview()) {
        openAxiomExportUpgradeSplash(type);
        return;
      }
      if (!(await ensureAxiomLicenseUsable('export'))) return;
      if (!requirePaidStudioFeature('Export')) return;
      if (type === 'serato' && !requireAxiomInstalledApp('Serato export')) return;
      if (type === 'djay' && !requireAxiomInstalledApp('djay Pro export')) return;
      const exportSelection = suppliedSelection || (['serato', 'djay'].includes(type)
        ? await chooseSeratoExportOrder()
        : { tracks: getActiveStudioOutputTracks(), label: getActiveStudioOutputLabel() });
      if (!exportSelection) return;

      const exportTracks = exportSelection.tracks || [];
      if (exportTracks.length === 0) {
        showToast("Set is empty.", true);
        return;
      }
      const exportOrderLabel = exportSelection.label || getActiveStudioOutputLabel();
      if (!(await confirmExportPreflight(type, exportTracks))) return;

      if (type === 'serato' || type === 'djay') {
          const directExportButton = document.getElementById(type === 'djay' ? 'studio-export-djay-btn' : 'studio-export-serato-btn');
          document.getElementById('export-spinner')?.classList.remove('hidden');
          try {
            const djayMode = type === 'djay';
            const safeSeratoJourneyReview = type === 'serato'
              && axiomReviewMode() === 'magic-set'
              && axiomUiPreviewMode() === 'serato-journey'
              && ['127.0.0.1', 'localhost'].includes(window.location.hostname);
            const editingSet = editingPlaylistId ? savedPlaylists.find(set => set.id === editingPlaylistId) : null;
            const defaultName = suppliedSelection?.name || editingSet?.name || `AXIOM ${new Date().toISOString().slice(0, 10)}`;
	            const playlistName = await showAxiomDjExportName({
                  destination: type, trackCount: exportTracks.length, orderSource: exportOrderLabel,
	              kicker: safeSeratoJourneyReview
	                ? 'Source Check Only - Not A Live Export'
	                : djayMode ? 'djay Pro Handoff' : 'Serato Handoff',
	              title: safeSeratoJourneyReview
	                ? 'Test The Serato Writer'
	                : djayMode ? 'Name Your djay Playlist' : 'Name Your Serato Crate',
	              copy: safeSeratoJourneyReview
	                ? 'This checks AXIOM\'s writer against a disposable copy, then deletes that copy. It will not create this playlist in your real Serato library and it will not open Serato. A live handoff can only be tested in the installed AXIOM app.'
	                : djayMode
	                ? 'Fully quit djay Pro first. AXIOM will back up its library, add this native playlist under My Collection > Playlists, then reopen djay Pro.'
	                : 'Fully quit Serato first. AXIOM will add the verified crate while Serato is closed, then reopen Serato safely.',
	              defaultValue: defaultName,
	              placeholder: djayMode ? 'djay playlist name...' : 'Serato crate name...',
	              confirmText: safeSeratoJourneyReview ? 'Check Code Only' : djayMode ? 'Add To djay Pro' : 'Add To Serato'
	            });
            if (!playlistName) return;
            if (safeSeratoJourneyReview) {
              setAxiomButtonBusy(directExportButton, true, 'Proving Serato export...');
              const proof = await requestAxiomBrowserSeratoProof({
                playlist: exportTracks,
                name: playlistName,
                order_source: exportOrderLabel,
                target: 'serato'
              });
              showToast(
                `Code check passed for ${proof.exported_tracks} tracks. "${playlistName}" was not added to live Serato.`,
                false,
                { important: true }
              );
              showSeratoExportSuccess(proof, playlistName, type);
              return;
            }
            setAxiomButtonBusy(directExportButton, true, djayMode ? 'Adding to djay...' : 'Adding to Serato...');
            const browserDelivery = djayMode ? null : await prepareAxiomBrowserSeratoDelivery();

                const delivery = await requestAxiomDjExport({ playlist: exportTracks, name: playlistName, order_source: exportOrderLabel, target: type });
                if (!delivery) return;
                const { response: resp, data } = delivery;
	            if (!resp.ok || !data.success) throw new Error(data.error || data.message || "Export failed");

            if (!djayMode) {
              await deliverAxiomBrowserSeratoPlaylist(data, browserDelivery);
              downloadAxiomBrowserExportFiles(data);
            }

            const skipped = Number(data.missing_tracks || 0);
            const duplicates = Number(data.duplicate_tracks || 0);
            const nativeVerified = !data.browser_download && data.delivery_verified === true;
	            if (!data.browser_download && !nativeVerified) throw new Error('Export was not verified. No completed handoff was confirmed.');
	            if (!djayMode && !data.browser_download &&
	                (data.serato_library_registered !== true || data.database_readback_verified !== true)) {
	              throw new Error('Serato did not register this playlist and verify its track order. No export credit was used.');
	            }
	            if (!djayMode && !data.browser_download && data.serato_opened !== true &&
	                typeof hasAxiomNativePicker === 'function' && hasAxiomNativePicker()) {
	              try {
	                const opened = await axiomNativePick('openSeratoApplication', 30000);
	                data.serato_opened = opened?.success === true && opened?.opened === true;
	                data.serato_app_name = opened?.application || data.serato_app_name || '';
	              } catch (error) {
	                data.serato_opened = false;
	              }
	            }
	            if (!djayMode && !data.browser_download && data.serato_opened !== true) {
	              throw new Error(
	                `Playlist ${data.serato_playlist_name || playlistName} was registered, but Serato did not open automatically. ` +
	                'Open Serato DJ Pro manually and check the playlist. No export credit was used.'
	              );
	            }
	            if (!djayMode && !consumeLiteSeratoExportCredit()) return;
	            const message = djayMode
	              ? `djay Pro playlist added and verified with ${data.exported_tracks} tracks. Find ${data.djay_playlist_name} in My Collection > Playlists.`
              : data.serato_library_registered
                ? `Serato playlist registered with ${data.exported_tracks} tracks in verified order. Look for ${data.serato_playlist_name}.`
              : nativeVerified
              ? data.serato_opened
                ? `Serato crate file saved with ${data.exported_tracks} tracks. Check the playlist in Serato DJ Pro.`
                : `Serato crate file saved with ${data.exported_tracks} tracks. Open Serato DJ Pro to check it.`
              : data.browser_root_written
                ? `Serato crate added to Subcrates with ${data.exported_tracks} tracks. Restart Serato to see it.`
                : (skipped
                ? `Manual Serato playlist downloaded: ${data.exported_tracks}/${data.total_tracks} tracks. ${skipped} unavailable safely skipped.`
                : `Manual Serato playlist downloaded with ${data.exported_tracks} tracks. Import the M3U8 in Serato.`);
            showToast(message, false);
            showSeratoExportSuccess(data, playlistName, type);
          } catch (err) {
            console.error(`${type === 'djay' ? 'djay Pro playlist' : 'Serato crate'} export failed:`, err);
            if (type === 'djay') showDjayExportFailure(err?.message);
            else showToast(err?.message || 'Serato crate export paused. Your music remains untouched.', true);
          } finally {
            setAxiomButtonBusy(directExportButton, false);
            document.getElementById('export-spinner')?.classList.add('hidden');
          }
          return;
      }

      if (type === 'm3u') {
          document.getElementById('export-spinner')?.classList.remove('hidden');
          try {
            const BOM = '\uFEFF';
            let m3uContent = BOM + "#EXTM3U\r\n";
            exportTracks.forEach(track => {
              m3uContent += `#EXTINF:-1,${track.artist} - ${track.title}\r\n`;
              m3uContent += `${browserSafeExportPath(track)}\r\n`;
            });
            const blob = new Blob([m3uContent], { type: 'application/vnd.apple.mpegurl' });
            const timestamp = new Date().toISOString().slice(0, 10);
            if (!(await saveAxiomPlaylistFile(blob, `AXIOM_SET_${timestamp}.m3u8`))) return;
            showToast(`M3U8 exported in ${exportOrderLabel}.`);
          } catch (err) {
            showToast("Export failed: " + err.message, true);
          } finally {
            document.getElementById('export-spinner')?.classList.add('hidden');
          }
      } else {
          // CSV or XML (Server-side generated)
          const endpoint = type === 'csv' ? '/api/studio/export_csv' : '/api/studio/export_xml';
          document.getElementById('export-spinner')?.classList.remove('hidden');
          showToast(`Preparing ${type.toUpperCase()} export in ${exportOrderLabel}...`);
          try {
              const resp = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ playlist: exportTracks })
              });
              if (!resp.ok) throw new Error("Server error during export");
              const blob = await resp.blob();
              const timestamp = new Date().toISOString().slice(0, 10);
              const filename = type === 'csv' ? `AXIOM_EXPORT_${timestamp}.csv` : `AXIOM_REKORDBOX_${timestamp}.xml`;
              if (!(await saveAxiomPlaylistFile(blob, filename))) return;
              showToast(`${type.toUpperCase()} exported in ${exportOrderLabel}.`);
          } catch (err) {
              showToast(err?.message || `${type.toUpperCase()} Export failed`, true);
          } finally {
              document.getElementById('export-spinner')?.classList.add('hidden');
          }
      }
    }
