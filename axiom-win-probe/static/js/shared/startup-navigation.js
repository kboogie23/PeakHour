// Shared startup routing, theme application, and sidebar handoffs.
const STARTUP_WORKFLOW_KEY = 'axiomStartupWorkflowMode.v1';

function startupWorkflowMode() {
  return localStorage.getItem(STARTUP_WORKFLOW_KEY) === 'library' ? 'library' : 'build';
}

function setStartupWorkflowMode(value) {
  const mode = value === 'library' ? 'library' : 'build';
  localStorage.setItem(STARTUP_WORKFLOW_KEY, mode);
  const select = document.getElementById('startup-workflow-select');
  if (select && select.value !== mode) select.value = mode;
  showToast(mode === 'library' ? 'Startup set to Library.' : 'Startup set to Studio after music is added.');
}

function syncStartupWorkflowSetting() {
  const select = document.getElementById('startup-workflow-select');
  if (select) select.value = startupWorkflowMode();
}

function applyStartupWorkflow() {
  syncStartupWorkflowSetting();
  if (libraryHasTracks !== true) {
    showConnectMusicView();
  } else if (startupWorkflowMode() === 'library') {
    showTab('library');
  } else if (window.AxiomStudioAutosave?.hasWorkingSet()) {
    showStudioWorkspace();
    initSortable();
    recalculateAudit();
  } else {
    showStudioLaunchView();
  }
}

// libraryHasTracks stays null when /api/library/stats did not answer (a busy or still-starting server, a dropped
// request). That is "not known yet", never "no music": onboarding must only appear when the library is known to be empty.
async function waitForLibraryAnswer() {
  if (libraryHasTracks !== null) return;
  document.body.classList.add('library-loading');
  showToast('Loading your library...');
  // loadLibraryStats leaves libraryHasTracks null for a failed request and for a 200 without total_tracks.
  // After about a minute say so (the wait is kept in localStorage only so a test can shorten it) and keep asking slowly.
  let giveUpMs = 60000;
  try { giveUpMs = Number(localStorage.getItem('peakhour.libraryWaitMs')) || giveUpMs; } catch (_) { }
  const started = Date.now();
  let notice = null;
  for (let attempt = 1; libraryHasTracks === null; attempt++) {
    const silent = Date.now() - started >= giveUpMs;
    if (silent && !notice) {
      notice = document.createElement('div');
      notice.id = 'library-server-silent';
      notice.setAttribute('role', 'alert');
      notice.textContent = "PEAK HOUR's server isn't answering. Close PEAK HOUR and open it again.";
      notice.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;padding:12px 18px;border-radius:10px;background:#7f1d1d;color:#fff;font:600 14px sans-serif';
      document.body.appendChild(notice);
    }
    const wait = silent ? Math.min(15000, giveUpMs) : Math.min(1000 * attempt, 8000);
    await new Promise(resolve => setTimeout(resolve, wait));
    await loadLibraryStats(false);
  }
  notice?.remove();
  document.body.classList.remove('library-loading');
}

async function initializeStartupWorkflow() {
  await loadLibraryStats();
  await waitForLibraryAnswer();
  if (!window.AxiomEntrance?.libraryReady()) applyStartupWorkflow();
  if (axiomReviewMode() || axiomUiPreviewMode()) {
    await maybeStartAxiomUiPreview();
  }
}

function openCsvBuildFromSidebar() {
  if (!ensureLibraryBeforeCsv()) return;
  showStudioLaunchView();
  setTimeout(() => triggerCSVUpload(), 80);
}

function openSidebarPlaylists(event) {
  showTab('playlists');
  toggleSidebarDropdown(event, 'playlists');
}

function openSidebarCsvBuild() {
  closeSidebarDropdowns();
  openCsvBuildFromSidebar();
}

function openSidebarFavorites() {
  closeSidebarDropdowns();
  showTab('playlists');
  openFavoritesPanel();
}

async function openSidebarExport(type = 'serato') {
  closeSidebarDropdowns();
  await exportPlaylist(type);
}

document.addEventListener('DOMContentLoaded', async function() {
  if (window.AxiomDropbox && !await window.AxiomDropbox.finishPendingRestore()) return;
  loadTheme();
  applyLibraryArtworkPreference();
  loadSavedPlaylists();
  window.AxiomStudioAutosave?.initialize();
  initializeStartupWorkflow();
  loadSmartLinksFontScale();
  if (typeof loadPerformanceGigProfiles === 'function') loadPerformanceGigProfiles();
  loadFavorites();
});

function updateThemeChartColors() {
  if (bpmChartInstance) {
    const isLightNow = document.body.classList.contains('light-mode');
    const accentColor = isLightNow ? '#2563eb' : 'var(--accent)';
    const gridColor = isLightNow ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)';
    const labelColor = isLightNow ? '#555555' : '#666';
    const pointBg = isLightNow ? '#FFFFFF' : '#000';
    const accentFaint = isLightNow ? 'rgba(37, 99, 235, 0.05)' : 'rgba(163, 255, 0, 0.05)';

    bpmChartInstance.data.datasets[0].borderColor = accentColor;
    bpmChartInstance.data.datasets[0].backgroundColor = accentFaint;
    bpmChartInstance.data.datasets[0].pointBackgroundColor = pointBg;
    bpmChartInstance.data.datasets[0].pointBorderColor = accentColor;
    bpmChartInstance.data.datasets[1].pointBorderColor = isLightNow ? '#000' : '#fff';
    bpmChartInstance.data.datasets[2].backgroundColor = accentColor;
    bpmChartInstance.data.datasets[2].pointBorderColor = isLightNow ? '#000' : '#fff';
    bpmChartInstance.options.scales.x.grid.color = gridColor;
    bpmChartInstance.options.scales.y.grid.color = gridColor;
    bpmChartInstance.options.scales.x.ticks.color = labelColor;
    bpmChartInstance.options.scales.y.ticks.color = labelColor;
    bpmChartInstance.options.scales.x.title.color = labelColor;
    bpmChartInstance.options.scales.y.title.color = labelColor;
    bpmChartInstance.update();
  }
}

function applyAxiomTheme(mode) {
  const isLight = mode === 'light' || mode === 'day' || mode === 'green';
  document.body.classList.toggle('light-mode', isLight);
  document.documentElement.classList.toggle('light-mode', isLight);
  document.documentElement.setAttribute('data-theme', isLight ? 'green' : 'indigo');
  localStorage.setItem('axiomTheme', isLight ? 'light' : 'dark');
  localStorage.removeItem('theme');
  localStorage.removeItem('axiom-theme');
  updateThemeIcons();
  if (typeof updateThemeChartColors === 'function') updateThemeChartColors();
  if (typeof applyRescanBtnTheme === 'function') applyRescanBtnTheme();
}

function loadTheme() {
  const savedTheme = localStorage.getItem('axiomTheme') === 'light' ? 'light' : 'dark';
  applyAxiomTheme(savedTheme);
}

function updateThemeToggleLabel() {
  const sunIcon = document.getElementById('sun-icon');
  const moonIcon = document.getElementById('moon-icon');
  const isLight = document.body.classList.contains('light-mode');
  if (sunIcon && moonIcon) {
    sunIcon.classList.toggle('hidden', !isLight);
    moonIcon.classList.toggle('hidden', isLight);
  }
  document.getElementById('theme-toggle')?.setAttribute('title', isLight ? 'Switch to Night Mode' : 'Switch to Day Mode');
}
