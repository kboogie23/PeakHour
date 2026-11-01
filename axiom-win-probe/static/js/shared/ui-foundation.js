    // Shared escaping, notifications, dialogs, and interaction utilities.
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function escapeJs(str) {
      if (!str) return '';
      // Unicode escapes preserve the JavaScript value while keeping quotes,
      // tags and entity-shaped metadata out of inline HTML attributes.
      return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        .replace(/["<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }

    function escapeJsAttribute(str) {
      return escapeHtml(escapeJs(str));
    }

    const CAMELOT_BY_MUSICAL_KEY = {
      "A MINOR": "8A", "A MIN": "8A", "AM": "8A",
      "E MINOR": "9A", "E MIN": "9A", "EM": "9A",
      "B MINOR": "10A", "B MIN": "10A", "BM": "10A",
      "F# MINOR": "11A", "F# MIN": "11A", "F#M": "11A", "GB MINOR": "11A", "GB MIN": "11A", "GBM": "11A",
      "C# MINOR": "12A", "C# MIN": "12A", "C#M": "12A", "DB MINOR": "12A", "DB MIN": "12A", "DBM": "12A",
      "G# MINOR": "1A", "G# MIN": "1A", "G#M": "1A", "AB MINOR": "1A", "AB MIN": "1A", "ABM": "1A",
      "D# MINOR": "2A", "D# MIN": "2A", "D#M": "2A", "EB MINOR": "2A", "EB MIN": "2A", "EBM": "2A",
      "A# MINOR": "3A", "A# MIN": "3A", "A#M": "3A", "BB MINOR": "3A", "BB MIN": "3A", "BBM": "3A",
      "F MINOR": "4A", "F MIN": "4A", "FM": "4A",
      "C MINOR": "5A", "C MIN": "5A", "CM": "5A",
      "G MINOR": "6A", "G MIN": "6A", "GM": "6A",
      "D MINOR": "7A", "D MIN": "7A", "DM": "7A",
      "C MAJOR": "8B", "C MAJ": "8B", "C": "8B",
      "G MAJOR": "9B", "G MAJ": "9B", "G": "9B",
      "D MAJOR": "10B", "D MAJ": "10B", "D": "10B",
      "A MAJOR": "11B", "A MAJ": "11B", "A": "11B",
      "E MAJOR": "12B", "E MAJ": "12B", "E": "12B",
      "B MAJOR": "1B", "B MAJ": "1B", "B": "1B", "CB MAJOR": "1B", "CB MAJ": "1B", "CB": "1B",
      "F# MAJOR": "2B", "F# MAJ": "2B", "F#": "2B", "GB MAJOR": "2B", "GB MAJ": "2B", "GB": "2B",
      "C# MAJOR": "3B", "C# MAJ": "3B", "C#": "3B", "DB MAJOR": "3B", "DB MAJ": "3B", "DB": "3B",
      "G# MAJOR": "4B", "G# MAJ": "4B", "G#": "4B", "AB MAJOR": "4B", "AB MAJ": "4B", "AB": "4B",
      "D# MAJOR": "5B", "D# MAJ": "5B", "D#": "5B", "EB MAJOR": "5B", "EB MAJ": "5B", "EB": "5B",
      "A# MAJOR": "6B", "A# MAJ": "6B", "A#": "6B", "BB MAJOR": "6B", "BB MAJ": "6B", "BB": "6B",
      "F MAJOR": "7B", "F MAJ": "7B", "F": "7B"
    };

    function camelotFromOpenKey(number, mode) {
      const openNumber = Number(number);
      if (!Number.isFinite(openNumber) || openNumber < 1 || openNumber > 12) return '';
      const camelotNumber = ((openNumber + 6) % 12) + 1;
      return `${camelotNumber}${String(mode || '').toLowerCase() === 'm' ? 'A' : 'B'}`;
    }

    function normalizeCamelotKey(value = '') {
      const text = String(value || '').replace(/\0/g, '').trim();
      if (!text) return '';
      const camelot = text.match(/\b(1[0-2]|[1-9])\s*([AB])\b/i);
      if (camelot) return `${camelot[1]}${camelot[2].toUpperCase()}`;
      const openKey = text.match(/\b(1[0-2]|[1-9])\s*([md])\b/i);
      if (openKey) return camelotFromOpenKey(openKey[1], openKey[2]);
      const normalized = text
        .replace(/[♯＃]/g, '#')
        .replace(/[♭]/g, 'B')
        .replace(/\bSHARP\b/gi, '#')
        .replace(/\bFLAT\b/gi, 'B')
        .replace(/\s+#/g, '#')
        .replace(/\b([A-G])\s+B\b/gi, '$1B')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      return CAMELOT_BY_MUSICAL_KEY[normalized] || '';
    }

    function modalBpmValue(track = {}) {
      const bpm = Number(track.bpm || track.serato_bpm || track.average_bpm || track.averageBpm || track.tempo || track.TBPM || track.tmpo || 0);
      return Number.isFinite(bpm) && bpm >= 40 && bpm <= 220 ? Math.round(bpm * 10) / 10 : 0;
    }

    function modalDurationSeconds(track = {}) {
      const direct = Number(track.durationSec || track.duration_sec || track.duration_seconds || track.length_seconds || 0);
      if (Number.isFinite(direct) && direct > 0) return direct;
      const millis = Number(track.duration_ms || track.durationInMillis || track.durationMillis || 0);
      if (Number.isFinite(millis) && millis > 0) return millis / 1000;
      const minutes = Number(track.duration_min || track.duration_minutes || 0);
      if (Number.isFinite(minutes) && minutes > 0) return minutes * 60;
      const generic = Number(track.duration || track.length || 0);
      return Number.isFinite(generic) && generic > 0 ? generic : 0;
    }

    function normalizeModalTrackMetadata(track = {}) {
      const next = { ...track };
      const bpm = modalBpmValue(next);
      const camelot = normalizeCamelotKey(next.camelot || next.key || next.key_raw || next.initial_key || next.initialKey || next.tonality || '');
      const duration = modalDurationSeconds(next);
      if (bpm) next.bpm = bpm;
      if (camelot) next.camelot = camelot;
      if (duration) {
        next.durationSec = duration;
        next.duration_sec = duration;
      }
      if (!next.key_raw && (track.camelot || track.key || track.initial_key || track.initialKey || track.tonality)) {
        next.key_raw = track.camelot || track.key || track.initial_key || track.initialKey || track.tonality;
      }
      return next;
    }

    function camelotClass(camelot) {
      const raw = normalizeCamelotKey(camelot) || String(camelot || '').trim().toUpperCase();
      if (!raw || raw === '--') return 'camelot-unknown';
      return raw.endsWith('B') ? 'camelot-b' : 'camelot-a';
    }

    function saveHistory() {
      playlistHistory.push(JSON.parse(JSON.stringify(currentPlaylist)));
      if (playlistHistory.length > 30) playlistHistory.shift();
    }

    function undoLastAction() {
      if (playlistHistory.length === 0) {
        showToast("Nothing to undo", true);
        return;
      }
      currentPlaylist = playlistHistory.pop();
      recalculateAudit();
      showToast("Undo successful");
    }

    function playerNotificationDuration(message = '', hasAction = false) {
      const readingTime = 2800 + (String(message || '').length * 34);
      return Math.min(hasAction ? 10000 : 8200, Math.max(hasAction ? 6500 : 3800, readingTime));
    }

    function playerNotificationMessage(message = '') {
      const withoutSafetySuffix = String(message || '')
        .replace(/\s*AXIOM will keep (?:your\s+)?(?:source audio|audio source) (?:(?:stays|remains|is)\s+)?untouched\.?/gi, '')
        .replace(/\s*(?:while|and)\s+(?:your\s+)?(?:source audio|audio source) (?:(?:stays|remains|is)\s+)?untouched\.?/gi, '')
        .replace(/\s*(?:[\u2014\u00b7|,:;\-]\s*)?(?:your\s+)?(?:source audio|audio source) (?:(?:stays|remains|is)\s+)?untouched\.?/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.!?])/g, '$1')
        .replace(/\.{2,}/g, '.')
        .trim();
      return withoutSafetySuffix || 'AXIOM is working.';
    }

    function playerNotificationPhase(message = '', { isError = false, hasAction = false } = {}) {
      if (isError) return { className: 'is-error', label: 'AXIOM NEEDS YOUR ATTENTION', status: 'CHECK' };
      if (hasAction) return { className: 'has-action', label: 'AXIOM ACTION READY', status: '' };
      // Working Set is a product name, not a running operation. Keep actual
      // progress verbs so "Loading saved Working Set tracks" still stays open.
      const normalized = String(message || '').toLowerCase().replace(/\bworking\s+set\b/g, 'set');
      const working = /\b(exporting|checking|reviewing|looking|relocating|resetting|removing|banning|building|preparing|scanning|gathering|starting|working|reading|refreshing|restoring|applying|importing|processing|loading|saving|connecting|finding|updating|halving|doubling)\b/.test(normalized);
      const complete = /\b(saved|applied|updated|finished|refreshed|removed|imported|restored|cleared|added|complete|completed|ready|found|delivered|created)\b/.test(normalized);
      if (working) return { className: 'is-info is-working', label: 'AXIOM IS WORKING', status: 'WORKING' };
      if (complete) return { className: 'is-info is-complete', label: 'AXIOM UPDATE COMPLETE', status: 'DONE' };
      return { className: 'is-info', label: 'AXIOM UPDATE', status: 'ACTIVE' };
    }

    function playerNotificationPolicy(message = '', { isError = false, hasAction = false, phase = {} } = {}) {
      const normalized = String(message || '').toLowerCase();
      if (hasAction) return { kind: 'action', persistent: true, priority: 3 };
      if (String(phase.className || '').includes('is-working')) {
        return { kind: 'working', persistent: true, priority: 2 };
      }
      if (isError) {
        const lowStakesValidation = /^(nothing to|no .+ to|choose |select |add |type |enter |already |set is empty|favorites is empty|target bpm must|that track needs)/i.test(String(message || '').trim());
        const importantFailure = /\b(failed|could not|cannot|paused|stopped|permission|accessibility|reconnect|blocked|backup|before closing|needs your attention)\b/i.test(normalized)
          || /\bonly available in axiom pro\b/i.test(normalized);
        return {
          kind: importantFailure && !lowStakesValidation ? 'urgent' : 'validation',
          persistent: importantFailure && !lowStakesValidation,
          priority: importantFailure && !lowStakesValidation ? 3 : 1
        };
      }
      if (String(phase.className || '').includes('is-complete')) {
        return { kind: 'success', persistent: false, priority: 1, duration: 5000 };
      }
      return { kind: 'info', persistent: false, priority: 0, duration: 3000 };
    }

    function shouldShowDawNotification(message, { isError = false, hasAction = false, important = false } = {}) {
      if (!document.body.classList.contains('studio-daw-mode-active') || isError || hasAction || important) return true;
      // Editing already shows its result in the timeline. Keep confirmations
      // for durable saves, recovery and completed background work.
      return /\b(saved|exported|recovered)\b|\bproject file downloaded\b|\bstems ready\b|\bseparation (?:complete|cancelled)\b|\bportable project (?:ready|opened)\b/i.test(String(message || ''));
    }

    function quietDawNotifications() {
      const player=document.getElementById('audio-player');
      if(!player||!document.body.classList.contains('studio-daw-mode-active'))return;
      player.querySelectorAll('.player-notification-surface').forEach(surface=>{
        if(!shouldShowDawNotification(surface.querySelector('strong')?.textContent,{
          isError:surface.classList.contains('is-error'),hasAction:Boolean(surface.querySelector('.player-notification-action')),
          important:surface.dataset.notificationImportant==='true'
        }))surface.remove();
      });
      if(!player.querySelector('.player-notification-surface')){
        clearTimeout(player._axiomNotificationTimer);clearTimeout(player._axiomNotificationExitTimer);
        player.classList.remove('player-notification-active','player-notification-error','player-notification-leaving');
      }
    }

    function showPlayerNotification(message, { isError = false, actionLabel = '', actionFn = null, duration = 0, important = false } = {}) {
      if (!shouldShowDawNotification(message, { isError, hasAction: Boolean(actionLabel && typeof actionFn === 'function'), important })) {quietDawNotifications();return true;}
      const player = document.getElementById('audio-player');
      if(document.body.classList.contains('studio-daw-mode-active')&&!document.body.classList.contains('daw-player-visible'))return false;
      const normalizedMessage = playerNotificationMessage(message);
      if (!player || !normalizedMessage) return false;

      // Playback continuity is a hard contract: this path may only add/remove
      // notification UI and player-shell classes. It must never call the audio
      // engine or alter pause state, playhead, source, volume, or playback rate.

      const hasAction = Boolean(actionLabel && typeof actionFn === 'function');
      const phase = playerNotificationPhase(normalizedMessage, { isError, hasAction });
      const policy = playerNotificationPolicy(normalizedMessage, { isError, hasAction, phase });
      const existingSurface = player.querySelector('.player-notification-surface:not(.is-leaving)');
      const existingKind = existingSurface?.dataset.notificationKind || '';
      const existingPriority = Number(existingSurface?.dataset.notificationPriority || 0);
      const incomingResolvesWorking = existingKind === 'working' && ['success', 'urgent', 'action'].includes(policy.kind);
      if (existingSurface?.dataset.notificationPersistent === 'true'
          && existingPriority > policy.priority
          && !incomingResolvesWorking) {
        return true;
      }

      clearTimeout(player._axiomNotificationTimer);
      clearTimeout(player._axiomNotificationExitTimer);
      // A replacement can arrive during the previous surface's exit animation.
      // Its exit timer is cancelled above, so remove leaving surfaces too or
      // they keep the player shell active and its transport pointer-disabled.
      player.querySelectorAll('.player-notification-surface').forEach(previous => previous.remove());
      player.classList.remove('player-notification-leaving');

      const displayDuration = Number(duration) || Number(policy.duration) || playerNotificationDuration(normalizedMessage, hasAction);
      const surface = document.createElement('section');
      surface.className = `player-notification-surface ${phase.className} ${policy.persistent ? 'is-persistent' : ''}`;
      surface.dataset.playbackPolicy = 'continue';
      surface.dataset.notificationKind = policy.kind;
      surface.dataset.notificationPriority = String(policy.priority);
      surface.dataset.notificationPersistent = String(policy.persistent);
      surface.dataset.notificationImportant = String(important);
      surface.setAttribute('role', isError ? 'alert' : 'status');
      surface.setAttribute('aria-live', isError ? 'assertive' : 'polite');
      surface.style.setProperty('--player-notification-duration', `${displayDuration}ms`);
      surface.innerHTML = `
        <span class="player-notification-signal" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="player-notification-copy">
          <small>${phase.label}</small>
          <strong>${escapeHtml(normalizedMessage)}</strong>
        </span>
        ${hasAction ? `<button type="button" class="player-notification-action">${escapeHtml(actionLabel)}</button>` : `<span class="player-notification-status" aria-hidden="true">${phase.status}</span>`}
        <button type="button" class="player-notification-dismiss" aria-label="Dismiss notification" title="Dismiss notification">×</button>
        <span class="player-notification-timeline" aria-hidden="true"></span>
      `;

      const restorePlayer = () => {
        if (!surface.isConnected || surface.classList.contains('is-leaving')) return;
        surface.classList.add('is-leaving');
        player.classList.add('player-notification-leaving');
        player._axiomNotificationExitTimer = setTimeout(() => {
          surface.remove();
          if (!player.querySelector('.player-notification-surface')) {
            player.classList.remove('player-notification-active', 'player-notification-error', 'player-notification-leaving');
          }
        }, 420);
      };

      surface.querySelector('.player-notification-action')?.addEventListener('click', () => {
        restorePlayer();
        actionFn();
      });
      surface.querySelector('.player-notification-dismiss')?.addEventListener('click', restorePlayer);

      player.appendChild(surface);
      player.classList.toggle('player-notification-error', isError);
      player.classList.add('player-notification-active');
      requestAnimationFrame(() => surface.classList.add('is-visible'));
      if (!policy.persistent) {
        player._axiomNotificationTimer = setTimeout(restorePlayer, displayDuration);
      }
      return true;
    }

    function showToast(msg, isError = false, options = {}) {
      const normalizedMessage = playerNotificationMessage(msg);
      const important = Boolean(options?.important);
      if (showPlayerNotification(normalizedMessage, { isError, important })) return;
      const fallbackPhase = playerNotificationPhase(normalizedMessage, { isError });
      const fallbackPolicy = playerNotificationPolicy(normalizedMessage, { isError, phase: fallbackPhase });
      const toastKey = /^activate axiom before\b/i.test(normalizedMessage)
        ? 'activation-required'
        : normalizedMessage.toLowerCase().replace(/\s+/g, ' ').slice(0, 180);
      const container = document.getElementById('toast-container');
      container?.querySelectorAll('[data-toast-key]').forEach(existing => {
        if (existing.dataset.toastKey === toastKey) existing.remove();
      });
      const toast = document.createElement('div');
      toast.className = `glass px-6 py-4 rounded-xl border ${isError ? 'border-red-500/50 text-red-400' : 'border-axiom-accent/50 text-axiom-accent'} text-[11px] font-black uppercase tracking-widest shadow-lg animate-fade-in translate-y-0 transition-all duration-300`;
      toast.dataset.toastKey = toastKey;
      toast.dataset.notificationPersistent = String(fallbackPolicy.persistent);
      toast.dataset.notificationImportant = String(important);
      toast.innerHTML = `<span>${escapeHtml(normalizedMessage)}</span><button type="button" aria-label="Dismiss notification" title="Dismiss notification">×</button>`;
      toast.querySelector('button')?.addEventListener('click', () => toast.remove());
      container?.appendChild(toast);
      if (!fallbackPolicy.persistent) {
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-10px)';
          setTimeout(() => toast.remove(), 300);
        }, Number(fallbackPolicy.duration) || 3000);
      }
    }

    function setAxiomButtonBusy(btn, busy, busyText = '') {
      if (!btn) return;
      if (busy) {
        if (!btn.dataset.axiomIdleHtml) btn.dataset.axiomIdleHtml = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.style.cursor = 'wait';
        if (busyText) btn.innerHTML = busyText;
      } else {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
        if (btn.dataset.axiomIdleHtml) {
          btn.innerHTML = btn.dataset.axiomIdleHtml;
          delete btn.dataset.axiomIdleHtml;
        }
      }
    }

    function closeSeratoSuccessModal() {
      const modal = document.getElementById('serato-success-overlay');
      if (modal) modal.remove();
      document.removeEventListener('keydown', handleSeratoSuccessEscape);
    }

    function handleSeratoSuccessEscape(event) {
      if (event.key === 'Escape') closeSeratoSuccessModal();
    }

    // ===== AXIOM STUDIO DIALOG MODALS =====
    function closeAxiomDialog() {
      const el = document.getElementById('axiom-dialog-overlay');
      if (el) el.remove();
      document.removeEventListener('keydown', _axiomDialogEscape);
    }

    function _axiomDialogEscape(e) {
      if (e.key === 'Escape') closeAxiomDialog();
      const dialog = document.querySelector('#axiom-dialog-overlay.vault-playlist');
      if (e.key === 'Tab' && dialog) {
        const controls = Array.from(dialog.querySelectorAll('button:not(:disabled), input')).filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && e.target === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && e.target === last) { e.preventDefault(); first?.focus(); }
      }
    }

    function ensurePlaylistVaultStyles() {
      ensureAxiomRecordVaultStyles();
      if (document.querySelector('link[data-playlist-vault-style]')) return;
      const style = document.createElement('link');
      style.rel = 'stylesheet'; style.dataset.playlistVaultStyle = '1';
      style.href = axiomRecordVaultStaticUrl('css/surfaces/playlists/vault.css');
      document.head.appendChild(style);
    }

    function playlistVaultMarkup({titleId, title, copy, content = '', actions}) {
      const words = String(title).trim().split(/\s+/);
      const finalWord = words.pop();
      const titleHtml = `${escapeHtml(words.join(' '))}<br /><em>${escapeHtml(finalWord || '')}</em>`;
      return `<div class="axiom-dialog-card vault-export-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="vault-brand"><b>AXIOM<small>PRO</small></b><span>PLAYLISTS / YOUR COLLECTION</span></div>
        <button class="axiom-dialog-close" type="button" onclick="closeAxiomDialog()" aria-label="Close">×</button>
        <div class="vault-export-layout"><div class="vault-export-copy">
          <p class="vault-export-kicker">A SET WORTH KEEPING.</p>
          <h2 id="${titleId}" class="playlist-vault-title">${titleHtml}</h2>
          <p class="vault-export-description">${copy}</p>${content}
          <div class="axiom-dialog-actions">${actions}</div>
        </div><div class="vault-export-art playlist-vault-art" aria-hidden="true"><img src="${axiomRecordVaultStaticUrl('assets/record-vault/crate.png')}" alt="" /></div></div>
      </div>`;
    }

    function showSetNameModal(defaultName, onConfirm) {
      closeAxiomDialog();
      const overlay = document.createElement('div');
      overlay.id = 'axiom-dialog-overlay';
      ensurePlaylistVaultStyles();
      overlay.className = 'axiom-dialog-overlay record-vault-export vault-playlist';
      overlay.innerHTML = playlistVaultMarkup({
        titleId:'axiom-dialog-title-el', title:'Name Your Set',
        copy:'Save the songs, the order and the work. Your set will be ready to reopen and refine in Studio.',
        content:`<label class="vault-name-field" for="axiom-dialog-input">Set name</label><input id="axiom-dialog-input" type="text" class="axiom-dialog-input" value="${escapeHtml(defaultName)}" placeholder="Set name..." autocomplete="off" /><p class="playlist-vault-note">Saved in AXIOM Playlists. Your source music stays untouched.</p>`,
        actions:'<button class="axiom-dialog-btn" type="button" onclick="closeAxiomDialog()">Cancel</button><button class="axiom-dialog-btn primary" type="button" id="axiom-dialog-confirm-btn">Save Set</button>'
      });
      document.body.appendChild(overlay);
      const input = document.getElementById('axiom-dialog-input');
      const confirmBtn = document.getElementById('axiom-dialog-confirm-btn');
      if (input) { input.focus(); input.select(); }
      const doConfirm = () => {
        const val = (input ? input.value : '').trim();
        if (!val) { input?.focus(); return; }
        closeAxiomDialog();
        onConfirm(val);
      };
      if (confirmBtn) confirmBtn.addEventListener('click', doConfirm);
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
      overlay.addEventListener('click', e => { if (e.target === overlay) closeAxiomDialog(); });
      document.addEventListener('keydown', _axiomDialogEscape);
    }

    function showAxiomTextPrompt({
      kicker = 'AXIOM Studio',
      title = 'Name This Export',
      copy = 'Choose the name AXIOM should use for this handoff.',
      defaultValue = '',
      placeholder = 'Export name...',
      confirmText = 'Continue'
    } = {}) {
      return new Promise(resolve => {
        closeAxiomDialog();
        const overlay = document.createElement('div');
        overlay.id = 'axiom-dialog-overlay';
        overlay.className = 'axiom-dialog-overlay';
        overlay.innerHTML = `
          <div class="axiom-dialog-card" role="dialog" aria-modal="true" aria-labelledby="axiom-text-prompt-title">
            <button id="axiom-text-prompt-close" class="axiom-dialog-close" type="button" aria-label="Close">×</button>
            <div class="axiom-dialog-icon" aria-hidden="true">
              <img src="/static/icons/database.svg" alt="" width="30" height="30" />
            </div>
            <div class="axiom-dialog-kicker">${escapeHtml(kicker)}</div>
            <h2 id="axiom-text-prompt-title" class="axiom-dialog-title">${escapeHtml(title)}</h2>
            <p class="axiom-dialog-copy">${escapeHtml(copy)}</p>
            <input id="axiom-text-prompt-input" type="text" class="axiom-dialog-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
            <div class="axiom-dialog-actions">
              <button id="axiom-text-prompt-cancel" class="axiom-dialog-btn" type="button">Cancel</button>
              <button id="axiom-text-prompt-confirm" class="axiom-dialog-btn primary" type="button">${escapeHtml(confirmText)}</button>
            </div>
          </div>
        `;
        if (kicker === 'AXIOM Playlists') {
          ensurePlaylistVaultStyles();
          overlay.className = 'axiom-dialog-overlay record-vault-export vault-playlist';
          overlay.innerHTML = playlistVaultMarkup({titleId:'axiom-text-prompt-title',title,copy:escapeHtml(copy),
            content:`<label class="vault-name-field" for="axiom-text-prompt-input">Set name</label><input id="axiom-text-prompt-input" type="text" class="axiom-dialog-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" /><p class="playlist-vault-note">The songs and running order stay exactly as saved.</p>`,
            actions:`<button id="axiom-text-prompt-cancel" class="axiom-dialog-btn" type="button">Cancel</button><button id="axiom-text-prompt-confirm" class="axiom-dialog-btn primary" type="button">${escapeHtml(confirmText)}</button>`
          });
          overlay.querySelector('.axiom-dialog-close').id = 'axiom-text-prompt-close';
          overlay.querySelector('.axiom-dialog-close').removeAttribute('onclick');
        }
        document.body.appendChild(overlay);

        const input = overlay.querySelector('#axiom-text-prompt-input');
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          document.removeEventListener('keydown', handleKeydown);
          overlay.remove();
          resolve(value);
        };
        const submit = () => {
          const value = String(input?.value || '').trim();
          if (value) finish(value);
          else input?.focus();
        };
        const handleKeydown = event => {
          if (event.key === 'Escape') finish(null);
          if (event.key === 'Enter' && event.target === input) submit();
          if (event.key === 'Tab' && overlay.classList.contains('vault-playlist')) _axiomDialogEscape(event);
        };

        overlay.querySelector('#axiom-text-prompt-close')?.addEventListener('click', () => finish(null));
        overlay.querySelector('#axiom-text-prompt-cancel')?.addEventListener('click', () => finish(null));
        overlay.querySelector('#axiom-text-prompt-confirm')?.addEventListener('click', submit);
        overlay.addEventListener('click', event => { if (event.target === overlay) finish(null); });
        document.addEventListener('keydown', handleKeydown);
        input?.focus();
        input?.select();
      });
    }

    function showClearSetConfirm(onConfirm) {
      closeAxiomDialog();
      const overlay = document.createElement('div');
      overlay.id = 'axiom-dialog-overlay';
      overlay.className = 'axiom-dialog-overlay';
      overlay.innerHTML = `
        <div class="axiom-dialog-card" role="dialog" aria-modal="true" aria-labelledby="axiom-dialog-title-el">
          <button class="axiom-dialog-close" type="button" onclick="closeAxiomDialog()" aria-label="Close">×</button>
          <div class="axiom-dialog-icon" style="background: linear-gradient(135deg, rgba(239,68,68,0.8), rgba(185,28,28,0.9)); box-shadow: 0 0 28px rgba(239,68,68,0.35);" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="axiom-dialog-kicker" style="color:#ef4444;">Clear Set</div>
          <h2 id="axiom-dialog-title-el" class="axiom-dialog-title">Clear Your Work?</h2>
          <p class="axiom-dialog-copy">This will remove all tracks from the current Studio session. Your saved playlists and source audio are not affected.</p>
          <div class="axiom-dialog-actions">
            <button class="axiom-dialog-btn" type="button" onclick="closeAxiomDialog()">Keep Set</button>
            <button class="axiom-dialog-btn danger" type="button" id="axiom-dialog-confirm-btn">Clear Set</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const confirmBtn = document.getElementById('axiom-dialog-confirm-btn');
      if (confirmBtn) confirmBtn.addEventListener('click', () => { closeAxiomDialog(); onConfirm(); });
      overlay.addEventListener('click', e => { if (e.target === overlay) closeAxiomDialog(); });
      document.addEventListener('keydown', _axiomDialogEscape);
    }

    function showSaveSetSuccess(setName, trackCount, mode) {
      closeAxiomDialog();
      const orderLabel = mode === 'performance' ? 'Live' : (getActiveStudioOutputLabel ? getActiveStudioOutputLabel() : 'Manual');
      const modeLabel = mode === 'backup' ? 'Backup Downloaded' : mode === 'updated' ? 'Set Updated' : mode === 'performance' ? 'Session Saved' : 'Set Saved';
      const modeCopy = mode === 'draft'
        ? `<strong>${escapeHtml(setName)}</strong> has been saved to your Playlists. You can close the browser and load it from Playlists later.`
        : mode === 'backup'
        ? `<strong>${escapeHtml(setName)}.json</strong> has been downloaded as a backup file. To keep it inside AXIOM, use Save Set.`
        : mode === 'updated'
        ? `<strong>${escapeHtml(setName)}</strong> has been updated in your Playlists with the latest changes from Studio.`
        : mode === 'performance'
        ? `<strong>${escapeHtml(setName)}</strong> has been saved from Performance Mode with your live DJ timeline and audit summary.`
        : `<strong>${escapeHtml(setName)}</strong> has been saved to your Playlists in <strong>${escapeHtml(orderLabel)}</strong> and is ready to perform.`;

      if (!['backup', 'updated'].includes(String(mode || ''))) {
        recordAxiomSessionActivity('playlist', 1, {
          key: `playlist:${String(setName || 'AXIOM Set')}:${Date.now()}`,
          relatedCount: Math.max(0, Number(trackCount || 0)),
          includeTrackImpact: false,
        });
      }

      const overlay = document.createElement('div');
      overlay.id = 'axiom-dialog-overlay';
      ensurePlaylistVaultStyles();
      overlay.className = 'axiom-dialog-overlay record-vault-export vault-playlist';
      overlay.innerHTML = playlistVaultMarkup({titleId:'axiom-save-title',title:modeLabel,copy:modeCopy,
        content:`<p class="vault-finished-name">${escapeHtml(setName)}</p><div class="vault-export-summary"><div><strong>${Number(trackCount || 0)}</strong><span>TRACKS</span></div><div><b>${escapeHtml(orderLabel)}</b><span>RUNNING ORDER</span></div></div>`,
        actions:`${mode === 'backup' ? '' : '<button class="axiom-dialog-btn" type="button" onclick="closeAxiomDialog(); showTab(\'playlists\');">View In Playlists</button>'}<button class="axiom-dialog-btn primary" type="button" onclick="closeAxiomDialog()">Done</button>`
      });
      document.body.appendChild(overlay);
      overlay.querySelector('.primary')?.focus();
      overlay.addEventListener('click', e => { if (e.target === overlay) closeAxiomDialog(); });
      document.addEventListener('keydown', _axiomDialogEscape);
    }
