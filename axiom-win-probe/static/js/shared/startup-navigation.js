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

async function initializeStartupWorkflow() {
  await loadLibraryStats();
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
