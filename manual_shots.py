"""The user manual's screenshots: name, JavaScript steps (with wait(), $() and clickText()), optional
element to crop to. Used by make_manual_screenshots.py; keep in step with the manual
(axiom-win-probe/static/manual/index.html): a new or changed screen gets a shot here."""
# A music video on the owner's E: drive (read only); the shot is skipped when the drive is not connected.
VIDEO_FILE = r'E:\Video\Reggae\Farruko - Besas Tan Bien [DJ Montalvo Reggaeton Old School] [Intro-Outro].mp4'
VIDEO = ("AxiomWindowsVideoPreview.open(VIDEO, 'Besas Tan Bien [DJ Montalvo Reggaeton Old School] [Intro-Outro] 86', {artist: 'Farruko'});"
         "await wait(4000); const v = document.querySelector('dialog[open] video'); v.removeAttribute('src'); v.load(); v.poster = FRAME;"
         "document.querySelector('dialog[open] [role=status]').textContent = '';")
# Adds Library songs to the set (the sandbox's own data); a song without BPM asks to be prepared first.
ADD_SONGS = ("showTab('library'); await wait(3500); const adds = [...document.querySelectorAll('#tab-content-library button')]"
             ".filter(b => shown(b) && b.innerText.trim().toUpperCase() === 'ADD').slice(0, 6);"
             "for (const b of adds) { b.click(); await wait(900); try { clickText('Prepare & Add'); } catch (_) {} await wait(900); }"
             "await wait(2000);")
SHOTS = [
    {'name': 'welcome', 'steps': "localStorage.removeItem('axiomWalkthroughV2Seen'); showAxiomArrival(true); await wait(2000);"},
    {'name': 'home', 'steps': 'await wait(4000);'},
    {'name': 'sources', 'steps': "openLibrarySourcePicker(); await wait(2000);"},
    {'name': 'sources-more', 'steps': "openLibrarySourcePicker(); await wait(2000); const g = [...document.querySelectorAll('.library-source-choice')].pop(); g.scrollIntoView({block: 'end'}); await wait(800);"},
    {'name': 'library', 'steps': "showTab('library'); await wait(2500);"},
    {'name': 'library-type', 'element': '#library-top-sort-bar',
     'steps': "showTab('library'); await wait(3000); const s = $('#ph-library-filetype'); s.value = 'video';"
              "s.dispatchEvent(new Event('change', {bubbles: true})); await wait(2500);"},
    {'name': 'video-preview', 'steps': "showTab('library'); await wait(2000);" + VIDEO, 'frame': (VIDEO_FILE, 40)},
    {'name': 'track-prep', 'steps': "showTab('library'); await wait(2500); clickText('Track Prep'); await wait(2500);"},
    {'name': 'paste-playlist', 'steps': "showTab('library'); await wait(2500); await wait(1500); clickText('Paste a Playlist'); await wait(2500);"},
    {'name': 'magic-set', 'steps': "showStudioWorkspace(); await wait(2500); openMagicSetWorkspace(); await wait(3000);"},
    {'name': 'prepare-track', 'steps': "showTab('library'); await wait(3500); [...document.querySelectorAll('#tab-content-library button')]"
                                       ".filter(b => shown(b) && b.innerText.trim().toUpperCase() === 'ADD')[1].click(); await wait(1500);"},
    {'name': 'studio-set', 'steps': ADD_SONGS + "showStudioWorkspace(); await wait(3000);"},
    {'name': 'studio-export', 'steps': "showStudioWorkspace(); await wait(3000); clickText('Export', '#tab-content-studio'); await wait(1500);"},
    {'name': 'export-menu', 'steps': "showStudioWorkspace(); await wait(2000); $('#tab-btn-export').click(); await wait(1200);"},
    {'name': 'studio-tools', 'steps': "showStudioWorkspace(); await wait(2000); $('#studio-tools-dropdown-btn').click(); await wait(1200);"},
    {'name': 'performance', 'steps': "showTab('performance'); await wait(3000);"},
    {'name': 'playlists', 'steps': "showTab('playlists'); await wait(3000);"},
    {'name': 'playlists-menu', 'steps': "showTab('library'); await wait(2000); $('#tab-btn-playlists').click(); await wait(1200);"},
    {'name': 'health', 'steps': "showTab('health'); await wait(4000);"},
    {'name': 'ai-connect', 'steps': "PeakHourAI.open(); await wait(2500);"},
    {'name': 'ai-check', 'steps': "PeakHourAI.open(); await wait(2000); clickText('Check my library'); await wait(2000);"},
    {'name': 'ai-review', 'steps': "PeakHourAI.open(); await wait(2000); clickText('Review & apply'); await wait(2500);"},
    {'name': 'ai-playlist', 'steps': "PeakHourAI.open(); await wait(2000); clickText('Build a playlist'); await wait(2000);"},
    {'name': 'settings', 'steps': "toggleMasterHud(); await wait(1500);"},
    # The sandbox has Chrome chosen (fixtures/walkthrough/axiom-data/window-browser.json) while its window is Edge.
    {'name': 'settings-browser', 'element': 'article:has(#settings-window-browser)',
     'steps': "toggleMasterHud(); await wait(1200); clickText('System'); await wait(1200);"
              "$('#settings-window-browser').closest('article').scrollIntoView({block: 'center'}); await wait(800);"},
    {'name': 'settings-workflow', 'steps': "toggleMasterHud(); await wait(1200); clickText('Workflow'); await wait(1200);"},
]
