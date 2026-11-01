// AXIOM Health review, era audit, and duplicate resolver controls.
let currentEraAuditData = null;
let currentEraRefinementYearBasis = 'original_song';
let currentEraAuditReceipt = null;
let currentEraAuditSelected = new Set();
let eraAuditDragSelection = null;
let eraAuditApplying = false;
let eraAuditDemoTimer = null;
let currentConnectedHealthData = null;

function eraAuditDemoData(mode = 'smart', query = '', era = '', genre = '', folder = '') {
    const allRows = [
        {
            path: '/Music/DJ Superman/UB40 - Red Red Wine (DJ Superman Remix).mp3',
            title: 'Red Red Wine (DJ Superman Remix)', artist: 'UB40', filename: 'UB40 - Red Red Wine (DJ Superman Remix).mp3', folder: 'DJ Superman',
            current_year: 2026, current_era: 'New', effective_era: 'New', era_override: '', era_override_label: '',
            suggested_era: 'The 90s', suggested_era_label: '1990s', confidence: 'likely', confidence_score: 74,
            reason: 'The 2026 tag looks like the edit/export year. A matching library version places the recognizable song in the 1990s.',
            evidence: ['1 matching library version sits in 1990s (1993).'], suspicious: true
        },
        {
            path: '/Music/DJ Superman/Sean Paul - Temperature (DJ Superman Slam Edit).mp3',
            title: 'Temperature (DJ Superman Slam Edit)', artist: 'Sean Paul (Slam Edit)', filename: 'Sean Paul - Temperature (DJ Superman Slam Edit).mp3', folder: 'DJ Superman',
            current_year: 2026, current_era: 'New', effective_era: 'New', era_override: '', era_override_label: '',
            suggested_era: '2k Era', suggested_era_label: '2000s', confidence: 'likely', confidence_score: 60,
            reason: 'The current tag places this edit with new releases, but matching song evidence fits the 2000s.',
            evidence: ['2 matching library versions sit in 2000s (2005, 2006).'], suspicious: true
        },
        {
            path: '/Music/Music Junkie/Whitney Houston - I Wanna Dance (Music Junkie Slam Edit).mp3',
            title: 'I Wanna Dance (Music Junkie Slam Edit)', artist: 'Whitney Houston', filename: 'Whitney Houston - I Wanna Dance (Music Junkie Slam Edit).mp3', folder: 'Music Junkie',
            current_year: 2026, current_era: 'New', effective_era: 'New', era_override: '', era_override_label: '',
            suggested_era: 'Retro 2', suggested_era_label: 'Late 70s & 80s', confidence: 'likely', confidence_score: 74,
            reason: 'The title looks like a DJ version carrying a recent edit year. Existing library evidence fits the 1980s.',
            evidence: ['A matching original is tagged 1987.'], suspicious: true
        },
        {
            path: '/Music/DJ Superman/Future Signal (DJ Superman Edit).mp3',
            title: 'Future Signal (DJ Superman Edit)', artist: 'Nova Lane', filename: 'Future Signal (DJ Superman Edit).mp3', folder: 'DJ Superman',
            current_year: 2026, current_era: 'New', effective_era: 'New', era_override: '', era_override_label: '',
            suggested_era: '', suggested_era_label: '', confidence: 'review', confidence_score: 45,
            reason: 'This looks like a DJ edit carrying a 2026 tag. AXIOM has no older matching-song evidence, so you choose whether it belongs elsewhere.',
            evidence: [], suspicious: true
        }
    ];
    if (typeof axiomReviewMode === 'function' && axiomReviewMode() === 'health'
        && new URLSearchParams(window.location.search).get('ui_preview') === 'era-manual') {
        allRows.splice(0,allRows.length,...[
            {title:'Viva La Vida (Gin & Sonic Remix / QH)',artist:'Coldplay',current_year:2024,current_era:'Recent'},
            {title:'Stayin Alive (San Pacho Remix) (Acap Intro) (Clean)',artist:'Bee Gees',current_year:2021,current_era:'Post-Covid'},
            {title:'Dancing Queen - Waltry Remix',artist:'Abba',current_year:1980,current_era:'Retro 2'}
        ].map((row,index)=>({...row,path:`/axiom-review/manual-year-${index}.mp3`,effective_era:row.current_era,
            suggested_era:'',confidence:'review',reason:'Choose an AXIOM Era or enter the year you want to use.',evidence:[]})));
    }
    // Long-list review is localhost-only through the existing serial-free Health fixture.
    if (typeof axiomReviewMode === 'function' && axiomReviewMode() === 'health'
        && new URLSearchParams(window.location.search).get('ui_preview') === 'era-selection') {
        const samples = [...allRows];
        allRows.splice(0, allRows.length, ...Array.from({ length: 109 }, (_, index) => ({
            ...samples[index < 106 ? index % 3 : 3],
            path: `/axiom-review/era-selection-${index}.mp3`,
            title: `${samples[index < 106 ? index % 3 : 3].title} · Sample ${index + 1}`
        })));
    }
    if (mode === 'refine') {
        allRows.splice(0, allRows.length, ...[
            {path:'/axiom-review/usher-edit.mp3',title:'Yeah! (DJ Edit)',artist:'Usher',current_year:2026},
            {path:'/axiom-review/already-right.mp3',title:'Already correct · Sample song',artist:'Sample Artist',current_year:2003},
            {path:'/axiom-review/conflicting.mp3',title:'Conflicting evidence · Sample song',artist:'Sample Artist',current_year:2026}
        ].map(row=>({...row,genre:'Refreshed',folder:'DJ Example',current_era:row.current_year===2026?'New':'2k Era',effective_era:'2k Era',era_override:'2k Era',era_override_label:'2000s',confidence:'placed',reason:'Illustrative approved AXIOM Era. Research the release year separately.',evidence:[]})));
    }
    const q = String(query || '').trim().toLowerCase();
    let rows = allRows;
    if (q) rows = allRows.filter(row => [row.title, row.artist, row.filename, row.folder, row.path].join(' ').toLowerCase().includes(q));
    if (mode === 'search' && !q) rows = [];
    if (mode === 'placed') rows = allRows.filter(row => row.era_override);
    if (era) rows = rows.filter(row => row.effective_era === era);
    if (genre) rows = rows.filter(row => String(row.genre || '').toLowerCase() === genre.toLowerCase());
    if (folder) rows = rows.filter(row => row.path.startsWith(folder.replace(/\/$/, '') + '/'));
    return {
        success: true, mode, query: q, era, genre, folder_scope:folder,
        attention_count: mode === 'refine' ? 1 : 0,
        attention_rows: mode === 'refine' ? [{path:'/axiom-review/needs-attention.mp3',title:'Unidentified edit · Sample song',artist:'Sample Artist',attempts:3,reason:'Original recording could not be identified.'}] : [],
        folder_options:mode === 'refine' ? [{path:'/axiom-review',count:3}] : [], genre_options:['Refreshed'], rows, era_options: [
            { value: 'Retro One', label: '1950–1974' }, { value: 'Retro 2', label: 'Late 70s & 80s' },
            { value: 'The 90s', label: '1990s' }, { value: '2k Era', label: '2000s' },
            { value: '2010s', label: '2010–2016' }, { value: 'Pre-Covid', label: '2017–2019' },
            { value: 'Post-Covid', label: '2020–2021' }, { value: 'Old', label: '2022–2023' },
            { value: 'Recent', label: '2024–2025' }, { value: 'New', label: '2026+' }
        ],
        summary: {
            checked: 1482, results: rows.length,
            strong: rows.filter(row => row.confidence === 'strong').length,
            likely: rows.filter(row => row.confidence === 'likely').length,
            review: rows.filter(row => ['review', 'manual'].includes(row.confidence)).length,
            already_placed: rows.filter(row => row.era_override).length
        },
        cache_only: true, original_years_preserved: true, source_audio_untouched: true,
        health_review_era_fixture: true
    };
}

function eraAuditEraOptions(data = currentEraAuditData) {
    return '<option value="" selected>Choose AXIOM Era</option>' + (data?.era_options || []).map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('');
}

function eraAuditSelectedRows() {
    return (currentEraAuditData?.rows || []).filter(row => currentEraAuditSelected.has(row.path));
}

function eraAuditSuggestedRows(all = false) {
    const selected = eraAuditSelectedRows();
    const rows = !all && selected.length ? selected : currentEraAuditData?.mode === 'placed' ? [] : currentEraAuditData?.rows || [];
    return rows.filter(row => row.suggested_era);
}

function updateEraAuditSelectionUi() {
    document.querySelectorAll('.era-review-row[data-era-index]').forEach(rowEl => {
        const index = Number(rowEl.dataset.eraIndex || -1);
        const row = currentEraAuditData?.rows?.[index];
        rowEl.dataset.selected = row && currentEraAuditSelected.has(row.path) ? 'true' : 'false';
        const checkbox = rowEl.querySelector('.era-review-check');
        if (checkbox) checkbox.checked = rowEl.dataset.selected === 'true';
    });
    const selected = eraAuditSelectedRows();
    const suggested = eraAuditSuggestedRows();
    const manualButton = document.getElementById('era-review-place-button');
    const suggestedButton = document.getElementById('era-review-suggested-button');
    const allButton = document.getElementById('era-review-fix-all-button');
    const healthButton = document.getElementById('era-review-health-check-button');
    const refineButton = document.getElementById('era-refine-selected-years');
    if (refineButton) {
        const scoped = currentEraAuditData?.era || currentEraAuditData?.genre || currentEraAuditData?.query || currentEraAuditData?.folder_scope;
        refineButton.disabled = eraAuditApplying || (!selected.length && (!scoped || !currentEraAuditData?.rows?.length));
        refineButton.textContent = selected.length ? `Find & Fix Years (${selected.length.toLocaleString()})` : 'Find & Fix Years';
        const scopeCopy = document.getElementById('era-refinement-scope-copy');
        if (scopeCopy) scopeCopy.textContent = selected.length
            ? `For ${selected.length.toLocaleString()} selected song${selected.length === 1 ? '' : 's'}. Saves verified years in AXIOM; uncertain matches stay for review.`
            : scoped ? 'For this filtered batch, up to 500 songs. Saves verified years in AXIOM.'
            : 'Choose an era, search, or select songs to begin.';
    }
    const manualEra = document.getElementById('era-review-bulk-era')?.value || '';
    if (manualButton) {
        manualButton.disabled = eraAuditApplying || !selected.length || !manualEra;
        manualButton.textContent = selected.length ? `Place ${selected.length.toLocaleString()} Selected` : 'Place Selected';
    }
    if (suggestedButton) {
        suggestedButton.disabled = eraAuditApplying || !selected.length || !suggested.length;
        suggestedButton.textContent = selected.length && suggested.length
            ? `Fix ${suggested.length.toLocaleString()} Selected Era${suggested.length === 1 ? '' : 's'}`
            : 'Fix Selected Eras';
    }
    const allSuggested = eraAuditSuggestedRows(true);
    if (allButton) {
        allButton.disabled = eraAuditApplying || !allSuggested.length;
        allButton.textContent = `Apply Era Fixes${allSuggested.length ? ` (${allSuggested.length.toLocaleString()})` : ''}`;
    }
    const fixSummary = document.getElementById('era-review-fix-summary');
    if (fixSummary) {
        const manual = (selected.length ? selected : currentEraAuditData?.rows || []).filter(row => !row.suggested_era).length;
        fixSummary.textContent = suggested.length
            ? `${suggested.length.toLocaleString()} suggested era fix${suggested.length === 1 ? '' : 'es'} ready${selected.length ? ' for your selection' : ' in this list'}.${manual ? ` ${manual.toLocaleString()} song${manual === 1 ? ' needs' : 's need'} you to choose an era.` : ''}`
            : 'Select songs and choose an era below to place them manually.';
    }
    if (healthButton) {
        healthButton.disabled = eraAuditApplying || !selected.length;
        healthButton.textContent = selected.length
            ? `Check ${selected.length.toLocaleString()} Across Health`
            : 'Check Selected Across Health';
    }
    if (suggestedButton) suggestedButton.hidden = currentEraAuditData?.mode !== 'refine' && (!selected.length || !suggested.length);
    const extraActions = document.getElementById('era-review-extra-actions');
    if (extraActions) extraActions.hidden = !selected.length;
    const count = document.getElementById('era-review-selected-count');
    if (count) count.textContent = `${selected.length.toLocaleString()} selected`;
}

function setEraAuditDragRange(state, index) {
    const rows = currentEraAuditData?.rows || [];
    if (!rows[index]) return;
    currentEraAuditSelected = new Set(state.base);
    const first = Math.min(state.anchor, index), last = Math.max(state.anchor, index);
    for (let i = first; i <= last; i++) {
        if (state.selecting) currentEraAuditSelected.add(rows[i].path);
        else currentEraAuditSelected.delete(rows[i].path);
    }
    state.last = index;
    updateEraAuditSelectionUi();
}

function updateEraAuditDragPosition(state) {
    const bounds = state.container.getBoundingClientRect();
    const toolbar = state.container.querySelector('.era-review-actions')?.getBoundingClientRect();
    const top = Math.max(bounds.top, toolbar?.bottom || bounds.top);
    const y = Math.max(top + 1, Math.min(bounds.bottom - 1, state.y));
    let index = state.last;
    for (const row of state.rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > y) { index = Number(row.dataset.eraIndex); break; }
        index = Number(row.dataset.eraIndex);
    }
    if (index !== state.last) setEraAuditDragRange(state, index);
    return state.y < top + 32 ? -Math.min(18, (top + 32 - state.y) / 3)
        : state.y > bounds.bottom - 32 ? Math.min(18, (state.y - bounds.bottom + 32) / 3) : 0;
}

function stopEraAuditDrag() {
    const state = eraAuditDragSelection;
    if (!state) return;
    eraAuditDragSelection = null;
    window.cancelAnimationFrame(state.frame);
    document.removeEventListener('pointermove', moveEraAuditDrag);
    document.removeEventListener('pointerup', finishEraAuditDrag);
    document.removeEventListener('pointercancel', stopEraAuditDrag);
    window.removeEventListener('blur', stopEraAuditDrag);
    state.list.classList.remove('is-selecting');
}

function startEraAuditDrag(event) {
    if (eraAuditApplying || event.button !== 0 || event.pointerType === 'touch') return;
    const row = event.target.closest('.era-review-row[data-era-index]');
    if (!row || event.target.closest('button, a, select, textarea, summary, details, input:not(.era-review-check)')) return;
    stopEraAuditDrag();
    const index = Number(row.dataset.eraIndex);
    const track = currentEraAuditData?.rows?.[index];
    if (!track) return;
    const list = row.closest('.era-review-list');
    eraAuditDragSelection = {
        pointerId: event.pointerId, anchor: index, last: index,
        base: new Set(currentEraAuditSelected), selecting: !currentEraAuditSelected.has(track.path),
        startX: event.clientX, startY: event.clientY, y: event.clientY,
        checkbox: Boolean(event.target.closest('.era-review-check')), dragging: false,
        list, rows: Array.from(list.querySelectorAll('.era-review-row[data-era-index]')),
        container: document.getElementById('era-review-container'), data: currentEraAuditData, frame: 0
    };
    if (!eraAuditDragSelection.checkbox) event.preventDefault();
    document.addEventListener('pointermove', moveEraAuditDrag, { passive: false });
    document.addEventListener('pointerup', finishEraAuditDrag);
    document.addEventListener('pointercancel', stopEraAuditDrag);
    window.addEventListener('blur', stopEraAuditDrag);
}

function moveEraAuditDrag(event) {
    const state = eraAuditDragSelection;
    if (!state || event.pointerId !== state.pointerId) return;
    if (!(event.buttons & 1) || currentEraAuditData !== state.data || !state.list.isConnected) return stopEraAuditDrag();
    state.y = event.clientY;
    if (!state.dragging && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return;
    event.preventDefault();
    if (!state.dragging) {
        state.dragging = true;
        state.list.classList.add('is-selecting');
        setEraAuditDragRange(state, state.anchor);
        const scroll = () => {
            if (eraAuditDragSelection !== state) return;
            if (!state.list.isConnected || currentEraAuditData !== state.data) return stopEraAuditDrag();
            const speed = updateEraAuditDragPosition(state);
            if (speed) { state.container.scrollTop += speed; updateEraAuditDragPosition(state); }
            state.frame = window.requestAnimationFrame(scroll);
        };
        state.frame = window.requestAnimationFrame(scroll);
    }
    updateEraAuditDragPosition(state);
}

function finishEraAuditDrag(event) {
    const state = eraAuditDragSelection;
    if (!state || event.pointerId !== state.pointerId) return;
    if (state.dragging) {
        state.y = event.clientY;
        updateEraAuditDragPosition(state);
        const suppressClick = click => { click.preventDefault(); click.stopPropagation(); };
        document.addEventListener('click', suppressClick, true);
        window.setTimeout(() => {
            document.removeEventListener('click', suppressClick, true);
            updateEraAuditSelectionUi();
        }, 0);
    } else if (!state.checkbox) setEraAuditDragRange(state, state.anchor);
    stopEraAuditDrag();
}

function toggleEraAuditRow(index, checked) {
    const row = currentEraAuditData?.rows?.[Number(index)];
    if (!row) return;
    if (checked) currentEraAuditSelected.add(row.path);
    else currentEraAuditSelected.delete(row.path);
    updateEraAuditSelectionUi();
}

function selectEraAuditRows(kind = 'all') {
    const rows = currentEraAuditData?.rows || [];
    currentEraAuditSelected = new Set(
        kind === 'none' ? [] : rows.filter(row => kind !== 'suggested' || row.suggested_era).map(row => row.path)
    );
    updateEraAuditSelectionUi();
}

function renderEraYearRefinement(data) {
    const option = (value, label, selected) => `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const rows = data.rows || [];
    return `<div class="era-review-shell era-refinement-minimal" data-era-refinement="true">
        <section class="era-refinement-main" aria-label="Choose songs to research">
            <div class="era-refinement-field"><label for="era-refinement-group">AXIOM Era</label>
                <select id="era-refinement-group" onchange="runEraRefinementSearch()">${option('', 'All eras', !data.era)}${(data.era_options || []).map(item => option(item.value, item.label, item.value === data.era)).join('')}</select></div>
            <div class="era-review-search"><label for="era-review-search-input">DJ, remixer or song</label>
                <input id="era-review-search-input" type="search" value="${escapeHtml(data.query || '')}" placeholder="Search your library" onkeydown="if(event.key==='Enter'){event.preventDefault();runEraRefinementSearch();}"></div>
            <button class="era-review-search-button" type="button" onclick="runEraRefinementSearch()">Search</button>
        </section>
        <details class="era-refinement-more" ${data.genre || data.folder_scope || currentEraRefinementYearBasis !== 'original_song' ? 'open' : ''}><summary>More filters</summary>
            <div class="era-refinement-filter-fields">
                <div class="era-refinement-field"><label for="era-refinement-genre">Genre</label><select id="era-refinement-genre" onchange="runEraRefinementSearch()">${option('', 'All genres', !data.genre)}${(data.genre_options || []).map(genre => option(genre, genre, genre === data.genre)).join('')}</select></div>
                <div class="era-refinement-field"><label for="era-refinement-folder">Library folder</label><select id="era-refinement-folder" onchange="runEraRefinementSearch()">${option('', 'All library folders', !data.folder_scope)}${(data.folder_options || []).map(folder => option(folder.path, `${folder.path} (${Number(folder.count || 0).toLocaleString()} songs)`, folder.path === data.folder_scope)).join('')}</select></div>
                <div class="era-refinement-field"><label for="era-refinement-year-basis">Year to find</label><select id="era-refinement-year-basis" onchange="currentEraRefinementYearBasis=this.value">${option('original_song', 'Original song', currentEraRefinementYearBasis === 'original_song')}${option('recording_version', 'This remix / recording', currentEraRefinementYearBasis === 'recording_version')}</select></div>
            </div>
            <p>Folders include songs already in AXIOM, including subfolders.</p>
        </details>
        <div class="era-refinement-start">
            <button id="era-refine-selected-years" class="health-clean-review-button primary" type="button" onclick="findEraRefinementYears(this)">Find &amp; Fix Years</button>
            <span id="era-refinement-scope-copy" aria-live="polite"></span>
        </div>
        ${rows.length ? `<div class="era-review-selection-actions">
            <button class="health-clean-review-button link" type="button" onclick="selectEraAuditRows('all')">Select all</button>
            <button class="health-clean-review-button link" type="button" onclick="selectEraAuditRows('none')">Clear selection</button>
            <span id="era-review-selected-count">0 selected</span>
            <details id="era-review-extra-actions" class="era-review-adjustments" hidden><summary>Check other details</summary><div><button id="era-review-health-check-button" class="health-clean-review-button" type="button" onclick="checkEraAuditSelectedAcrossHealth(this)">Check Selected Across Health</button></div></details>
        </div>
        <section class="era-review-list" aria-label="Songs to research" onpointerdown="startEraAuditDrag(event)">
            <div class="era-review-grid era-review-columns"><span></span><span>Song</span><span>Current year</span><span>AXIOM Era</span></div>
            ${rows.map((row, index) => `<div class="era-review-grid era-review-row" data-era-index="${index}" data-selected="false">
                <input class="era-review-check" type="checkbox" onchange="toggleEraAuditRow(${index}, this.checked)" aria-label="Select ${escapeHtml(row.title)}">
                <div class="era-review-track"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.artist)}</small></div>
                <div class="era-review-era"><strong id="era-year-display-rows-${index}">${escapeHtml(row.current_year || 'Missing')}</strong>${renderEraManualYearControls(row,index)}</div>
                <div class="era-review-era proposed"><strong id="era-placement-display-rows-${index}">${escapeHtml((data.era_options || []).find(item => item.value === row.effective_era)?.label || row.effective_era || 'Not grouped')}</strong></div>
            </div>`).join('')}
        </section>` : '<div class="era-review-empty"><strong>No matching songs</strong><p>Try another era or clear a filter.</p></div>'}
        ${data.attention_count ? `<details class="era-refinement-attention"><summary>Needs attention <span>${Number(data.attention_count).toLocaleString()}</span></summary><p>Paused after repeated attempts. Normal batches skip these songs. Retry when you want to check them again.</p>
            ${(data.attention_rows || []).map((row,index)=>`<article><div><strong>${escapeHtml(row.title || 'Unknown song')}</strong><small>${escapeHtml(row.artist || '')}</small><p>Tried ${Number(row.attempts || 0).toLocaleString()} times · ${escapeHtml(row.reason || 'Year could not be verified.')}</p>${renderEraManualYearControls(row,index,'attention_rows')}</div><button type="button" class="health-clean-review-button" onclick="retryYearAttention(${index},this)">Retry</button></article>`).join('')}
            ${data.attention_count > 100 ? `<div class="era-refinement-pages"><button type="button" class="health-clean-review-button" onclick="showYearAttentionPage(${Math.max(0,(data.attention_page || 0)-1)})" ${!data.attention_page?'disabled':''}>Previous</button><span>Page ${(data.attention_page || 0)+1} of ${Math.ceil(data.attention_count/100)}</span><button type="button" class="health-clean-review-button" onclick="showYearAttentionPage(${(data.attention_page || 0)+1})" ${((data.attention_page || 0)+1)*100 >= data.attention_count?'disabled':''}>Next</button></div>`:''}
        </details>` : ''}
        ${data.page_size && data.summary?.results > data.page_size ? `<div class="era-refinement-pages">
            <button class="health-clean-review-button" type="button" onclick="runEraRefinementSearch(${Math.max(0, (data.page || 0)-1)})" ${!data.page ? 'disabled' : ''}>Previous</button>
            <span>Page ${(data.page || 0)+1} of ${Math.ceil(data.summary.results/data.page_size)}</span>
            <button class="health-clean-review-button" type="button" onclick="runEraRefinementSearch(${(data.page || 0)+1})" ${((data.page || 0)+1)*data.page_size >= data.summary.results ? 'disabled' : ''}>Next</button>
        </div>` : ''}
    </div>`;
}

function renderEraManualYearControls(row, index, scope = 'rows') {
    const id = `era-manual-year-${scope}-${index}`;
    const query = `${row.artist || ''} ${row.title || ''} original release year`.trim();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return `<div class="era-manual-year">
        <label for="${id}">Enter year</label>
        <div><input id="${id}" type="text" inputmode="numeric" maxlength="4" placeholder="YYYY" aria-label="Year for ${escapeHtml(row.title || 'this song')}" onkeydown="if(event.key==='Enter'){event.preventDefault();saveEraManualYear(${index},'${scope}',this.nextElementSibling);}">
        <button type="button" class="health-clean-review-button" onclick="saveEraManualYear(${index},'${scope}',this)">Save Year</button></div>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" onclick="if(window.webkit?.messageHandlers?.axiomNative){event.preventDefault();openAxiomExternalUrl(this.href,'year search');}">Search Google</a>
        <small id="era-year-status-${scope}-${index}" role="status" aria-live="polite"></small>
    </div>`;
}

async function saveEraManualYear(index, scope = 'rows', trigger = null) {
    if (eraAuditApplying || !['rows','attention_rows'].includes(scope)) return;
    const data = currentEraAuditData;
    const row = data?.[scope]?.[index];
    if (!row?.path) return;
    const input = document.getElementById(`era-manual-year-${scope}-${index}`);
    const raw = String(input?.value || '').trim();
    const year = /^\d{4}$/.test(raw) ? Number(raw) : 0;
    const max = new Date().getFullYear() + 1;
    const status = document.getElementById(`era-year-status-${scope}-${index}`);
    const report = message => { if (status && currentEraAuditData === data) status.textContent = message; };
    if (year < 1900 || year > max) { report(`Enter a year between 1900 and ${max}.`); input?.focus(); return; }
    eraAuditApplying = true;
    updateEraAuditSelectionUi();
    setAxiomButtonBusy(trigger,true,'Saving...');
    report('Saving year in AXIOM...');
    try {
        let saved;
        if (data.health_review_era_fixture) {
            saved = {success:true,track:{year,era:window.AXIOMLiveAssistSimilarity?.eraFor({year}) || '',era_override:row.era_override || ''}};
        } else {
            const response = await fetch('/api/library/update_year', {
                method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({path:row.path,year,source:'manual',health_context:true})
            });
            saved = await response.json().catch(()=>({}));
            if (!response.ok || saved.success !== true) throw new Error(saved.message || 'The year was not saved. Try again.');
            if (saved.outcome !== 'year_applied' || Number(saved.track?.year) !== year) {
                throw new Error(saved.message || 'The source file needs to be reconnected before saving its year.');
            }
        }
        row.current_year = year;
        if (Object.prototype.hasOwnProperty.call(saved.track || {},'era')) row.current_era = saved.track.era;
        if (saved.track?.era_override || saved.track?.era) row.effective_era = saved.track.era_override || saved.track.era;
        row.suggested_era = '';
        row.suggested_era_label = '';
        row.confidence = 'saved';
        if (currentEraAuditData === data) {
            const display = document.getElementById(`era-year-display-${scope}-${index}`);
            if (display) display.textContent = `${year}${row.current_era ? ` · ${row.current_era}` : ''}`;
            const note = document.getElementById(`era-year-note-${scope}-${index}`);
            if (note) note.textContent = 'Saved in AXIOM';
            const placement = document.getElementById(`era-placement-display-${scope}-${index}`);
            if (placement) placement.textContent = (data.era_options || []).find(item=>item.value===row.effective_era)?.label || row.effective_era || 'Not grouped';
            const placementNote = document.getElementById(`era-placement-note-${scope}-${index}`);
            if (placementNote) placementNote.textContent = saved.track?.era_override ? 'Your chosen era kept' : 'Manual year saved';
            const confidence = document.getElementById(`era-placement-confidence-${scope}-${index}`);
            if (confidence) confidence.textContent = 'saved';
        }
        report(data.health_review_era_fixture ? `Example: ${year} saved. Your library is unchanged.` : `${year} saved in AXIOM.${saved.track?.era_override ? ' Your chosen AXIOM Era is preserved.' : ''}`);
        if (!data.health_review_era_fixture) {
            try {
                if (typeof propagateTrackMetadata === 'function') propagateTrackMetadata(row.path,{year,release_year:year},saved.track);
                refreshLiveAssistEraPlacements([saved.track]);
                loadLibraryStats(false);
            } catch (refreshError) { console.warn('Year saved; another AXIOM view could not refresh.',refreshError); }
        }
    } catch(error) { report(error.message || 'The year was not saved. Try again.'); showToast(error.message,true); }
    finally { eraAuditApplying=false; setAxiomButtonBusy(trigger,false); updateEraAuditSelectionUi(); }
}

function findEraRefinementYears(trigger = null) {
    return researchEraAuditYears(trigger, !eraAuditSelectedRows().length);
}

async function showYearAttentionPage(page) {
    const data = currentEraAuditData || {};
    if (data.health_review_era_fixture) return;
    try {
        const params = new URLSearchParams({mode:'refine',q:data.query || '',era:data.era || '',genre:data.genre || '',folder:data.folder_scope || '',page:String(data.page || 0),attention_page:String(page)});
        const response = await fetch(`/api/library/era_audit?${params}`);
        const payload = await response.json();
        if (!response.ok || payload.success !== true) throw new Error(payload.error || 'Could not load paused songs.');
        currentEraAuditData = payload;
        document.getElementById('era-review-container').innerHTML = renderEraYearRefinement(payload);
        updateEraAuditSelectionUi();
        const attention = document.querySelector('.era-refinement-attention');
        if (attention) attention.open = true;
    } catch(error) {showToast(error.message,true);}
}

async function retryYearAttention(index, trigger) {
    const row = currentEraAuditData?.attention_rows?.[index];
    if (!row?.path) return;
    if (currentEraAuditData.health_review_era_fixture) return showToast('Example only. Retry is available for your real library.');
    await startReleaseYearResearch(trigger,false,{paths:[row.path],year_basis:'original_song',apply_verified:true,retry_held:true,
        era_scope:currentEraAuditData.era || '',genre_scope:currentEraAuditData.genre || '',editor_query:currentEraAuditData.query || '',folder_scope:currentEraAuditData.folder_scope || ''});
}

function refreshEraRefinementAfterFix(job) {
    if (currentEraAuditData?.mode !== 'refine') return;
    if (job.fixture) {
        const results = new Map((job.results || []).map(row=>[row.path,row]));
        for (const row of currentEraAuditData.rows || []) {
            const result = results.get(row.path);
            if (result?.apply_status === 'applied') row.current_year = result.release_year;
        }
        document.getElementById('era-review-container').innerHTML = renderEraYearRefinement(currentEraAuditData);
        updateEraAuditSelectionUi();
    } else scanEraAudit('refine',currentEraAuditData.query || '',currentEraAuditData.era || '',currentEraAuditData.page || 0,currentEraAuditData.genre || '',currentEraAuditData.folder_scope || '');
}

function renderEraAudit(data) {
    stopEraAuditDrag();
    currentEraAuditData = data;
    currentEraAuditReceipt = null;
    currentConnectedHealthData = null;
    currentEraAuditSelected = new Set();
    const container = document.getElementById('era-review-container');
    const badge = document.getElementById('era-review-ready-badge');
    const copy = document.getElementById('era-review-copy');
    const title = document.getElementById('era-review-title');
    if (!container) return;
    if (title) title.textContent = data.mode === 'refine' ? 'Find Original Years' : 'Fix Eras';
    if (badge) badge.textContent = `${Number(data.summary?.results || 0).toLocaleString()} ${data.health_review_era_fixture ? 'sample tracks' : data.mode === 'smart' ? 'to check' : 'results'}`;
    if (copy) copy.textContent = data.mode === 'refine'
        ? `Find when the original songs were released.${data.health_review_era_fixture ? ' Example songs only; your library is unchanged.' : ' Changes stay in AXIOM until you export.'}`
        : data.query
        ? `Showing tracks that match “${data.query}”. Choose an AXIOM Era or enter a year below. Source tags stay unchanged.`
        : data.health_review_era_fixture
            ? 'Example data only. This is not an audit of your library.'
            : 'Check the suggested eras, then apply the changes you agree with.';

    if (data.mode === 'refine') {
        container.innerHTML = renderEraYearRefinement(data);
        container.scrollTop = 0;
        updateEraAuditSelectionUi();
        return;
    }
    const focused = data.mode !== 'refine';
    const rowsHtml = (data.rows || []).map((row, index) => {
        const selected = currentEraAuditSelected.has(row.path);
        const currentLabel = row.current_year ? `${row.current_year} · ${row.current_era}` : row.current_era || 'Unknown';
        const proposed = data.mode === 'refine' ? (data.era_options || []).find(option => option.value === row.effective_era)?.label || row.effective_era : row.suggested_era_label || row.era_override_label || 'You choose';
        const evidence = (row.evidence || []).map(item => `<small>${escapeHtml(item)}</small>`).join('');
        return `
            <div class="era-review-grid era-review-row" data-era-index="${index}" data-selected="${selected ? 'true' : 'false'}">
                <input class="era-review-check" type="checkbox" ${selected ? 'checked' : ''} onchange="toggleEraAuditRow(${index}, this.checked)" aria-label="Select ${escapeHtml(row.title)}">
                <div class="era-review-track"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.artist)} · ${escapeHtml(row.folder || row.filename || '')}</small></div>
                <div class="era-review-era"><strong id="era-year-display-rows-${index}">${escapeHtml(currentLabel)}</strong><small id="era-year-note-rows-${index}">Current AXIOM year</small>${renderEraManualYearControls(row,index)}</div>
                <div class="era-review-era proposed"><strong id="era-placement-display-rows-${index}">${escapeHtml(proposed)}</strong><small id="era-placement-note-rows-${index}">${data.mode === 'refine' ? 'Current AXIOM Era' : row.era_override ? 'Already placed' : row.suggested_era ? 'Suggested placement' : 'Manual placement'}</small><span id="era-placement-confidence-rows-${index}" class="era-review-confidence">${escapeHtml(row.confidence || 'review')}</span></div>
                <div class="era-review-reason">${focused ? `<details ontoggle="this.closest('.era-review-row').classList.toggle('evidence-open',this.open)"><summary>${evidence ? 'Matching evidence' : 'Why review?'}</summary><p>${escapeHtml(row.reason || 'No supported era change found. Keep the current placement or choose one yourself.')}</p>${evidence}</details>` : `${escapeHtml(row.reason || 'No supported era change found. Keep the current placement or choose one yourself.')}${evidence ? `<details><summary>Matching evidence</summary>${evidence}</details>` : ''}`}</div>
            </div>`;
    }).join('');
    const emptyCopy = data.mode === 'search' && !data.query
        ? 'Type a DJ editor, artist, title, filename, or folder above. AXIOM will search the full library without changing anything.'
        : data.mode === 'refine'
            ? 'No indexed songs match these filters. Choose another era, genre or folder, or clear the DJ/remixer search.'
        : data.mode === 'placed'
            ? 'No manual era placements have been applied yet.'
            : 'No suspicious era placements were found in this scan.';
    container.innerHTML = `
        <div class="era-review-shell" data-era-refinement="${data.mode === 'refine'}">
            ${focused ? '<p class="era-review-note">Choose an era for selected songs, or enter each song\'s year below. Changes stay in AXIOM; source tags stay unchanged.</p>' : ''}
            <section class="era-review-trust-strip" aria-label="Era Audit safety" ${focused ? 'hidden' : ''}>
                <div><img src="/static/icons/sliders-horizontal.svg" alt="" aria-hidden="true"><span><strong>AXIOM Era placement</strong><small>Choose where the track belongs for browsing and set building.</small></span></div>
                <div><img src="/static/icons/heart-pulse.svg" alt="" aria-hidden="true"><span><strong>Your year, your choice</strong><small>Era placement keeps your year. Save Year changes the year in AXIOM only.</small></span></div>
                <div><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><span><strong>${data.mode === 'refine' ? 'Evidence before updates' : 'Undo every batch'}</strong><small>${data.mode === 'refine' ? 'Verified years need your approval. Conflicts stay in review.' : 'Each apply action creates a clear, reversible receipt.'}</small></span></div>
            </section>
            <section class="era-review-controls">
                ${focused ? '<details class="era-review-tools"><summary>More tools</summary>' : ''}
                <div class="era-review-modes">
                    <button class="era-review-mode ${data.mode === 'smart' ? 'active' : ''}" type="button" onclick="scanEraAudit('smart')">Smart Audit</button>
                    <button class="era-review-mode ${data.mode === 'search' ? 'active' : ''}" type="button" onclick="focusEraAuditSearch()">Find Editor</button>
                    <button class="era-review-mode ${data.mode === 'placed' ? 'active' : ''}" type="button" onclick="scanEraAudit('placed')">Placed</button>
                    <button class="era-review-mode ${data.mode === 'refine' ? 'active' : ''}" type="button" onclick="openEraYearRefinement()">Refine Years</button>
                </div>
                ${focused ? '</details>' : ''}
                <div class="era-review-search">
                    <label for="era-review-search-input">Editor, DJ, song, filename or folder</label>
                    <input id="era-review-search-input" type="search" value="${escapeHtml(data.query || '')}" placeholder="Try DJ Superman or Music Junkie" onkeydown="if(event.key==='Enter'){event.preventDefault();runEraAuditSearch();}">
                </div>
                <button class="era-review-search-button" type="button" onclick="runEraAuditSearch()">Search Library</button>
            </section>
            ${data.mode === 'refine' ? `<section class="era-refinement-controls">
                <div class="era-refinement-field">
                <label for="era-refinement-group">AXIOM Era</label>
                <select id="era-refinement-group" onchange="runEraRefinementSearch()"><option value="" ${!data.era?'selected':''}>All eras</option>${(data.era_options || []).map(option=>`<option value="${escapeHtml(option.value)}" ${option.value===data.era?'selected':''}>${escapeHtml(option.label)}</option>`).join('')}</select>
                </div><div class="era-refinement-field">
                <label for="era-refinement-genre">Genre</label>
                <select id="era-refinement-genre" onchange="runEraRefinementSearch()"><option value="">All genres</option>${(data.genre_options || []).map(genre=>`<option value="${escapeHtml(genre)}" ${genre===data.genre?'selected':''}>${escapeHtml(genre)}</option>`).join('')}</select>
                </div><div class="era-refinement-field">
                <label for="era-refinement-folder">Library folder</label>
                <select id="era-refinement-folder" onchange="runEraRefinementSearch()"><option value="">All library folders</option>${(data.folder_options || []).map(folder=>`<option value="${escapeHtml(folder.path)}" ${folder.path===data.folder_scope?'selected':''}>${escapeHtml(folder.path)} (${Number(folder.count || 0).toLocaleString()} tracks)</option>`).join('')}</select>
                </div><div class="era-refinement-field">
                <label for="era-refinement-year-basis">Year to research</label>
                <select id="era-refinement-year-basis" onchange="currentEraRefinementYearBasis=this.value"><option value="original_song" ${currentEraRefinementYearBasis==='original_song'?'selected':''}>Original song timeline</option><option value="recording_version" ${currentEraRefinementYearBasis==='recording_version'?'selected':''}>This recording / remix release</option></select>
                </div>
                <button class="health-clean-review-button primary" type="button" onclick="researchEraAuditYears(this, true)" ${!data.rows?.length || !(data.era || data.genre || data.query || data.folder_scope) ? 'disabled' : ''}>Research next batch</button>
                <p>Filter by era, genre, library folder or DJ/remixer text, then research the matching songs. Folder choices include indexed songs in subfolders; no new folders are scanned. Review the matches before starting. Grouping alone does not verify a year.</p>
                ${data.page_size && data.summary?.results > data.page_size ? `<div class="era-refinement-pages">
                    <button class="health-clean-review-button" type="button" onclick="runEraRefinementSearch(${Math.max(0,(data.page || 0)-1)})" ${!data.page ? 'disabled' : ''}>Previous</button>
                    <span>Page ${(data.page || 0)+1} of ${Math.ceil(data.summary.results/data.page_size)} · ${data.summary.results.toLocaleString()} tracks in this group</span>
                    <button class="health-clean-review-button" type="button" onclick="runEraRefinementSearch(${(data.page || 0)+1})" ${(data.page+1)*data.page_size>=data.summary.results ? 'disabled' : ''}>Next</button>
                </div>` : ''}
            </section>` : ''}
            ${focused ? '<details class="era-review-scan-details"><summary>Scan details</summary>' : ''}
            ${data.mode === 'refine' ? `<section class="era-review-summary">
                <div><span>${data.health_review_era_fixture ? 'Example' : 'In this group'}</span><strong>${Number(data.summary?.results || 0).toLocaleString()}</strong><small>${data.health_review_era_fixture ? 'sample tracks' : 'tracks available to research'}</small></div>
                <div><span>Year present</span><strong>${Number(data.summary?.year_present ?? (data.rows || []).filter(row=>Number(row.current_year)>0).length).toLocaleString()}</strong><small>existing years preserved</small></div>
                <div><span>Year missing</span><strong>${Number(data.summary?.year_missing ?? (data.rows || []).filter(row=>!Number(row.current_year)).length).toLocaleString()}</strong><small>research can find evidence</small></div>
                <div><span>Batch limit</span><strong>500</strong><small>pause and resume supported</small></div>
            </section>` : `<section class="era-review-summary">
                <div><span>${data.health_review_era_fixture ? 'Example' : 'Scanned'}</span><strong>${Number(data.health_review_era_fixture ? data.rows?.length || 0 : data.summary?.checked || 0).toLocaleString()}</strong><small>${data.health_review_era_fixture ? 'sample tracks' : 'AXIOM library tracks'}</small></div>
                <div class="ready"><span>Strong</span><strong>${Number(data.summary?.strong || 0).toLocaleString()}</strong><small>clear supporting evidence</small></div>
                <div><span>Likely</span><strong>${Number(data.summary?.likely || 0).toLocaleString()}</strong><small>review before applying</small></div>
                <div><span>Manual</span><strong>${Number(data.summary?.review || 0).toLocaleString()}</strong><small>you choose the era</small></div>
            </section>`}
            ${focused ? '</details>' : ''}
            ${rowsHtml ? `
                <div class="era-review-actions">
                    <div class="era-review-fix-lead">
                        <span id="era-review-fix-summary" aria-live="polite"></span>
                        <button id="era-review-fix-all-button" class="health-clean-review-button primary" type="button" onclick="applyEraAuditPlacements('all_suggested', this)">Apply Era Fixes</button>
                    </div>
                    <div class="era-review-selection-actions">
                    <button class="health-clean-review-button link" type="button" onclick="selectEraAuditRows('all')">Select All</button>
                    <button class="health-clean-review-button link" type="button" onclick="selectEraAuditRows('none')">Untick All</button>
                    <span id="era-review-selected-count">${currentEraAuditSelected.size.toLocaleString()} selected</span>
                    <button id="era-review-suggested-button" class="health-clean-review-button" type="button" onclick="applyEraAuditPlacements('suggested', this)">Fix Selected Eras</button>
                    ${data.mode === 'refine' ? '<button id="era-refine-selected-years" class="health-clean-review-button primary" type="button" onclick="researchEraAuditYears(this)">Research Selected Years</button>' : ''}
                    ${focused ? '<div id="era-review-extra-actions" class="era-review-adjustments" hidden><div>' : ''}
                    <button id="era-review-health-check-button" class="health-clean-review-button connected-health-check-button" type="button" onclick="checkEraAuditSelectedAcrossHealth(this)">Check Selected Across Health</button>
                    <span class="spacer"></span>
                    <span class="era-review-manual-actions">
                    <select id="era-review-bulk-era" aria-label="Place selected tracks in era" onchange="updateEraAuditSelectionUi()">${eraAuditEraOptions(data)}</select>
                    <button id="era-review-place-button" class="health-clean-review-button primary" type="button" onclick="applyEraAuditPlacements('manual', this)">Place Selected</button>
                    </span>
                    ${focused ? '</div></div>' : ''}
                    </div>
                    <small class="era-review-selection-hint">Click or drag to select a smaller batch.</small>
                </div>
                <section class="era-review-list" aria-label="Era review candidates" onpointerdown="startEraAuditDrag(event)">
                    <div class="era-review-grid era-review-columns"><span></span><span>Track</span><span>Current Year</span><span>${focused ? 'Suggested Era' : 'AXIOM Era'}</span><span>Evidence</span></div>
                    ${rowsHtml}
                </section>` : `<div class="era-review-empty"><strong>${data.query ? 'No matching tracks' : 'Nothing waiting here'}</strong><p>${escapeHtml(emptyCopy)}</p></div>`}
        </div>`;
    container.scrollTop = 0;
    updateEraAuditSelectionUi();
}

function focusEraAuditSearch() {
    const input = document.getElementById('era-review-search-input');
    if (input) { input.focus(); input.select(); }
    else scanEraAudit('search');
}

function runEraAuditSearch() {
    if (currentEraAuditData?.mode === 'refine') return runEraRefinementSearch();
    const query = String(document.getElementById('era-review-search-input')?.value || '').trim();
    scanEraAudit(query ? 'search' : 'smart', query);
}

function runEraRefinementSearch(page = 0) {
    scanEraAudit('refine', String(document.getElementById('era-review-search-input')?.value || '').trim(),
        document.getElementById('era-refinement-group')?.value || '', page,
        document.getElementById('era-refinement-genre')?.value || '',
        document.getElementById('era-refinement-folder')?.value || '');
}

function setEraAuditLoading(label = 'Scan accepted. Reading AXIOM library evidence...') {
    const container = document.getElementById('era-review-container');
    const badge = document.getElementById('era-review-ready-badge');
    if (badge) badge.textContent = 'Scan running';
    if (container) container.innerHTML = `<div class="era-review-shell"><div class="health-review-loading"><strong>Smart Era Audit is working</strong><p>${escapeHtml(label)} No audio files or year tags are being changed.</p></div></div>`;
}

async function scanEraAudit(mode = 'smart', query = '', era = '', page = 0, genre = '', folder = '') {
    if (eraAuditDemoTimer) window.clearTimeout(eraAuditDemoTimer);
    setEraAuditLoading(mode === 'refine' ? 'Loading this AXIOM Era for release-year research...' : mode === 'search' ? 'Search accepted. Matching title, artist, filename, folder, and path...' : 'Scan accepted. Comparing year tags with local song-family evidence...');
    if (axiomReviewMode() === 'health') {
        eraAuditDemoTimer = window.setTimeout(() => {
            eraAuditDemoTimer = null;
            renderEraAudit(eraAuditDemoData(mode, query, era, genre, folder));
        }, 360);
        return;
    }
    try {
        const params = new URLSearchParams({ mode, q: String(query || ''), era, page: String(page), genre, folder });
        const response = await fetch(`/api/library/era_audit?${params.toString()}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Era Audit failed');
        renderEraAudit(result);
    } catch (error) {
        const container = document.getElementById('era-review-container');
        if (container) container.innerHTML = `<div class="era-review-shell"><div class="health-review-error"><strong>Era Audit could not finish</strong><p>${escapeHtml(error.message || 'Nothing changed. Try the scan again.')}</p></div><div class="health-clean-review-actions"><button class="health-clean-review-button" type="button" onclick="showTab('health')">Back to Health</button><button class="health-clean-review-button primary" type="button" onclick="scanEraAudit('smart')">Try Again</button></div></div>`;
        const badge = document.getElementById('era-review-ready-badge');
        if (badge) badge.textContent = 'Scan failed safely';
    }
}

async function researchEraAuditYears(trigger = null, groupBatch = false) {
    const era = currentEraAuditData?.era;
    const genre = currentEraAuditData?.genre || '';
    const query = currentEraAuditData?.query || '';
    const folder = currentEraAuditData?.folder_scope || '';
    const paths = groupBatch ? [] : eraAuditSelectedRows().map(row=>row.path);
    if ((groupBatch && !(era || genre || query || folder)) || (!groupBatch && !paths.length)) return showToast('Choose an era, genre, library folder or DJ/remixer filter, then select songs or research the next batch.', true);
    const yearBasis = document.getElementById('era-refinement-year-basis')?.value || currentEraRefinementYearBasis;
    if (currentEraAuditData.health_review_era_fixture) {
        const selected = groupBatch ? currentEraAuditData.rows : eraAuditSelectedRows();
        const results = selected.map((row,index)=>({path:row.path,title:row.title,artist:row.artist,existing_year:row.current_year,era_context:era,
            release_year:row.path.includes('usher')?2004:row.path.includes('conflicting')?1998:2003,
            original_release_year:row.path.includes('usher')?2004:row.path.includes('conflicting')?1998:2003,
            candidate_year:row.current_year,era_fit:row.path.includes('conflicting')?'conflict':'fits',
            status:'verified',apply_status:row.path.includes('conflicting')?'era_conflict':row.path.includes('already')?'already_correct':'applied',fixture:true,version_type:'dj_edit',
            match_confidence:'illustrative',year_confidence:'illustrative',notes:'Example evidence only. No actual library changes were made.'}));
        const job = {job_id:`year-preview-${Date.now()}`,status:'completed',fixture:true,apply_verified:true,era_scope:era,genre_scope:genre,editor_query:query,folder_scope:folder,year_basis:yearBasis,total:selected.length,progress:selected.length,
            message:'Example refinement only. No catalogues were queried and no library years were changed.',
            results,apply_summary:{checked:results.length,updated:results.filter(row=>row.apply_status==='applied').length,already_correct:results.filter(row=>row.apply_status==='already_correct').length,needs_review:results.filter(row=>row.apply_status==='era_conflict').length}};
        renderReleaseYearResearchJob(job);
        refreshEraRefinementAfterFix(job);
        return;
    }
    await startReleaseYearResearch(trigger, false, {paths,era_scope:era,genre_scope:genre,editor_query:query,folder_scope:folder,year_basis:yearBasis,apply_verified:true});
}

function openEraAudit(triggerBtn = null) {
    setHealthWorkspaceGroupActive('era');
    setAxiomButtonBusy(triggerBtn, true, 'Opening...');
    showTab('era-review');
    window.setTimeout(() => {
        setAxiomButtonBusy(triggerBtn, false);
        scanEraAudit('smart');
    }, 120);
}

function openEraYearRefinement() {
    setHealthWorkspaceGroupActive('era');
    showTab('era-review');
    currentEraRefinementYearBasis = 'original_song';
    scanEraAudit('refine', '', '');
}

function returnToHealthEra() {
    showTab('health');
    setHealthWorkspaceGroupActive('era');
    window.AxiomHealthCockpit?.open('era', {scroll: true});
}

function connectedHealthDemoIssue(type, label, state, detail, current, suggested, nextAction) {
    return { type, label, state, detail, current, suggested, next_action: nextAction };
}

function recalculateConnectedHealthSummary(data) {
    const rows = data?.rows || [];
    const issueCounts = { title: 0, artist: 0, bpm: 0, key: 0, year: 0, duplicate: 0, file: 0, era: 0 };
    rows.forEach(row => {
        row.issues = row.issues || [];
        row.issue_count = row.issues.length;
        row.ready_count = row.issues.filter(issue => issue.state === 'ready').length;
        row.review_count = row.issues.filter(issue => ['review', 'blocked'].includes(issue.state)).length;
        row.repair_count = row.issues.filter(issue => issue.state === 'repair').length;
        row.healthy = row.issue_count === 0;
        row.issues.forEach(issue => { if (Object.prototype.hasOwnProperty.call(issueCounts, issue.type)) issueCounts[issue.type] += 1; });
    });
    data.issue_counts = issueCounts;
    data.summary = {
        ...(data.summary || {}),
        checked: rows.length,
        safe_fixes_ready: rows.reduce((sum, row) => sum + row.ready_count, 0),
        needs_review: rows.filter(row => row.review_count).length,
        repair_needed: rows.filter(row => row.repair_count).length,
        healthy: rows.filter(row => row.healthy).length,
        pending: rows.reduce((sum, row) => sum + row.issue_count, 0),
    };
    return data;
}

function connectedHealthDemoData(paths = []) {
    const wanted = new Set(paths);
    const eraRows = (currentEraAuditData?.rows || []).filter(row => wanted.has(row.path));
    const selected = eraRows.length ? eraRows : (currentHealthTracks || [])
        .filter(track => wanted.has(track.path))
        .map(track => ({
            ...track,
            current_year: track.year || null,
            current_era: typeof getTrackEra === 'function' ? getTrackEra(track) : '',
            effective_era: typeof getTrackEra === 'function' ? getTrackEra(track) : '',
            suggested_era_label: '',
            reason: 'The newest batch is being checked before it enters normal set preparation.',
        }));
    const rows = selected.map((row, index) => {
        const issues = [];
        if (index === 0) {
            issues.push(connectedHealthDemoIssue('title', 'Title cleanup', 'ready', 'The DJ version can stay with the song in a clearer title display.', String(row.title || 'Sample song').replace(/\s*\(([^)]*)\)\s*$/, ' - $1'), row.title || 'Sample song', 'Approve the AXIOM-only title suggestion.'));
            issues.push(connectedHealthDemoIssue('bpm', 'Missing BPM', 'repair', 'No trusted BPM is stored in AXIOM.', 'Missing', 'Health BPM scan', 'Run this track through the BPM repair lane.'));
            issues.push(connectedHealthDemoIssue('year', 'Year review', 'review', 'This example needs original-release research before choosing a year.', String(row.current_year || 'Unknown'), 'Find original year', 'Research the original year; file publishing remains separate.'));
        } else if (index === 1) {
            issues.push(connectedHealthDemoIssue('artist', 'Artist cleanup', 'ready', 'The edit credit belongs with the song version, not the artist name.', row.artist || 'Sample Artist (DJ Edit)', String(row.artist || 'Sample Artist').replace(/\s*\([^)]*\)\s*$/, ''), 'Approve the AXIOM-only artist suggestion.'));
            issues.push(connectedHealthDemoIssue('key', 'Missing key', 'repair', 'No trusted Camelot key is stored in AXIOM.', 'Missing', 'Health Key scan', 'Run this track through the strict Key repair lane.'));
            issues.push(connectedHealthDemoIssue('duplicate', 'Possible duplicate', 'review', 'AXIOM found two copies and will not hide either without review.', '2 copies', 'Keep prepared copy', 'Open Duplicate Resolver to compare both copies.'));
        } else if (index === 2) {
            issues.push(connectedHealthDemoIssue('file', 'Missing file', 'blocked', 'The saved path is not currently connected.', 'Disconnected', 'Reconnect drive', 'Reconnect the drive or moved folder, then check again.'));
            issues.push(connectedHealthDemoIssue('year', 'Year review', 'review', 'This example needs original-release research before choosing a year.', String(row.current_year || 'Unknown'), 'Find original year', 'Research the original year; file publishing remains separate.'));
        }
        issues.push(connectedHealthDemoIssue('era', 'Era placement', 'review', row.reason || 'This track may be grouped with the wrong era.', `${row.current_year || 'Unknown'} · ${row.current_era || 'Unknown'}`, row.suggested_era_label || 'DJ chooses', 'Approve an AXIOM Era placement; the original year stays unchanged.'));
        return {
            path: row.path, title: row.title, artist: row.artist, filename: row.filename,
            file_connected: !issues.some(issue => issue.type === 'file'),
            bpm: index === 0 ? null : 98 + index,
            camelot: index === 1 ? null : '8A',
            year: row.current_year,
            effective_era: row.effective_era,
            issues: issues.filter(issue => issue.state !== 'ready' || issue.current !== issue.suggested),
        };
    });
    return recalculateConnectedHealthSummary({
        success: true,
        health_review_connected_fixture: true,
        rows,
        summary: { requested: paths.length, unresolved: 0 },
        changes_applied: 0,
        cache_only: true,
        source_audio_untouched: true,
        serato_database_untouched: true,
        djay_database_untouched: true,
        year_publish_separate: true,
    });
}

function setConnectedHealthLoading(count, source = '') {
    const container = document.getElementById('era-review-container');
    const badge = document.getElementById('era-review-ready-badge');
    const copy = document.getElementById('era-review-copy');
    const title = document.getElementById('era-review-title');
    const isNewMusic = source === 'new_music';
    if (title) title.textContent = isNewMusic ? 'Checking New Music' : 'Checking Songs';
    if (badge) badge.textContent = 'Working';
    if (copy) copy.textContent = 'Looking for missing details and suggested fixes.';
    if (container) container.innerHTML = `
        <div class="connected-health-shell">
            <div class="connected-health-loading" aria-live="polite">
                <div class="connected-health-loading-head"><span>${Number(count || 0).toLocaleString()} song${Number(count || 0) === 1 ? '' : 's'}</span><b>Working</b></div>
                <p>No changes yet.</p>
                <div class="connected-health-loading-track" aria-hidden="true"><span></span></div>
            </div>
        </div>`;
}

function connectedHealthStateLabel(state) {
    return ({ ready: 'Suggested fix', review: 'You decide', repair: 'Needs a scan', blocked: 'Needs reconnecting' })[state] || 'You decide';
}

function connectedHealthIssueLabel(issue) {
    return ({ title: 'Tidy title', artist: 'Tidy artist', bpm: 'Find BPM', key: 'Find key',
        year: 'Check year', duplicate: 'Compare copies', file: 'Reconnect file', era: 'Choose era' })[issue.type]
        || issue.label || 'Review';
}

function renderConnectedHealthCheck(data) {
    currentConnectedHealthData = recalculateConnectedHealthSummary(data || { rows: [] });
    const container = document.getElementById('era-review-container');
    const badge = document.getElementById('era-review-ready-badge');
    const copy = document.getElementById('era-review-copy');
    const title = document.getElementById('era-review-title');
    if (!container) return;
    const summary = currentConnectedHealthData.summary || {};
    const issueCounts = currentConnectedHealthData.issue_counts || {};
    const changesApplied = Number(currentConnectedHealthData.changes_applied || 0);
    const isNewMusic = currentConnectedHealthData.connected_health_source === 'new_music';
    if (title) title.textContent = isNewMusic ? 'New Music Results' : 'Health Results';
    if (badge) badge.textContent = `${Number(summary.checked || 0).toLocaleString()} song${Number(summary.checked || 0) === 1 ? '' : 's'} checked`;
    if (copy) copy.textContent = data.health_review_connected_fixture
        ? 'Example results. Your library and files are unchanged.'
        : changesApplied
            ? `${changesApplied.toLocaleString()} song${changesApplied === 1 ? '' : 's'} updated in AXIOM. Your music files are unchanged.`
            : 'See what needs attention. Your music files are unchanged.';

    const rowsHtml = (currentConnectedHealthData.rows || []).map(row => {
        const needs = row.healthy ? 'Nothing to fix'
            : (row.issues || []).map(issue => escapeHtml(connectedHealthIssueLabel(issue))).join(' · ');
        const issues = (row.issues || []).map(issue => `
            <div class="connected-health-issue">
                <div class="connected-health-issue-title"><strong>${escapeHtml(issue.label || issue.type)}</strong><small>${escapeHtml(connectedHealthStateLabel(issue.state))}</small></div>
                <div class="connected-health-change"><span>${escapeHtml(issue.current || 'Current value')}</span><b>→</b><span>${escapeHtml(issue.suggested || 'Needs review')}</span></div>
                <div class="connected-health-issue-copy">${escapeHtml(issue.detail || '')}<small>${escapeHtml(issue.next_action || '')}</small></div>
            </div>`).join('');
        return `
            <details class="connected-health-row">
                <summary class="connected-health-row-head">
                    <span class="connected-health-track"><strong>${escapeHtml(row.title || 'Unknown Track')}</strong><small>${escapeHtml(row.artist || 'Unknown Artist')}</small></span>
                    <span class="connected-health-needs">${needs}</span>
                    <span class="connected-health-details-label">Details</span>
                </summary>
                <div class="connected-health-row-details">
                    ${issues ? `<div class="connected-health-issues">${issues}</div>` : '<p>Nothing needs fixing in this check.</p>'}
                    <small class="connected-health-file">${escapeHtml(row.filename || row.path || '')}</small>
                </div>
            </details>`;
    }).join('');

    const metadataRows = (currentConnectedHealthData.rows || []).filter(row => (row.issues || []).some(issue => ['title', 'artist'].includes(issue.type)));
    const metadataTracks = metadataRows.length;
    const nameFixes = metadataRows.map(row => `<div class="connected-health-name-track"><strong>${escapeHtml(row.title || 'Unknown Track')}</strong>${row.issues.filter(issue => ['title', 'artist'].includes(issue.type)).map(issue => `<div class="connected-health-change"><span>${escapeHtml(issue.current || '')}</span><b>→</b><span>${escapeHtml(issue.suggested || '')}</span></div>`).join('')}</div>`).join('');
    container.innerHTML = `
        <div class="connected-health-shell connected-health-minimal">
            ${metadataTracks ? `<details class="connected-health-name-review"><summary>Review name fixes (${metadataTracks.toLocaleString()} song${metadataTracks === 1 ? '' : 's'})</summary><div class="connected-health-name-content">${nameFixes}<p>Updates titles and artists in AXIOM only.</p><button class="health-clean-review-button primary" type="button" onclick="applyConnectedHealthMetadataFixes(this)">Apply Name Fixes</button></div></details>` : ''}
            ${changesApplied ? `<div class="connected-health-applied"><span>${data.health_review_connected_fixture ? 'Name fixes applied in this example.' : 'Name fixes saved in AXIOM.'}</span><button class="health-clean-review-button link" type="button" onclick="undoConnectedHealthMetadataFixes(this)">Undo Name Fixes</button></div>` : ''}
            <section class="connected-health-list" aria-label="Selected track Health results">${rowsHtml || `<div class="era-review-empty"><strong>No current tracks matched</strong><p>${isNewMusic ? 'Return to New Music Inbox and refresh the latest batch.' : 'Return to Era Audit and refresh the selection.'} Nothing was changed.</p></div>`}</section>
            <div class="connected-health-footer">
                <button class="health-clean-review-button link" type="button" onclick="${isNewMusic ? 'backToNewMusicHealthInbox()' : 'backToEraAuditReview()'}">${isNewMusic ? 'Back to New Music' : 'Back to Era Results'}</button>
                ${Number(issueCounts.duplicate || 0) + Number(issueCounts.bpm || 0) + Number(issueCounts.key || 0) + Number(issueCounts.year || 0) + Number(issueCounts.file || 0) ? `<details class="connected-health-other"><summary>Other fixes</summary><div>
                    ${Number(issueCounts.duplicate || 0) ? '<button class="health-clean-review-button" type="button" onclick="openHealthDuplicateResolver(this)">Compare Copies</button>' : ''}
                    ${Number(issueCounts.bpm || 0) + Number(issueCounts.key || 0) + Number(issueCounts.year || 0) + Number(issueCounts.file || 0) ? `<button class="health-clean-review-button" type="button" onclick="${isNewMusic ? 'prepareConnectedNewMusicTracks()' : 'openConnectedHealthRepairLanes()'}">${isNewMusic ? 'Prepare New Tracks' : 'Find Missing Details'}</button>` : ''}
                </div></details>` : ''}
            </div>
        </div>`;
    container.scrollTop = 0;
}

async function runConnectedHealthCheck(paths, triggerBtn = null, resultContext = {}) {
    const selectedPaths = Array.from(new Set((paths || []).filter(Boolean)));
    if (!selectedPaths.length) {
        showToast('Select at least one track to check across Health.', true);
        return;
    }
    setAxiomButtonBusy(triggerBtn, true, 'Checking...');
    setConnectedHealthLoading(selectedPaths.length, String(resultContext?.connected_health_source || ''));
    if (currentEraAuditData?.health_review_era_fixture || axiomReviewMode() === 'health') {
        window.setTimeout(() => {
            renderConnectedHealthCheck({ ...connectedHealthDemoData(selectedPaths), ...resultContext });
            setAxiomButtonBusy(triggerBtn, false);
        }, 420);
        return;
    }
    try {
        const response = await fetch('/api/library/era_audit/health_check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: selectedPaths })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Connected Health check failed');
        renderConnectedHealthCheck({ ...result, ...resultContext });
    } catch (error) {
        const container = document.getElementById('era-review-container');
        const isNewMusic = resultContext?.connected_health_source === 'new_music';
        if (container) container.innerHTML = `<div class="connected-health-shell"><div class="health-review-error"><strong>Connected Health check paused safely</strong><p>${escapeHtml(error.message || `Nothing changed. Return to ${isNewMusic ? 'New Music Inbox' : 'Era Audit'} and try again.`)}</p></div><div class="health-clean-review-actions"><button class="health-clean-review-button" type="button" onclick="${isNewMusic ? 'backToNewMusicHealthInbox()' : 'backToEraAuditReview()'}">Back to ${isNewMusic ? 'New Music Inbox' : 'Era Audit'}</button></div></div>`;
        const badge = document.getElementById('era-review-ready-badge');
        if (badge) badge.textContent = 'Check failed safely';
    } finally {
        setAxiomButtonBusy(triggerBtn, false);
    }
}

function checkEraAuditSelectedAcrossHealth(triggerBtn = null) {
    runConnectedHealthCheck(eraAuditSelectedRows().map(row => row.path), triggerBtn);
}

function backToEraAuditReview() {
    if (currentEraAuditData) renderEraAudit(currentEraAuditData);
    else scanEraAudit('smart');
}

function backToNewMusicHealthInbox() {
    showTab('health');
    window.setTimeout(() => {
        const intake = document.getElementById('health-new-music-intake');
        intake?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('health-new-music-check')?.focus({ preventScroll: true });
    }, 120);
}

function connectedHealthSourceContext(data = currentConnectedHealthData || {}) {
    return data.connected_health_source === 'new_music' ? {
        connected_health_source: 'new_music',
        new_music_batch_id: String(data.new_music_batch_id || ''),
        new_music_batch_total: Number(data.new_music_batch_total || data.rows?.length || 0),
    } : {};
}

async function applyConnectedHealthMetadataFixes(triggerBtn = null) {
    const data = currentConnectedHealthData;
    const rows = (data?.rows || []).filter(row => (row.issues || []).some(issue => ['title', 'artist'].includes(issue.type)));
    if (!rows.length) return;
    const confirmed = await showAxiomConfirm(
        'Apply Name Fixes',
        `AXIOM will update the title and artist display for ${rows.length.toLocaleString()} selected track${rows.length === 1 ? '' : 's'} in its cache only. Source audio, Serato, and djay Pro stay untouched.`,
        'APPLY SUGGESTIONS',
        'primary',
        'metadata'
    );
    if (!confirmed) return;
    setAxiomButtonBusy(triggerBtn, true, 'Applying...');
    if (data.health_review_connected_fixture) {
        window.setTimeout(() => {
            rows.forEach(row => { row.issues = (row.issues || []).filter(issue => !['title', 'artist'].includes(issue.type)); });
            data.changes_applied = rows.length;
            renderConnectedHealthCheck(recalculateConnectedHealthSummary(data));
            showToast(`Applied ${rows.length.toLocaleString()} cache-only metadata cleanup${rows.length === 1 ? '' : 's'}.`);
            setAxiomButtonBusy(triggerBtn, false);
        }, 360);
        return;
    }
    try {
        const paths = rows.map(row => row.path);
        const response = await fetch('/api/library/utility_metadata_cleanup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: 'metadata_cleanup', paths, apply: true, scope: 'sample', expected_values: rows.map(row => ({ path: row.path, title: row.title || '', artist: row.artist || '' })) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Metadata cleanup failed');
        showToast(`${Number(result.count || 0).toLocaleString()} selected track${Number(result.count || 0) === 1 ? '' : 's'} cleaned inside AXIOM.`);
        await runConnectedHealthCheck((data.rows || []).map(row => row.path), null, {
            ...connectedHealthSourceContext(data),
            changes_applied: Number(result.count || 0),
            metadata_cleanup_paths: (result.tracks || []).map(row => row.path),
            metadata_cleanup_batch_id: result.batch_id,
        });
    } catch (error) {
        showToast(error.message || 'Metadata cleanup failed. Nothing else changed.', true);
    } finally {
        setAxiomButtonBusy(triggerBtn, false);
    }
}

async function undoConnectedHealthMetadataFixes(triggerBtn = null) {
    const data = currentConnectedHealthData;
    const paths = data?.metadata_cleanup_paths || (data?.rows || []).map(row => row.path);
    if (!paths.length) return;
    setAxiomButtonBusy(triggerBtn, true, 'Undoing...');
    if (data.health_review_connected_fixture) {
        window.setTimeout(() => {
            renderConnectedHealthCheck({ ...connectedHealthDemoData(paths), ...connectedHealthSourceContext(data) });
            showToast('The demo metadata suggestions were restored.');
            setAxiomButtonBusy(triggerBtn, false);
        }, 320);
        return;
    }
    try {
        const response = await fetch('/api/library/utility_metadata_cleanup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: 'metadata_cleanup', paths, apply: false, scope: 'sample', batch_id: data.metadata_cleanup_batch_id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Metadata undo failed');
        showToast(`${Number(result.count || 0).toLocaleString()} metadata cleanup${Number(result.count || 0) === 1 ? '' : 's'} restored inside AXIOM.`);
        await runConnectedHealthCheck((data.rows || []).map(row => row.path), null, connectedHealthSourceContext(data));
    } catch (error) {
        showToast(error.message || 'Metadata undo failed. Current AXIOM values are unchanged.', true);
    } finally {
        setAxiomButtonBusy(triggerBtn, false);
    }
}

function openConnectedHealthRepairLanes() {
    const counts = currentConnectedHealthData?.issue_counts || {};
    const lane = counts.bpm ? 'missing_bpm' : counts.key ? 'missing_key' : counts.year ? 'missing_year' : 'missing_file';
    showTab('health');
    window.setTimeout(() => {
        if (typeof selectHealthInboxItem === 'function') selectHealthInboxItem(lane);
        else if (typeof setHealthFilter === 'function') setHealthFilter(lane);
    }, 120);
}

function prepareConnectedNewMusicTracks() {
    const paths = (currentConnectedHealthData?.rows || [])
        .filter(row => (row.issues || []).some(issue => issue.state === 'repair'))
        .map(row => row.path)
        .filter(Boolean);
    if (!paths.length) return showToast('This new-music batch has no repairable tracks.', true);
    showTab('health');
    window.setTimeout(() => startUnifiedHealthScan('', null, paths, { flow: 'new_music' }), 120);
}

function refreshLiveAssistEraPlacements(rows = []) {
    // Batch metadata updates once: a whole-library placement must not rerender
    // Studio or make a recommendation request for every individual track.
    const patches = new Map(rows.filter(row => row.path).map(row => [row.path,
        Object.fromEntries(['year','era_override','era_override_label','year_estimated','year_health_state']
            .filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field,row[field]]))]));
    if (!patches.size) return;
    const update = track => {
        const patch = patches.get(track?.path);
        if (patch) Object.assign(track, patch);
    };
    [mainSearchResults, studioSearchResults, currentPlaylist, currentRoutePlaylist,
        typeof performanceSuggestions === 'undefined' ? [] : performanceSuggestions].forEach(list => (list || []).forEach(update));
    [typeof performanceAnchorTrack === 'undefined' ? null : performanceAnchorTrack,
        typeof performanceSeratoLastTrack === 'undefined' ? null : performanceSeratoLastTrack, currentAnchorTrack].forEach(update);
    for (const [path, track] of trackVisualCache.entries()) {
        const patch = patches.get(path);
        if (patch) trackVisualCache.set(path, {...track, ...patch});
    }
    if (patches.size && typeof performanceAnchorTrack !== 'undefined' && performanceAnchorTrack) {
        queuePerformanceLiveAssistStateSync();
        performanceFetchSuggestions();
    }
}

async function applyEraAuditPlacements(kind = 'manual', triggerBtn = null) {
    if (eraAuditApplying) return;
    const selected = eraAuditSelectedRows();
    const era = document.getElementById('era-review-bulk-era')?.value || '';
    const suggested = kind === 'suggested' || kind === 'all_suggested';
    const changes = suggested
        ? (kind === 'suggested' && !selected.length ? [] : eraAuditSuggestedRows(kind === 'all_suggested')).map(row => ({ path: row.path, era: row.suggested_era }))
        : selected.map(row => ({ path: row.path, era }));
    if (!changes.length) {
        showToast(suggested ? 'There are no suggested eras to fix in this selection.' : 'Select at least one track.', true);
        return;
    }
    // Accepting reviewed suggestions is one reversible AXIOM-cache action, never a tag publish.
    const confirmed = suggested || await showAxiomConfirm(
        'Place Tracks In This Era',
        `AXIOM will place ${changes.length.toLocaleString()} track${changes.length === 1 ? '' : 's'} for DJ browsing and set building. Existing year tags stay exactly as they are, source audio is untouched, and this batch can be undone.`,
        'PLACE TRACKS',
        'primary'
    );
    if (!confirmed) return;
    eraAuditApplying = true;
    stopEraAuditDrag();
    updateEraAuditSelectionUi();
    setAxiomButtonBusy(triggerBtn, true, 'Applying...');
    const receiptContext = { checked: changes.length, pending: Math.max(0, (currentEraAuditData?.rows?.length || 0) - changes.length) };
    if (currentEraAuditData?.health_review_era_fixture) {
        window.setTimeout(() => {
            const placements = changes.map(change => {
                const row = currentEraAuditData.rows.find(item => item.path === change.path) || {};
                const option = currentEraAuditData.era_options.find(item => item.value === change.era) || {};
                return { path: change.path, title: row.title, artist: row.artist, year_preserved: row.current_year, previous_era: row.effective_era || row.current_era, placed_era: change.era, placed_era_label: option.label || change.era };
            });
            renderEraAuditReceipt({ success: true, demo: true, batch_id: 'demo-era-batch', changed: placements.length, skipped: 0, placements, ...receiptContext });
            eraAuditApplying = false;
            setAxiomButtonBusy(triggerBtn, false);
        }, 420);
        return;
    }
    const requestId = `era-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let savedResult = null;
    const showSavedResult = result => {
        savedResult = result;
        renderEraAuditReceipt({ ...result, ...receiptContext });
        try {
            refreshLiveAssistEraPlacements(result.placements || []);
            loadLibraryStats(false);
        } catch (refreshError) { console.warn('Era fixes saved; another AXIOM view could not refresh.', refreshError); }
    };
    try {
        const response = await fetch('/api/library/era_audit/apply', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ changes, request_id: requestId, source: suggested ? 'smart_suggestion_approved' : 'manual_placement' })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success !== true) throw new Error(result.error || 'Could not confirm the saved era fixes.');
        showSavedResult(result);
    } catch (error) {
        if (!savedResult) {
            try {
                const response = await fetch(`/api/library/era_audit/receipt?request_id=${encodeURIComponent(requestId)}`, {cache:'no-store'});
                const result = await response.json();
                if (response.ok && result.success === true) showSavedResult(result);
            } catch (recoveryError) { console.warn('Could not retrieve the era placement receipt.', recoveryError); }
        }
        if (!savedResult) showToast('Could not confirm the saved era fixes. Run the scan again to check what was saved before applying again.', true);
    } finally {
        eraAuditApplying = false;
        setAxiomButtonBusy(triggerBtn, false);
        updateEraAuditSelectionUi();
    }
}

function renderEraAuditReceipt(receipt) {
    stopEraAuditDrag();
    currentEraAuditReceipt = receipt;
    const container = document.getElementById('era-review-container');
    if (!container) return;
    const changed = Number(receipt.changed ?? receipt.restored ?? 0);
    const undone = Boolean(receipt.undone);
    const placements = receipt.placements || receipt.tracks || [];
    const badge = document.getElementById('era-review-ready-badge');
    const copy = document.getElementById('era-review-copy');
    if (badge) badge.textContent = undone ? 'Undo complete' : 'Placement complete';
    if (copy) copy.textContent = undone
        ? 'The previous AXIOM Era placement was restored. Original years and audio files were never changed.'
        : 'AXIOM now groups these tracks in the chosen AXIOM Eras. Their original year tags remain visible and unchanged.';
    const rows = placements.map(row => `
        <div class="era-receipt-row">
            <div><strong>${escapeHtml(row.title || 'Unknown Track')}</strong><small>${escapeHtml(row.artist || 'Unknown Artist')} · Year ${escapeHtml(row.year_preserved || 'unchanged')}</small></div>
            <span>${escapeHtml(row.previous_era || row.placed_era || 'Previous placement')}</span>
            <b>→</b>
            <span>${escapeHtml(undone ? (row.restored_era || 'Original year era') : (row.placed_era_label || row.placed_era || 'Placed'))}</span>
        </div>`).join('');
    container.innerHTML = `
        <div class="era-review-shell">
            <section class="era-receipt-hero" aria-live="polite">
                <div class="era-receipt-lead"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><div><h3>${undone ? 'Era placement restored' : 'Tracks placed where you expect them'}</h3><p>${undone ? `${changed.toLocaleString()} track${changed === 1 ? '' : 's'} returned to the previous AXIOM Era.` : `${changed.toLocaleString()} track${changed === 1 ? '' : 's'} now use the chosen AXIOM Era. Exact year tags were preserved, so AXIOM is not claiming a made-up release year.`}</p></div></div>
                <div class="era-receipt-facts">
                    <div><strong>${Number(receipt.checked || changed).toLocaleString()}</strong><span>Checked</span></div>
                    <div><strong>${changed.toLocaleString()}</strong><span>${undone ? 'Restored' : 'Placed'}</span></div>
                    <div><strong>${Number(receipt.skipped || 0).toLocaleString()}</strong><span>Skipped Safely</span></div>
                    <div><strong>${Number(receipt.pending || 0).toLocaleString()}</strong><span>Still pending</span></div>
                </div>
            </section>
            <section class="era-receipt-list">${rows}</section>
            ${!undone && placements[0]?.placed_era ? `<button class="health-clean-review-button primary" type="button" onclick="scanEraAudit('refine', '', '${escapeHtml(placements[0].placed_era)}')">Refine Release Years</button>` : ''}
            <div class="health-clean-review-actions">
                <button class="health-clean-review-button" type="button" onclick="showTab('health')">Back to Health</button>
                <button class="health-clean-review-button" type="button" onclick="scanEraAudit('smart')">Scan Again</button>
                ${!undone && changed ? '<button class="health-clean-review-button" type="button" onclick="undoEraAuditPlacement(this)">Undo This Batch</button>' : ''}
                <span class="spacer"></span>
                <span>0 audio files changed · exact years preserved</span>
            </div>
        </div>`;
    container.scrollTop = 0;
}

async function undoEraAuditPlacement(triggerBtn = null) {
    const receipt = currentEraAuditReceipt;
    if (!receipt?.batch_id) return;
    setAxiomButtonBusy(triggerBtn, true, 'Undoing...');
    if (receipt.demo) {
        window.setTimeout(() => {
            renderEraAuditReceipt({ ...receipt, undone: true, restored: receipt.changed, changed: receipt.changed, pending: receipt.pending });
            setAxiomButtonBusy(triggerBtn, false);
        }, 360);
        return;
    }
    try {
        const response = await fetch('/api/library/era_audit/undo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_id: receipt.batch_id })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Undo failed');
        refreshLiveAssistEraPlacements(result.tracks || []);
        renderEraAuditReceipt({ ...result, checked: result.restored, changed: result.restored, pending: receipt.pending, undone: true });
        loadLibraryStats(false);
    } catch (error) {
        showToast(error.message || 'Undo failed. Your current placement is unchanged.', true);
        setAxiomButtonBusy(triggerBtn, false);
    }
}

let currentDuplicateReviewData = null;
let currentDuplicateReviewReceipt = null;
let duplicateReviewDemoTimer = null;
let duplicateReviewOnlyMode = false;
let duplicateBatchPriority = 'cues';

function duplicateReviewDemoData(strictness = 'medium') {
    return {
        success: true,
        strictness,
        health_review_duplicate_fixture: true,
        source_audio_untouched: true,
        serato_database_untouched: true,
        summary: { groups: 3, tracks: 3, suggested_removals: 2, conflicts: 1 },
        duplicates: [
            {
                group_key: 'demo-signal-fire',
                strictness,
                match_level: 'medium artist/title',
                is_conflict: false,
                suggested_keep_path: '/Music/Primary/Signal Fire.flac',
                suggested_remove_paths: ['/Downloads/Signal Fire.mp3'],
                tracks: [
                    { path: '/Music/Primary/Signal Fire.flac', title: 'Signal Fire', artist: 'Original Artist', extension: 'FLAC', bitrate: 1411, reasons: ['Lossless format', '3 cue points', 'Played 18 times'] },
                    { path: '/Downloads/Signal Fire.mp3', title: 'Signal Fire', artist: 'Original Artist', extension: 'MP3', bitrate: 320, reasons: ['No cue points', 'Never played'] },
                ],
            },
            {
                group_key: 'demo-city-lights',
                strictness,
                match_level: 'medium song family',
                is_conflict: false,
                suggested_keep_path: '/Music/DJ Library/City Lights (Club Mix).mp3',
                suggested_remove_paths: ['/Downloads/City Lights - Club Mix.mp3'],
                tracks: [
                    { path: '/Music/DJ Library/City Lights (Club Mix).mp3', title: 'City Lights (Club Mix)', artist: 'North Avenue', extension: 'MP3', bitrate: 320, reasons: ['High bitrate', 'Beatgrid prepared'] },
                    { path: '/Downloads/City Lights - Club Mix.mp3', title: 'City Lights - Club Mix', artist: 'North Avenue', extension: 'MP3', bitrate: 192, reasons: ['Lower bitrate', 'No DJ prep'] },
                ],
            },
            {
                group_key: 'demo-night-drive',
                strictness,
                match_level: 'medium artist/title',
                is_conflict: true,
                suggested_keep_path: '/Music/Prepared/Night Drive.mp3',
                suggested_remove_paths: ['/Music/Imports/Night Drive.m4a'],
                tracks: [
                    { path: '/Music/Prepared/Night Drive.mp3', title: 'Night Drive (Extended Mix)', artist: 'Massane', extension: 'MP3', bitrate: 320, reasons: ['4 cue points', 'Played 9 times'] },
                    { path: '/Music/Imports/Night Drive.m4a', title: 'Night Drive (Extended)', artist: 'Massane', extension: 'M4A', bitrate: 256, reasons: ['2 cue points', 'Played 3 times'] },
                ],
            },
        ],
    };
}

function duplicateReviewLargeDemoData(strictness = 'medium') {
    const base = duplicateReviewDemoData(strictness);
    const definitions = [
        ['afterglow', 'Afterglow (Extended Mix)', 'Harbour Lines', 'AIFF', 1411, ['8 cue points', 'Beatgrid prepared', 'Played 31 times'], 'MP3', 320, ['2 cue points', 'Played 4 times'], false],
        ['midnight-transit', 'Midnight Transit', 'Static Motion', 'FLAC', 1411, ['Lossless format', '5 cue points', 'Played 22 times'], 'MP3', 192, ['No cue points', 'Never played'], false],
        ['weekend-circuit', 'Weekend Circuit', 'Neon Repair', 'MP3', 320, ['6 cue points', 'Played 12 times'], 'M4A', 256, ['5 cue points', 'Played 11 times'], true],
        ['neon-sunday', 'Neon Sunday (Extended)', 'Weekend Circuit', 'MP3', 320, ['Beatgrid prepared', '4 cue points', 'Played 16 times'], 'MP3', 256, ['No DJ prep', 'Played once'], false],
        ['riverside', 'Riverside (Vocal Edit)', 'Harbour Lines', 'FLAC', 1411, ['Lossless format', '7 cue points', 'Played 14 times'], 'MP3', 320, ['1 cue point', 'Played 2 times'], false],
        ['horizon-line', 'Horizon Line', 'North Avenue', 'MP3', 320, ['3 cue points', 'Played 8 times'], 'AAC', 320, ['4 cue points', 'Played 7 times'], true],
        ['motion-theory', 'Motion Theory', 'Substate', 'MP3', 320, ['Beatgrid prepared', '6 cue points', 'Played 27 times'], 'MP3', 192, ['No cue points', 'Never played'], false],
        ['golden-hour', 'Golden Hour (Club Tool)', 'Mile High', 'AIFF', 1411, ['Hot cues prepared', 'Played 19 times'], 'MP3', 320, ['No DJ prep', 'Played 3 times'], false],
        ['deep-current', 'Deep Current', 'Audio Kings', 'FLAC', 1411, ['Lossless format', '5 cue points', 'Played 13 times'], 'M4A', 256, ['1 cue point', 'Never played'], false],
        ['static-bloom', 'Static Bloom', 'Cruse Control', 'MP3', 320, ['5 cue points', 'Played 10 times'], 'M4A', 256, ['5 cue points', 'Played 10 times'], true],
        ['open-skies', 'Open Skies (Peak Mix)', 'Promo Only', 'MP3', 320, ['Beatgrid prepared', '8 cue points', 'Played 42 times'], 'MP3', 320, ['No cue points', 'Never played'], false],
        ['pressure-point', 'Pressure Point', 'Bassline Cartel', 'FLAC', 1411, ['Lossless format', '4 cue points', 'Played 18 times'], 'MP3', 320, ['No DJ prep', 'Played 2 times'], false],
        ['last-call', 'Last Call (Outro)', 'Lowkey Hustle', 'MP3', 320, ['Outro cues prepared', 'Played 24 times'], 'MP3', 192, ['No cue points', 'Never played'], false],
        ['low-light', 'Low Light', 'North Avenue', 'AIFF', 1411, ['6 cue points', 'Beatgrid prepared', 'Played 20 times'], 'M4A', 256, ['2 cue points', 'Played 5 times'], false],
        ['final-approach', 'Final Approach', 'Static Motion', 'MP3', 320, ['5 cue points', 'Played 15 times'], 'MP3', 128, ['No DJ prep', 'Never played'], false],
    ];
    const extraGroups = definitions.map(([slug, title, artist, keepExtension, keepBitrate, keepReasons, moveExtension, moveBitrate, moveReasons, isConflict]) => {
        const keepPath = `/Music/DJ Library/${title}.${keepExtension.toLowerCase()}`;
        const movePath = `/Music/Imports/${title}.${moveExtension.toLowerCase()}`;
        return {
            group_key: `demo-${slug}`,
            strictness,
            match_level: 'medium artist/title',
            is_conflict: isConflict,
            suggested_keep_path: keepPath,
            suggested_remove_paths: [movePath],
            tracks: [
                { path: keepPath, title, artist, extension: keepExtension, bitrate: keepBitrate, reasons: keepReasons },
                { path: movePath, title, artist, extension: moveExtension, bitrate: moveBitrate, reasons: moveReasons },
            ],
        };
    });
    const duplicates = [...base.duplicates, ...extraGroups];
    const conflicts = duplicates.filter(group => group.is_conflict).length;
    return {
        ...base,
        health_review_duplicate_large_fixture: true,
        summary: {
            groups: duplicates.length,
            tracks: duplicates.reduce((total, group) => total + group.tracks.length, 0),
            suggested_removals: duplicates.length - conflicts,
            conflicts,
        },
        duplicates,
    };
}

function duplicateReviewFixtureData(strictness = 'medium') {
    return axiomUiPreviewMode() === 'duplicates-large'
        ? duplicateReviewLargeDemoData(strictness)
        : duplicateReviewDemoData(strictness);
}

function duplicateReviewMetric(track, metric) {
    const reasons = Array.isArray(track?.reasons) ? track.reasons.join(' · ') : '';
    if (metric === 'cues') {
        const cueMatch = reasons.match(/(\d+)\s+(?:hot\s+)?cue/i);
        return cueMatch ? Number(cueMatch[1]) : 0;
    }
    if (/never played/i.test(reasons)) return 0;
    if (/played once/i.test(reasons)) return 1;
    const playMatch = reasons.match(/played\s+(\d+)\s+times?/i);
    return playMatch ? Number(playMatch[1]) : 0;
}

function duplicatePriorityRecommendation(group, priority = duplicateBatchPriority) {
    if (!group?.is_conflict || !Array.isArray(group.tracks) || group.tracks.length < 2) return null;
    const tracks = group.tracks.slice(0, 2).map(track => ({
        track,
        cues: duplicateReviewMetric(track, 'cues'),
        plays: duplicateReviewMetric(track, 'plays'),
    }));
    const primaryMetric = priority === 'plays' ? 'plays' : 'cues';
    const secondaryMetric = primaryMetric === 'cues' ? 'plays' : 'cues';
    let winner = null;
    if (tracks[0][primaryMetric] !== tracks[1][primaryMetric]) {
        winner = tracks[0][primaryMetric] > tracks[1][primaryMetric] ? tracks[0] : tracks[1];
    } else if (tracks[0][secondaryMetric] !== tracks[1][secondaryMetric]) {
        winner = tracks[0][secondaryMetric] > tracks[1][secondaryMetric] ? tracks[0] : tracks[1];
    }
    if (!winner) return null;
    return {
        path: winner.track.path,
        cues: winner.cues,
        plays: winner.plays,
        label: primaryMetric === 'cues' ? 'Cue-point pick' : 'Play-history pick',
    };
}

function setDuplicateBatchPriority(priority) {
    if (!['cues', 'plays'].includes(priority)) return;
    duplicateBatchPriority = priority;
    renderDuplicates(currentDuplicateReviewData);
}

function enterDuplicateReviewMode() {
    duplicateReviewOnlyMode = true;
    renderDuplicates(currentDuplicateReviewData);
    document.getElementById('duplicates-container')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitDuplicateReviewMode() {
    duplicateReviewOnlyMode = false;
    renderDuplicates(currentDuplicateReviewData);
    document.getElementById('duplicates-container')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyDuplicatePrioritySuggestions() {
    const unresolvedGroups = (currentDuplicateReviewData?.duplicates || []).filter(group => group.is_conflict);
    let selected = 0;
    let tied = 0;
    unresolvedGroups.forEach(group => {
        const recommendation = duplicatePriorityRecommendation(group);
        if (!recommendation) {
            tied += 1;
            return;
        }
        const selectedIndex = group.tracks.findIndex(track => track.path === recommendation.path);
        if (selectedIndex < 0) return;
        const keep = group.tracks[selectedIndex];
        const extras = group.tracks.filter((_, index) => index !== selectedIndex);
        group.tracks = [keep, ...extras];
        group.suggested_keep_path = keep.path;
        group.suggested_remove_paths = extras.map(track => track.path);
        group.is_conflict = false;
        group.manual_choice = true;
        group.priority_choice = duplicateBatchPriority;
        selected += 1;
    });
    if (!tied) duplicateReviewOnlyMode = false;
    renderDuplicates(currentDuplicateReviewData);
    if (tied) window.setTimeout(() => focusDuplicateConflict(), 80);
    showToast(tied
        ? `${selected.toLocaleString()} priority pick${selected === 1 ? '' : 's'} selected. ${tied.toLocaleString()} tied decision${tied === 1 ? '' : 's'} still need${tied === 1 ? 's' : ''} you.`
        : `${selected.toLocaleString()} priority pick${selected === 1 ? '' : 's'} selected. Review the full queue before applying changes.`);
}

function duplicateReviewRows(data = currentDuplicateReviewData) {
    const rows = [];
    (data?.duplicates || []).forEach((group, groupIndex) => {
        const keep = group.tracks?.[0];
        if (!keep) return;
        (group.tracks || []).slice(1).forEach((candidate, candidateIndex) => {
            rows.push({ group, groupIndex, candidateIndex, keep, candidate });
        });
    });
    return rows;
}

function duplicateReviewReasonText(track) {
    const reasons = Array.isArray(track?.reasons) ? track.reasons.filter(Boolean) : [];
    const soundQualityReason = /^(?:lossless format|high(?:er)? bitrate|low(?:er)? bitrate|basic file quality)$/i;
    const djEvidence = reasons.filter(reason => !soundQualityReason.test(String(reason).trim()));
    const evidencePriority = reason => {
        const value = String(reason || '');
        if (/cue points?|cues prepared/i.test(value)) return 0;
        if (/played|never played/i.test(value)) return 1;
        if (/beatgrid|dj prep/i.test(value)) return 2;
        return 3;
    };
    const orderedEvidence = djEvidence
        .map((reason, index) => ({ reason, index, priority: evidencePriority(reason) }))
        .sort((a, b) => a.priority - b.priority || a.index - b.index)
        .map(item => item.reason);
    return orderedEvidence.length ? orderedEvidence.join(' · ') : 'No DJ-use history recorded';
}

function duplicateReviewWhyText(row) {
    if (row.group.is_conflict) return 'Both copies contain DJ prep or play history. AXIOM leaves this unselected for your decision.';
    const keepFormat = String(row.keep.extension || 'file').toUpperCase();
    const moveFormat = String(row.candidate.extension || 'file').toUpperCase();
    if (Number(row.keep.bitrate || 0) > Number(row.candidate.bitrate || 0)) {
        if (keepFormat === moveFormat) return `The prepared ${Number(row.keep.bitrate || 0).toLocaleString()} kbps copy is stronger than the ${Number(row.candidate.bitrate || 0).toLocaleString()} kbps copy.`;
        return `${keepFormat} has stronger quality or DJ preparation than the ${moveFormat} copy.`;
    }
    return 'The recommended keep copy has stronger DJ preparation or play history.';
}

// Disk relocation is deliberately separate from the existing cache-only resolver.
let duplicateMoveState = null;

async function duplicateMoveRequest(payload) {
    const response = await fetch('/api/library/dupes/archive', payload ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    } : { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || 'The duplicate file operation could not finish. Open File Move History to check it.');
    return data;
}

function duplicateMoveDialog(title, body) {
    document.getElementById('duplicate-file-move-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'duplicate-file-move-dialog';
    dialog.className = 'duplicate-file-move-dialog';
    dialog.setAttribute('aria-labelledby', 'duplicate-file-move-title');
    dialog.innerHTML = `<header><h2 id="duplicate-file-move-title">${escapeHtml(title)}</h2><button type="button" aria-label="Close file moves" onclick="closeDuplicateFileMove()">Close</button></header>${body}<p id="duplicate-file-move-status" role="status" aria-live="polite"></p>`;
    dialog.addEventListener('cancel', event => {
        if (duplicateMoveState?.busy) event.preventDefault();
        else if (duplicateMoveState) duplicateMoveState.cancelled = true;
    });
    document.body.appendChild(dialog);
    dialog.showModal();
}

function closeDuplicateFileMove() {
    if (duplicateMoveState?.busy) return;
    if (duplicateMoveState) duplicateMoveState.cancelled = true;
    document.getElementById('duplicate-file-move-dialog')?.close();
}

function duplicateMoveMessage(message) {
    const status = document.getElementById('duplicate-file-move-status');
    if (status) status.textContent = message;
}

let duplicateTrashPlan = null;

function duplicateTrashProtectedPaths() {
    loadSavedPlaylists();
    if (!Array.isArray(savedPlaylists)) throw new Error('Saved playlist information is unavailable. No files will move.');
    return [...new Set([...savedPlaylists.flatMap(set => set.tracks || []), ...currentPlaylist]
        .map(track => track.path).filter(Boolean))];
}

async function checkUnusedDuplicateFiles() {
    const demo = Boolean(currentDuplicateReviewData?.health_review_duplicate_fixture);
    const paths = duplicateReviewSelectedPaths();
    if (!paths.length) return showToast('No extra copies are selected.', true);
    duplicateMoveState = {busy: true, demo, paths};
    duplicateMoveDialog('Move Duplicates to Trash', '<p>Checking plays, playlist use, saved preparation and the retained copies...</p>');
    try {
        let plan;
        if (demo) {
            plan = {ready: 1, preview_token: 'example', rows: [{title: 'Example unused copy', eligible: true, plays: 0, playlists: 0, cues: 0}]};
        } else {
            const response = await fetch('/api/library/dupes/trash', {method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-AXIOM-DJ-Publish': 'duplicate-trash'},
                body: JSON.stringify({action: 'preview', paths, protected_paths: duplicateTrashProtectedPaths()})});
            plan = await response.json();
            if (!response.ok || !plan.success) throw new Error(plan.error || 'Could not check duplicate files.');
        }
        duplicateTrashPlan = plan;
        const protectedRows = plan.rows.filter(row => !row.eligible);
        duplicateMoveDialog('Move Duplicates to Trash', `
            <h3>${plan.ready} ${plan.ready === 1 ? 'file' : 'files'} ready for Trash</h3>
            <p>0 plays. 0 playlist uses. No saved prep. An identical retained copy stays in place.</p>
            ${demo ? '<p>Interactive example. Your real music files will not move.</p>' : '<p>macOS Trash, not permanent deletion. Close your DJ apps and stop playback first.</p>'}
            ${protectedRows.length ? `<details><summary>${protectedRows.length} protected files stay untouched</summary><ul>${protectedRows.map(row => `<li>${escapeHtml(row.title)}: ${escapeHtml(row.reason)}</li>`).join('')}</ul></details>` : ''}
            <div class="duplicate-move-actions"><button type="button" onclick="closeDuplicateFileMove()">Cancel</button><button type="button" class="primary" ${plan.ready ? '' : 'disabled'} onclick="trashUnusedDuplicateFiles(this)">${demo ? 'Try Example' : `Move ${plan.ready} Files to Trash`}</button></div>`);
    } catch (error) { duplicateMoveMessage(error.message); }
    finally { duplicateMoveState.busy = false; }
}

async function trashUnusedDuplicateFiles(button) {
    if (!duplicateTrashPlan?.ready || duplicateMoveState?.busy) return;
    duplicateMoveState.busy = true;
    button.disabled = true;
    try {
        let result = {success: true, moved: duplicateTrashPlan.ready};
        if (!duplicateMoveState.demo) {
            const response = await fetch('/api/library/dupes/trash', {method: 'POST',
                headers: {'Content-Type': 'application/json', 'X-AXIOM-DJ-Publish': 'duplicate-trash'},
                body: JSON.stringify({action: 'trash', preview_token: duplicateTrashPlan.preview_token,
                    confirm: 'MOVE UNUSED DUPLICATES TO TRASH', paths: duplicateMoveState.paths,
                    protected_paths: duplicateTrashProtectedPaths()})});
            result = await response.json();
            if (!response.ok || !result.success) throw new Error(`${result.moved || 0} files moved. ${result.error || 'Remaining files were kept.'}`);
        }
        duplicateMoveMessage(duplicateMoveState.demo ? 'Example complete. No real music files were moved.' : `${result.moved} files moved to macOS Trash. Retained copies were not changed.`);
        duplicateTrashPlan = null;
        if (!duplicateMoveState.demo) loadLibraryStats();
    } catch (error) { duplicateMoveMessage(error.message); }
    finally { duplicateMoveState.busy = false; }
}

async function openDuplicateFileMove() {
    const selected = new Set(duplicateReviewSelectedPaths());
    const choices = duplicateReviewRows().filter(row => selected.has(row.candidate.path) && !row.group.is_conflict)
        .map(row => ({ path: row.candidate.path, keep_path: row.keep.path }));
    if (!choices.length) return showToast('Choose the extra files to move first.', true);
    duplicateMoveState = { choices, busy: false, batch: null, demo: Boolean(currentDuplicateReviewData?.health_review_duplicate_fixture) };
    duplicateMoveState.busy = true;
    duplicateMoveDialog('Move to Desktop Folder', '<p>Checking extra copies and the Desktop destination...</p>');
    try {
        let batch;
        if (duplicateMoveState.demo) {
            const folder = 'Desktop / AXIOM Duplicates / Example batch';
            batch = {id: 'demo', folder, bytes: 42000000,
                items: choices.map((choice, i) => ({...choice, state: 'planned',
                    destination: folder + '/' + (i + 1) + '/' + choice.path.split('/').pop()}))};
        } else {
            ({batch} = await duplicateMoveRequest({action: 'preview', destination: 'desktop', choices,
                strictness: document.getElementById('dupes-strictness')?.value || 'medium'}));
        }
        duplicateMoveState.batch = batch;
        renderDuplicateFileMoveBatch(batch, true);
    } catch (error) { duplicateMoveMessage(error.message); }
    finally { duplicateMoveState.busy = false; }
}

async function openDuplicateSoftwareRemoval() {
    const paths = duplicateReviewSelectedPaths();
    if (!paths.length) return showToast('No extra copies are selected.', true);
    const selected = new Set(paths);
    const choices = duplicateReviewRows().filter(row => selected.has(row.candidate.path) && !row.group.is_conflict)
        .map(row => ({path: row.candidate.path, keep_path: row.keep.path}));
    duplicateMoveState = {busy: false, demo: Boolean(currentDuplicateReviewData?.health_review_duplicate_fixture), paths, choices};
    const state = duplicateMoveState;
    let capabilities = {targets: ['axiom', 'serato', 'djay'], test_only: true};
    if (!duplicateMoveState.demo) {
        duplicateMoveDialog('Remove from Software', '<p>Checking available libraries...</p>');
        try {
            const response = await fetch('/api/library/dupes/software');
            capabilities = await response.json();
            if (duplicateMoveState !== state || state.cancelled) return;
            if (!response.ok || !capabilities.success) throw new Error(capabilities.error || 'Could not check library availability.');
        } catch (error) { if (duplicateMoveState === state && !state.cancelled) duplicateMoveMessage(error.message); return; }
    }
    duplicateMoveState.softwareCapabilities = capabilities;
    const target = (id, label) => `<label${capabilities.targets.includes(id) ? '' : ' class="unavailable"'}><input type="checkbox" id="duplicate-software-${id}" ${id === 'axiom' ? 'checked' : ''} ${capabilities.targets.includes(id) ? '' : 'disabled'} onchange="updateDuplicateSoftwareSelection()"><span>${label}</span><small>${capabilities.targets.includes(id) ? (capabilities.test_only ? 'Test library' : 'Available') : 'Compatibility testing'}</small></label>`;
    duplicateMoveDialog('Remove from Software', `
        <p><strong>${paths.length} extra ${paths.length === 1 ? 'copy' : 'copies'}</strong> selected. Music files stay in their original folders.</p>
        <fieldset class="duplicate-software-targets"><legend>Remove from</legend>
            ${target('axiom', 'AXIOM')}${target('serato', 'Serato DJ Pro')}${target('djay', 'djay Pro')}
            <label><input type="checkbox" id="duplicate-software-all" ${capabilities.targets.length === 3 ? '' : 'disabled'} onchange="selectAllDuplicateSoftware(this)"><span>All three</span></label>
        </fieldset>
        <p class="duplicate-move-notice">${capabilities.test_only ? 'Disposable libraries only. Your active libraries are not connected to this test.' : 'AXIOM removal is available. Serato and djay removal are still restricted to disposable-library testing.'}</p>
        ${duplicateMoveState.demo ? '<p>Interactive example. Your real libraries will not change.</p>' : ''}
        <div class="duplicate-move-actions"><button type="button" onclick="closeDuplicateFileMove()">Cancel</button><button class="primary" id="duplicate-software-apply" type="button" onclick="removeDuplicatesFromSoftware(this)">${duplicateMoveState.demo ? 'Try Selected Example' : 'Remove Selected Entries'}</button></div>`);
    updateDuplicateSoftwareSelection();
}

function updateDuplicateSoftwareSelection() {
    const inputs = ['axiom', 'serato', 'djay'].map(id => document.getElementById('duplicate-software-' + id));
    const selected = inputs.filter(input => input?.checked && !input.disabled).length;
    const all = document.getElementById('duplicate-software-all');
    if (all) { all.checked = selected === 3; all.indeterminate = selected > 0 && selected < 3; }
    const button = document.getElementById('duplicate-software-apply');
    if (button) button.disabled = !selected;
}

function selectAllDuplicateSoftware(input) {
    if (duplicateMoveState?.busy) return;
    ['axiom', 'serato', 'djay'].forEach(id => {
        const checkbox = document.getElementById('duplicate-software-' + id);
        if (checkbox && !checkbox.disabled) checkbox.checked = input.checked;
    });
    updateDuplicateSoftwareSelection();
}

async function removeDuplicatesFromSoftware(button) {
    if (duplicateMoveState?.busy || !duplicateMoveState?.paths?.length) return;
    const targets = ['axiom', 'serato', 'djay'].filter(id => document.getElementById('duplicate-software-' + id)?.checked
        && duplicateMoveState.softwareCapabilities.targets.includes(id));
    if (!targets.length) return duplicateMoveMessage('Select software to continue. No libraries have changed.');
    duplicateMoveState.busy = true;
    button.disabled = true;
    try {
        const paths = duplicateMoveState.paths;
        let result = {removed: paths.length};
        if (!duplicateMoveState.demo && duplicateMoveState.softwareCapabilities.test_only) {
            if (duplicateMoveState.choices.length !== paths.length) throw new Error('The selected copies changed. Choose the unused extras again.');
            const send = async data => {
                const response = await fetch('/api/library/dupes/software', {method: 'POST',
                    headers: {'Content-Type': 'application/json', 'X-AXIOM-DJ-Publish': 'duplicate-software'},
                    body: JSON.stringify({targets, choices: duplicateMoveState.choices, ...data})});
                const reply = await response.json();
                if (!response.ok || !reply.success) throw new Error(reply.error || 'Test removal did not complete.');
                return reply;
            };
            const preview = await send({action: 'preview'});
            result = await send({action: 'remove', preview_token: preview.plan.preview_token,
                confirm: 'REMOVE DUPLICATES FROM TEST LIBRARIES'});
            if (result.database_readback_verified !== true || targets.some(id => result.removed?.[id] !== duplicateMoveState.choices.length)) {
                throw new Error('Library removal could not be fully verified. Check the test libraries before retrying.');
            }
            result.removed = duplicateMoveState.choices.length;
        } else if (!duplicateMoveState.demo) {
            if (targets.length !== 1 || targets[0] !== 'axiom') throw new Error('Live external-library removal is not enabled.');
            const response = await fetch('/api/library/dupes/resolve', {method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({paths, target: 'axiom', strictness: document.getElementById('dupes-strictness')?.value || 'medium'})});
            result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Removal could not finish.');
        }
        const names = {axiom: 'AXIOM', serato: 'Serato DJ Pro', djay: 'djay Pro'};
        duplicateMoveDialog(duplicateMoveState.softwareCapabilities.test_only ? 'Test removal complete' : 'Software removal complete', `
            <h3>${result.removed} ${result.removed === 1 ? 'entry' : 'entries'} ${duplicateMoveState.demo ? 'in this example' : 'removed'} from ${targets.map(id => names[id]).join(', ')}</h3>
            <p>Music files stayed in their original folders. ${duplicateMoveState.softwareCapabilities.test_only ? 'Active DJ libraries were not changed.' : 'Serato and djay Pro were not changed.'}</p>
            ${duplicateMoveState.demo ? '<p>Example only. No real library entries were removed.</p>' : ''}
            <div class="duplicate-move-actions"><button type="button" class="primary" onclick="closeDuplicateFileMove()">Done</button></div>`);
        if (!duplicateMoveState.demo && !duplicateMoveState.softwareCapabilities.test_only) {
            currentRemovedFromAxiomBin = result.restore_bin || currentRemovedFromAxiomBin;
            loadLibraryStats();
            scanDuplicates();
        }
    } catch (error) { duplicateMoveMessage(error.message); }
    finally { duplicateMoveState.busy = false; button.disabled = false; }
}

function renderDuplicateFileMoveBatch(batch, preview = false) {
    const moved = batch.items.filter(row => row.state === 'moved').length;
    const restored = batch.items.filter(row => row.state === 'restored').length;
    const recoverable = batch.items.some(row => ['moved', 'copied', 'copying'].includes(row.state));
    duplicateMoveDialog(preview ? 'Move to Desktop Folder' : 'Duplicate file receipt', `
        <p><strong>${batch.items.length.toLocaleString()} files · ${(batch.bytes / 1048576).toFixed(1)} MB</strong>${preview ? '' : ` · ${moved} moved · ${restored} restored`}</p>
        <p class="duplicate-move-path">${escapeHtml(batch.folder)}</p>
        ${duplicateMoveState?.demo ? '<p>Interactive example. No real files will move.</p>' : ''}
        ${preview ? '<p>Extra files leave their current folders. Your retained copies stay where they are. Delete the Desktop copies whenever you are ready.</p>' : ''}
        <details><summary>File locations</summary>
        <div class="duplicate-move-items">${batch.items.map(row => `<article><strong>${escapeHtml(row.path.split('/').pop())}</strong><dl><dt>Keep</dt><dd>${escapeHtml(row.keep_path)}</dd><dt>Move from</dt><dd>${escapeHtml(row.path)}</dd><dt>Move to</dt><dd>${escapeHtml(row.destination)}</dd></dl><small>${escapeHtml(row.error || (row.state === 'planned' ? 'Ready for your approval' : row.state))}</small></article>`).join('')}</div>
        </details>
        <p class="duplicate-move-notice">${preview ? 'File moves can leave missing references in DJ software or projects. Best copies and audio content stay unchanged. Close DJ apps and stop playback before a real move.' : 'Retained copies stay in place. Archived copies can be deleted later in Finder. Software libraries are not edited by this action.'}</p>
        <div class="duplicate-move-actions">
            ${preview ? `<button type="button" class="primary" onclick="runDuplicateFileBatch('move', this)">${duplicateMoveState?.demo ? 'Try Desktop Example' : `Move ${batch.items.length} Files to Desktop`}</button>` : ''}
            ${!preview && recoverable ? '<button type="button" onclick="runDuplicateFileBatch(\'restore\', this)">Restore Files to Original Locations</button>' : ''}
            ${!preview ? '<button type="button" onclick="revealDuplicateMoveFolder()">Open Folder in Finder</button><button type="button" class="primary" onclick="closeDuplicateFileMove()">Done</button>' : ''}
        </div>`);
}

async function runDuplicateFileBatch(action, button) {
    if (duplicateMoveState?.busy || !duplicateMoveState?.batch) return;
    // The labelled Restore button in the reviewed receipt is the confirmation.
    // Do not open the shared confirmation overlay behind this native dialog.
    duplicateMoveState.busy = true;
    const dialog = document.getElementById('duplicate-file-move-dialog');
    dialog.querySelectorAll('button').forEach(control => control.disabled = true);
    let batch = duplicateMoveState.batch;
    let failure = '';
    try {
        for (let index = 0; index < batch.items.length; index++) {
            const item = batch.items[index];
            const eligible = action === 'move' ? ['planned', 'failed'] : ['moved', 'copied', 'copying'];
            if (!eligible.includes(item.state)) continue;
            duplicateMoveMessage(`${action === 'move' ? 'Moving and verifying' : 'Restoring and verifying'} ${index + 1} of ${batch.items.length}: ${item.path.split('/').pop()}`);
            if (duplicateMoveState.demo) {
                item.state = action === 'move' ? 'moved' : 'restored';
            } else {
                ({ batch } = await duplicateMoveRequest({ action, batch_id: batch.id, item: index, confirm_folder: batch.folder }));
                duplicateMoveState.batch = batch;
                if (batch.items[index].error) throw new Error(batch.items[index].error);
            }
        }
    } catch (error) { failure = error.message; }
    finally {
        duplicateMoveState.busy = false;
        duplicateMoveState.batch = batch;
        renderDuplicateFileMoveBatch(batch);
        duplicateMoveMessage(failure || (duplicateMoveState.demo ? 'Demonstration complete. No real files moved.' : 'Finished. The receipt shows the result for every file.'));
        if (!duplicateMoveState.demo) {
            loadLibraryStats();
            // Remove moved candidates from the underlying review so they cannot be applied twice.
            const movedPaths = new Set(batch.items.filter(item => item.state === 'moved').map(item => item.path));
            if (currentDuplicateReviewData && action === 'move') {
                currentDuplicateReviewData.duplicates = currentDuplicateReviewData.duplicates.map(group => ({ ...group,
                    tracks: group.tracks.filter(track => !movedPaths.has(track.path)) })).filter(group => group.tracks.length > 1);
                currentDuplicateReviewData.summary.groups = currentDuplicateReviewData.duplicates.length;
                renderDuplicates(currentDuplicateReviewData);
            }
        }
    }
}

async function openDuplicateMoveHistory() {
    if (duplicateMoveState?.busy) return;
    try {
        const { batches } = await duplicateMoveRequest();
        duplicateMoveState = { busy: false, demo: false, batches };
        duplicateMoveDialog('File Move History', `<p>Restore archived files to their original locations, or open a batch in Finder.</p><div class="duplicate-move-items">${batches.length ? batches.map((batch, index) => `<article><strong>${escapeHtml(new Date(batch.created * 1000).toLocaleString())}</strong><p class="duplicate-move-path">${escapeHtml(batch.folder)}</p><p>${batch.items.filter(row => row.state === 'moved').length} moved · ${batch.items.filter(row => row.state === 'restored').length} restored</p><button type="button" onclick="openDuplicateMoveHistoryBatch(${index})">Review / Restore</button></article>`).join('') : '<p>No files have been moved yet.</p>'}</div>`);
    } catch (error) { showToast(error.message, true); }
}

async function openDuplicateMoveHistoryBatch(index) {
    try {
        const selected = duplicateMoveState.batches[index];
        const { batch } = await duplicateMoveRequest({ action: 'reconcile', batch_id: selected.id });
        duplicateMoveState.batch = batch;
        renderDuplicateFileMoveBatch(batch);
    } catch (error) { duplicateMoveMessage(error.message); }
}

async function revealDuplicateMoveFolder() {
    if (duplicateMoveState?.demo) return duplicateMoveMessage('Demo destination only. No folder was created.');
    try { await duplicateMoveRequest({ action: 'reveal', batch_id: duplicateMoveState.batch.id }); }
    catch (error) { duplicateMoveMessage(error.message); }
}

function duplicateReviewSelectedPaths() {
    return Array.from(document.querySelectorAll('.dupe-trash-checkbox:checked')).map(cb => cb.dataset.path).filter(Boolean);
}

function updateDuplicateReviewHeader(data = currentDuplicateReviewData) {
    const badge = document.getElementById('duplicates-review-ready-badge');
    const copy = document.getElementById('duplicates-review-copy');
    const groups = Number(data?.summary?.groups || data?.duplicates?.length || 0);
    if (badge) {
        badge.textContent = groups ? `${groups.toLocaleString()} group${groups === 1 ? '' : 's'} ready to review` : 'Library clear';
        badge.classList.add('hidden');
    }
    if (copy) copy.textContent = groups
        ? 'Keep the best copies. Trash extra files, move them to Desktop, or remove software entries only.'
        : 'No extra AXIOM library rows need attention. Your audio files were not changed.';
    document.querySelector('.duplicate-review-controls')?.classList.add('duplicate-review-controls-internal');
}

function toggleDuplicateDecisionRow(button) {
    const row = button?.closest('[data-dupe-row]');
    if (!row) return;
    const expanded = row.classList.toggle('is-expanded');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function focusDuplicateConflict() {
    const row = document.querySelector('[data-dupe-row][data-conflict="true"]');
    if (!row) return;
    row.classList.add('is-expanded', 'is-review-focused');
    const toggle = row.querySelector('.duplicate-decision-toggle');
    toggle?.setAttribute('aria-expanded', 'true');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
        row.classList.remove('is-review-focused');
        row.querySelector('.duplicate-decision-choice')?.focus();
    }, 420);
}

function chooseDuplicateConflictCopy(groupIndex, keepPath) {
    const group = currentDuplicateReviewData?.duplicates?.[Number(groupIndex)];
    if (!group || !Array.isArray(group.tracks)) return;
    const selectedIndex = group.tracks.findIndex(track => track.path === keepPath);
    if (selectedIndex < 0) return;
    const keep = group.tracks[selectedIndex];
    const extras = group.tracks.filter((_, index) => index !== selectedIndex);
    if (!extras.length) return;
    group.tracks = [keep, ...extras];
    group.suggested_keep_path = keep.path;
    group.suggested_remove_paths = extras.map(track => track.path);
    group.is_conflict = false;
    group.manual_choice = true;
    if (!(currentDuplicateReviewData?.duplicates || []).some(item => item.is_conflict)) duplicateReviewOnlyMode = false;
    renderDuplicates(currentDuplicateReviewData);
    showToast(`${keep.title || 'Selected copy'} will stay in AXIOM. The extra row remains recoverable.`);
}

function toggleDuplicateReviewSelection(input) {
    input?.closest('[data-dupe-row]')?.setAttribute('data-selected', input.checked ? 'true' : 'false');
    toggleDupeResolveBtn();
}

function toggleDupeResolveBtn() {
    const checked = duplicateReviewSelectedPaths().length;
    const actionBtn = document.getElementById('dupes-resolve-review-btn');
    const moveBtn = document.getElementById('dupes-move-files-btn');
    if (moveBtn) moveBtn.disabled = checked === 0;
    const trashBtn = document.getElementById('dupes-trash-files-btn');
    if (trashBtn) trashBtn.disabled = checked === 0;
    const selectedTotal = document.getElementById('duplicate-review-selected-total');
    const selectAll = document.getElementById('duplicate-review-select-all');
    const selectable = Array.from(document.querySelectorAll('.dupe-trash-checkbox:not(:disabled)'));
    if (selectedTotal) selectedTotal.textContent = checked.toLocaleString();
    if (actionBtn) {
        actionBtn.disabled = checked === 0;
    }
    if (selectAll) {
        selectAll.checked = Boolean(selectable.length) && selectable.every(cb => cb.checked);
        selectAll.indeterminate = checked > 0 && !selectAll.checked;
    }
}

function selectRecommendedDuplicates() {
    document.querySelectorAll('.dupe-trash-checkbox:not(:disabled)[data-recommended="true"]').forEach(cb => {
        cb.checked = true;
        cb.closest('[data-dupe-row]')?.setAttribute('data-selected', 'true');
    });
    toggleDupeResolveBtn();
}

function clearDuplicateSelection() {
    document.querySelectorAll('.dupe-trash-checkbox:not(:disabled)').forEach(cb => {
        cb.checked = false;
        cb.closest('[data-dupe-row]')?.setAttribute('data-selected', 'false');
    });
    toggleDupeResolveBtn();
}

function toggleAllDuplicateReviewSelections(checked) {
    if (checked) selectRecommendedDuplicates();
    else clearDuplicateSelection();
}

function setDuplicateReviewProgress({ visible = true, done = 0, total = 0, label = 'Preparing duplicate review...' } = {}) {
    const panel = document.getElementById('duplicate-review-progress');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
    const detail = document.getElementById('duplicate-review-progress-detail');
    const count = document.getElementById('duplicate-review-progress-count');
    const bar = document.getElementById('duplicate-review-progress-bar');
    if (detail) detail.textContent = label;
    if (count) count.textContent = total ? `${Math.min(done, total).toLocaleString()} of ${total.toLocaleString()}` : 'Starting';
    if (bar) bar.style.width = `${total ? Math.round((Math.min(done, total) / total) * 100) : 8}%`;
}

function renderDuplicates(data) {
    const container = document.getElementById('duplicates-container');
    if (!container) return;
    currentDuplicateReviewData = data || null;
    currentDuplicateReviewReceipt = null;
    updateDuplicateReviewHeader(data);
    const allRows = duplicateReviewRows(data);
    if (!allRows.length) {
        container.innerHTML = `
            <div class="duplicate-review-shell">
                <div class="duplicate-review-empty">
                    <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                    <div><strong>No duplicate groups found</strong><p>AXIOM did not find another indexed copy under the selected match rules. Source audio was not changed.</p></div>
                </div>
                <div class="health-clean-review-actions">
                    <button class="health-clean-review-button" type="button" onclick="showTab('health')">Back to Health</button>
                    <span class="spacer"></span>
                    <button class="health-clean-review-button primary" type="button" onclick="scanDuplicates(this)">Scan Again</button>
                </div>
            </div>`;
        return;
    }

    const allConflictRows = allRows.filter(row => row.group.is_conflict);
    const rows = duplicateReviewOnlyMode ? allConflictRows : allRows;
    const recommendedPaths = new Set();
    allRows.forEach(row => {
        if (!row.group.is_conflict && (row.group.suggested_remove_paths || []).includes(row.candidate.path)) recommendedPaths.add(row.candidate.path);
    });
    const conflictCount = allConflictRows.length;
    const selectedCount = recommendedPaths.size;
    const priorityRecommendations = new Map();
    allConflictRows.forEach(row => {
        const recommendation = duplicatePriorityRecommendation(row.group);
        if (recommendation) priorityRecommendations.set(row.group.group_key || row.groupIndex, recommendation);
    });
    const prioritySuggestionCount = priorityRecommendations.size;
    const priorityTieCount = Math.max(0, conflictCount - prioritySuggestionCount);
    const rowHtml = rows.map((row, index) => {
        const selected = recommendedPaths.has(row.candidate.path);
        const conflict = Boolean(row.group.is_conflict);
        const priorityRecommendation = duplicateReviewOnlyMode
            ? priorityRecommendations.get(row.group.group_key || row.groupIndex) || null
            : null;
        const keepIsPriorityPick = priorityRecommendation?.path === row.keep.path;
        const restoreIsPriorityPick = priorityRecommendation?.path === row.candidate.path;
        const rowNumber = duplicateReviewOnlyMode ? `Review ${index + 1}` : `${allRows.indexOf(row) + 1}.`;
        return `
            <article class="duplicate-decision-row" data-dupe-row data-selected="${selected ? 'true' : 'false'}" data-conflict="${conflict ? 'true' : 'false'}">
                <input class="dupe-trash-checkbox hidden" type="checkbox" data-path="${escapeHtml(row.candidate.path)}" data-recommended="${selected ? 'true' : 'false'}" ${selected ? 'checked' : ''} ${conflict ? 'disabled' : ''} onchange="toggleDuplicateReviewSelection(this)" aria-label="Move the extra AXIOM row for ${escapeHtml(row.candidate.title || row.candidate.path)} to Restore Bin">
                <div class="duplicate-decision-row-main">
                    <div class="duplicate-decision-group">
                        <strong>${rowNumber} ${escapeHtml(row.keep.title || 'Untitled')}</strong>
                        <small>${escapeHtml(row.keep.artist || 'Unknown Artist')}</small>
                    </div>
                    <div class="duplicate-decision-copy keep ${keepIsPriorityPick ? 'is-priority-pick' : ''}">
                        ${keepIsPriorityPick ? `<em class="duplicate-priority-pick">${escapeHtml(priorityRecommendation.label)}</em>` : ''}
                        <strong class="duplicate-decision-evidence">${escapeHtml(duplicateReviewReasonText(row.keep))}</strong>
                        <small class="duplicate-decision-path" title="${escapeHtml(row.keep.path)}">${escapeHtml(row.keep.path)}</small>
                        <span class="duplicate-decision-technical">${escapeHtml(String(row.keep.extension || 'FILE').toUpperCase())} · ${Number(row.keep.bitrate || 0).toLocaleString()} kbps</span>
                    </div>
                    <div class="duplicate-decision-copy restore ${restoreIsPriorityPick ? 'is-priority-pick' : ''}">
                        ${restoreIsPriorityPick ? `<em class="duplicate-priority-pick">${escapeHtml(priorityRecommendation.label)}</em>` : ''}
                        <strong class="duplicate-decision-evidence">${escapeHtml(duplicateReviewReasonText(row.candidate))}</strong>
                        <small class="duplicate-decision-path" title="${escapeHtml(row.candidate.path)}">${escapeHtml(row.candidate.path)}</small>
                        <span class="duplicate-decision-technical">${escapeHtml(String(row.candidate.extension || 'FILE').toUpperCase())} · ${Number(row.candidate.bitrate || 0).toLocaleString()} kbps</span>
                    </div>
                    <div class="duplicate-decision-state ${conflict ? 'review' : 'safe'}">${conflict ? 'Review' : 'Best Copy'}</div>
                    <button type="button" class="duplicate-decision-toggle" onclick="toggleDuplicateDecisionRow(this)" aria-expanded="false" aria-label="Show decision details for ${escapeHtml(row.keep.title || 'duplicate group')}">
                        <img src="/static/icons/chevron-down.svg" alt="" aria-hidden="true">
                    </button>
                </div>
                <div class="duplicate-decision-details">
                    <div>
                        <span>${conflict ? 'Why AXIOM paused' : 'Why this is the best copy'}</span>
                        <p>${escapeHtml(duplicateReviewWhyText(row))}</p>
                    </div>
                    ${conflict ? `
                        <div class="duplicate-decision-review-choices" aria-label="Choose which ${escapeHtml(row.keep.title || 'duplicate')} copy stays in AXIOM">
                            <button type="button" class="duplicate-decision-choice" data-keep-path="${escapeHtml(row.keep.path)}" onclick="chooseDuplicateConflictCopy(${row.groupIndex}, this.dataset.keepPath)">Keep ${escapeHtml(String(row.keep.extension || 'FILE').toUpperCase())}</button>
                            <button type="button" class="duplicate-decision-choice" data-keep-path="${escapeHtml(row.candidate.path)}" onclick="chooseDuplicateConflictCopy(${row.groupIndex}, this.dataset.keepPath)">Keep ${escapeHtml(String(row.candidate.extension || 'FILE').toUpperCase())}</button>
                            <span>AXIOM changes neither row until you choose.</span>
                        </div>` : '<span class="duplicate-decision-reversible">The extra AXIOM row can be restored anytime.</span>'}
                </div>
            </article>`;
    }).join('');

    const priorityName = duplicateBatchPriority === 'cues' ? 'cue points first' : 'play history first';
    const reviewFocusMarkup = duplicateReviewOnlyMode ? `
        <section class="duplicate-priority-bar" aria-label="Focused duplicate review controls">
            <div class="duplicate-priority-intro">
                <span>Focused Review Queue</span>
                <strong>${conflictCount.toLocaleString()} Decision${conflictCount === 1 ? '' : 's'} Together</strong>
                <p>Only unresolved copies are shown. Priority picks are suggestions until you select and confirm them.</p>
            </div>
            <div class="duplicate-priority-options" role="group" aria-label="Batch review priority">
                <span>Batch priority</span>
                <button type="button" class="${duplicateBatchPriority === 'cues' ? 'is-active' : ''}" aria-pressed="${duplicateBatchPriority === 'cues' ? 'true' : 'false'}" onclick="setDuplicateBatchPriority('cues')">Cue Points First</button>
                <button type="button" class="${duplicateBatchPriority === 'plays' ? 'is-active' : ''}" aria-pressed="${duplicateBatchPriority === 'plays' ? 'true' : 'false'}" onclick="setDuplicateBatchPriority('plays')">Play History First</button>
            </div>
            <div class="duplicate-priority-summary">
                <strong>${prioritySuggestionCount.toLocaleString()} suggested</strong>
                <small>${priorityTieCount ? `${priorityTieCount.toLocaleString()} tied decision${priorityTieCount === 1 ? ' stays' : 's stay'} manual` : 'No tied decisions'}</small>
                <span>Current rule: ${priorityName}</span>
            </div>
        </section>` : '';
    const reviewFooterMarkup = duplicateReviewOnlyMode ? `
        <button class="duplicate-decision-back" type="button" onclick="exitDuplicateReviewMode()"><img src="/static/icons/chevron-down.svg" alt="" aria-hidden="true">Back to All ${allRows.length.toLocaleString()}</button>
        <div class="duplicate-decision-proof"><strong>${conflictCount.toLocaleString()} grouped review decision${conflictCount === 1 ? '' : 's'}</strong><i>·</i><strong class="review">${prioritySuggestionCount.toLocaleString()} priority suggestion${prioritySuggestionCount === 1 ? '' : 's'}</strong><i>·</i><strong>${priorityTieCount.toLocaleString()} manual tie${priorityTieCount === 1 ? '' : 's'}</strong></div>
        <span class="spacer"></span>
        ${prioritySuggestionCount ? `<button class="duplicate-decision-apply" type="button" onclick="applyDuplicatePrioritySuggestions()">Select ${prioritySuggestionCount.toLocaleString()} Priority Pick${prioritySuggestionCount === 1 ? '' : 's'}</button>` : ''}` : `
        <div class="duplicate-cleanup-summary">
            <strong><span id="duplicate-review-selected-total">${selectedCount.toLocaleString()}</span> extra ${selectedCount === 1 ? 'copy' : 'copies'} selected</strong>
            ${conflictCount ? `<span>${conflictCount.toLocaleString()} prepared ${conflictCount === 1 ? 'pair stays' : 'pairs stay'} protected</span>` : ''}
        </div>
        <div class="duplicate-cleanup-actions" role="group" aria-label="Duplicate cleanup actions">
            <div><button id="dupes-trash-files-btn" type="button" onclick="checkUnusedDuplicateFiles()"><img src="/static/icons/trash-2.svg" alt="" aria-hidden="true">Move Duplicates to Trash</button><p>Music files move to macOS Trash.</p></div>
            <div><button id="dupes-move-files-btn" type="button" onclick="openDuplicateFileMove()"><img src="/static/icons/folder-open.svg" alt="" aria-hidden="true">Move to Desktop Folder</button><p>Desktop / AXIOM Duplicates. Delete later.</p></div>
            <div><button id="dupes-resolve-review-btn" type="button" onclick="openDuplicateSoftwareRemoval()"><img src="/static/icons/database.svg" alt="" aria-hidden="true">Remove from Software</button><p>Files stay in their folders. AXIOM available now.</p></div>
        </div>`;

    container.innerHTML = `
        <div class="duplicate-review-shell ${duplicateReviewOnlyMode ? 'duplicate-review-focused' : ''}">
            ${reviewFocusMarkup}
            <section class="duplicate-decision-table" aria-label="Duplicate decisions">
                <div class="duplicate-decision-columns" aria-hidden="true">
                    <span>Song</span><span>Keep in AXIOM</span><span>Extra copy</span><span>Decision</span><span></span>
                </div>
                ${rowHtml}
            </section>

            <section id="duplicate-review-progress" class="duplicate-review-progress hidden" aria-live="polite">
                <div class="duplicate-review-progress-head"><span id="duplicate-review-progress-detail">Preparing duplicate review...</span><strong id="duplicate-review-progress-count">Starting</strong></div>
                <div class="duplicate-review-progress-track"><span id="duplicate-review-progress-bar"></span></div>
            </section>

            <div class="duplicate-decision-actions">
                ${reviewFooterMarkup}
            </div>
        </div>`;
    container.scrollTop = 0;
    if (!duplicateReviewOnlyMode) toggleDupeResolveBtn();
}

function renderDuplicateReceipt(receipt) {
    const container = document.getElementById('duplicates-container');
    if (!container) return;
    currentDuplicateReviewReceipt = receipt;
    const data = receipt.data || currentDuplicateReviewData || { duplicates: [] };
    const movedPaths = new Set(receipt.movedPaths || []);
    const rows = duplicateReviewRows(data);
    const completedRows = rows.filter(row => movedPaths.has(row.candidate.path));
    const pendingRows = rows.filter(row => !movedPaths.has(row.candidate.path));
    const receiptRows = completedRows.map(row => `
        <div class="duplicate-outcome-pair">
            <div class="duplicate-outcome-copy keep">
                <span>Best copy stays in AXIOM</span>
                <strong>${escapeHtml(row.keep.title || 'Untitled')} · ${escapeHtml(String(row.keep.extension || 'FILE').toUpperCase())} ${Number(row.keep.bitrate || 0).toLocaleString()} kbps</strong>
                <small title="${escapeHtml(row.keep.path)}">${escapeHtml(row.keep.path)}</small>
                <em>${escapeHtml(duplicateReviewReasonText(row.keep))}</em>
            </div>
            <div class="duplicate-outcome-arrow"><img src="/static/icons/chevron-down.svg" alt="" aria-hidden="true"></div>
            <div class="duplicate-outcome-copy">
                <span>${receipt.restored ? 'Extra row restored to AXIOM view' : 'Extra AXIOM row hidden'}</span>
                <strong>${escapeHtml(row.candidate.title || 'Untitled')} · ${escapeHtml(String(row.candidate.extension || 'FILE').toUpperCase())} ${Number(row.candidate.bitrate || 0).toLocaleString()} kbps</strong>
                <small title="${escapeHtml(row.candidate.path)}">${escapeHtml(row.candidate.path)}</small>
                <em>${receipt.restored ? 'This library row is visible in AXIOM again. The audio file was never changed.' : 'Recoverable from Restore Bin. The audio file is still on your Mac.'}</em>
            </div>
        </div>`).join('');
    const pendingHtml = pendingRows.map(row => `
        <div class="duplicate-outcome-pending">
            <strong>${escapeHtml(row.keep.title || row.candidate.title || 'Untitled')} · ${escapeHtml(row.keep.artist || row.candidate.artist || 'Unknown Artist')}</strong>
            <span>${row.group.is_conflict ? 'Manual review still required. Both copies contain DJ prep, so AXIOM changed neither row.' : 'Not selected. AXIOM changed neither library row.'}</span>
        </div>`).join('');
    const pending = Math.max(0, Number(receipt.pending || 0));
    const actionCount = receipt.restored ? Number(receipt.restoredCount || 0) : Number(receipt.moved || 0);
    const headerBadge = document.getElementById('duplicates-review-ready-badge');
    const headerCopy = document.getElementById('duplicates-review-copy');
    if (headerBadge) headerBadge.textContent = '0 audio files deleted';
    if (headerCopy) headerCopy.textContent = receipt.restored
        ? 'Extra AXIOM rows are visible again. Every audio file stayed exactly where it was on your Mac.'
        : 'Best copies remain active in AXIOM. Extra library rows are recoverable, and every audio file is still on your Mac.';
    document.querySelector('.duplicate-review-controls')?.classList.add('hidden');
    container.innerHTML = `
        <div class="duplicate-review-shell">
            <section class="duplicate-outcome-hero" aria-live="polite">
                <div class="duplicate-outcome-lead">
                    <img src="/static/icons/check-circle.svg" alt="" aria-hidden="true">
                    <div><h3>${receipt.restored ? 'Extra AXIOM rows restored' : 'Best copies kept in AXIOM'}</h3><p>${receipt.restored ? `${actionCount.toLocaleString()} extra library row${actionCount === 1 ? '' : 's'} returned to AXIOM view. Audio files were never changed.` : `${Number(receipt.checked || 0).toLocaleString()} best cop${Number(receipt.checked || 0) === 1 ? 'y stays' : 'ies stay'} active. ${actionCount.toLocaleString()} extra AXIOM row${actionCount === 1 ? '' : 's'} ${actionCount === 1 ? 'is' : 'are'} safely recoverable.`}</p></div>
                </div>
                <div class="duplicate-outcome-facts">
                    <div class="duplicate-outcome-fact safe"><strong>${Number(receipt.checked || 0).toLocaleString()}</strong><span>Best copies kept in AXIOM</span></div>
                    <div class="duplicate-outcome-fact"><strong>${actionCount.toLocaleString()}</strong><span>${receipt.restored ? 'Extra AXIOM rows restored' : 'Extra AXIOM rows hidden'}</span></div>
                    <div class="duplicate-outcome-fact safe"><strong>0</strong><span>Audio files deleted</span></div>
                </div>
            </section>
            <section class="duplicate-outcome-list" aria-label="Duplicate outcome receipt">
                ${receiptRows}
                ${pendingHtml}
            </section>
            <div class="health-clean-review-actions">
                <button class="health-clean-review-button" type="button" onclick="showTab('health')">Back to Health</button>
                <button class="health-clean-review-button" type="button" onclick="scanDuplicates(this)">Scan Again</button>
                ${!receipt.restored && movedPaths.size ? '<button class="health-clean-review-button" type="button" onclick="restoreDuplicateReceipt(this)">Undo Hidden AXIOM Rows</button>' : ''}
                ${receipt.demo ? '<button class="health-clean-review-button link" type="button" onclick="resetDuplicateReviewDemo()">Reset Demo</button>' : ''}
                <span class="spacer"></span>
            </div>
        </div>`;
    container.scrollTop = 0;
    window.requestAnimationFrame(() => { container.scrollTop = 0; });
    window.setTimeout(() => { container.scrollTop = 0; }, 0);
}

async function resolveDuplicates(target = 'axiom', triggerBtn = null) {
    const paths = duplicateReviewSelectedPaths();
    if (!paths.length) return;
    const strictness = document.getElementById('dupes-strictness')?.value || 'medium';
    const confirmed = await showAxiomConfirm(
        'Apply Safe Duplicate Decisions',
        `AXIOM will keep ${paths.length.toLocaleString()} best cop${paths.length === 1 ? 'y' : 'ies'} visible and hide ${paths.length.toLocaleString()} extra library row${paths.length === 1 ? '' : 's'} in Restore Bin. 0 audio files will be deleted. You can undo this anytime.`,
        'APPLY SAFE DECISIONS',
        'primary'
    );
    if (!confirmed) return;

    const btn = triggerBtn || document.getElementById('dupes-resolve-review-btn');
    setAxiomButtonBusy(btn, true, 'Keeping...');
    document.querySelectorAll('.dupe-trash-checkbox, #duplicate-review-select-all').forEach(input => input.disabled = true);
    setDuplicateReviewProgress({ visible: true, done: 0, total: paths.length, label: 'Accepted. Keeping the best copies visible in AXIOM...' });

    if (axiomReviewMode() === 'health' && currentDuplicateReviewData?.health_review_duplicate_fixture) {
        let done = 0;
        const runNext = () => {
            if (done >= paths.length) {
                duplicateReviewDemoTimer = null;
                const pending = Math.max(0, duplicateReviewRows(currentDuplicateReviewData).length - paths.length);
                recordAxiomSessionActivity('duplicate', paths.length, {
                    key: `duplicates-demo:${Date.now()}`,
                    trackIds: paths,
                });
                renderDuplicateReceipt({ data: currentDuplicateReviewData, checked: paths.length, moved: paths.length, movedPaths: paths, pending, demo: true, restored: false });
                showToast(`${paths.length.toLocaleString()} best cop${paths.length === 1 ? 'y' : 'ies'} kept in AXIOM. 0 audio files deleted.`);
                return;
            }
            done += 1;
            const label = paths[done - 1].split('/').pop() || `Duplicate ${done}`;
            setDuplicateReviewProgress({ visible: true, done, total: paths.length, label: `Keeping the best copy. Hiding the extra AXIOM row for ${label} — audio stays on your Mac.` });
            duplicateReviewDemoTimer = window.setTimeout(runNext, 520);
        };
        duplicateReviewDemoTimer = window.setTimeout(runNext, 280);
        return;
    }

    try {
        setDuplicateReviewProgress({ visible: true, done: 0, total: paths.length, label: 'AXIOM accepted the request. Verifying the best copies to keep visible...' });
        const response = await fetch('/api/library/dupes/resolve', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ paths, target, strictness })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Failed to resolve duplicates');
        const movedPaths = result.removed_paths || [];
        setDuplicateReviewProgress({ visible: true, done: paths.length, total: paths.length, label: 'Best copies kept. Extra AXIOM rows are safely recoverable.' });
        const pending = Math.max(0, duplicateReviewRows(currentDuplicateReviewData).length - movedPaths.length);
        recordAxiomSessionActivity('duplicate', Number(result.cache_rows_hidden ?? result.moved ?? movedPaths.length), {
            key: `duplicates:${Date.now()}`,
            trackIds: movedPaths,
        });
        renderDuplicateReceipt({ data: currentDuplicateReviewData, checked: Number(result.best_copies_kept ?? result.moved ?? movedPaths.length), moved: Number(result.cache_rows_hidden ?? result.moved ?? movedPaths.length), movedPaths, pending, demo: false, restored: false });
        currentRemovedFromAxiomBin = result.restore_bin || currentRemovedFromAxiomBin;
        removedFromAxiomBinLoadedAt = Date.now();
        showToast(`${Number(result.moved || 0).toLocaleString()} best cop${Number(result.moved || 0) === 1 ? 'y' : 'ies'} kept in AXIOM. 0 audio files deleted.`);
        loadLibraryStats();
    } catch (error) {
        setDuplicateReviewProgress({ visible: true, done: 0, total: paths.length, label: error.message || 'Duplicate review failed. No AXIOM rows changed and audio files stayed untouched.' });
        document.querySelectorAll('.dupe-trash-checkbox, #duplicate-review-select-all').forEach(input => input.disabled = false);
        showToast(error.message || 'Error resolving duplicates.', true);
    } finally {
        setAxiomButtonBusy(btn, false);
    }
}

async function restoreDuplicateReceipt(triggerBtn = null) {
    const receipt = currentDuplicateReviewReceipt;
    const paths = receipt?.movedPaths || [];
    if (!paths.length) return;
    const btn = triggerBtn;
    setAxiomButtonBusy(btn, true, 'Undoing...');
    if (receipt.demo) {
        window.setTimeout(() => {
            renderDuplicateReceipt({ ...receipt, restored: true, restoredCount: paths.length });
            showToast(`${paths.length.toLocaleString()} extra AXIOM row${paths.length === 1 ? ' is' : 's are'} visible again. Audio files were never changed.`);
        }, 520);
        return;
    }
    try {
        const response = await fetch('/api/library/removed_from_axiom/restore', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ paths })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Restore failed');
        renderDuplicateReceipt({ ...receipt, restored: true, restoredCount: Number(result.count || 0) });
        currentRemovedFromAxiomBin = result.bin || null;
        removedFromAxiomBinLoadedAt = Date.now();
        showToast(`${Number(result.count || 0).toLocaleString()} extra AXIOM row${Number(result.count || 0) === 1 ? ' is' : 's are'} visible again. Audio files were never changed.`);
        loadLibraryStats();
    } catch (error) {
        showToast(error.message || 'Restore failed', true);
        setAxiomButtonBusy(btn, false);
    }
}

function resetDuplicateReviewDemo() {
    if (duplicateReviewDemoTimer) window.clearTimeout(duplicateReviewDemoTimer);
    duplicateReviewDemoTimer = null;
    duplicateReviewOnlyMode = false;
    duplicateBatchPriority = 'cues';
    const strictness = document.getElementById('dupes-strictness')?.value || 'medium';
    renderDuplicates(duplicateReviewFixtureData(strictness));
}

function openHealthDuplicateResolver(triggerBtn = null) {
    setHealthWorkspaceGroupActive('organisation');
    setAxiomButtonBusy(triggerBtn, true, 'Opening...');
    showTab('duplicates');
    window.setTimeout(() => {
        setAxiomButtonBusy(triggerBtn, false);
        if (typeof scanDuplicates === 'function') {
            scanDuplicates(document.getElementById('dupes-scan-btn'));
        }
    }, 180);
}

function scanDuplicates(triggerBtn = null) {
    const strictness = document.getElementById('dupes-strictness')?.value || 'medium';
    const container = document.getElementById('duplicates-container');
    const btn = triggerBtn || document.getElementById('dupes-scan-btn');
    duplicateReviewOnlyMode = false;
    duplicateBatchPriority = 'cues';
    if (duplicateReviewDemoTimer) window.clearTimeout(duplicateReviewDemoTimer);
    duplicateReviewDemoTimer = null;
    document.querySelector('.duplicate-review-controls')?.classList.add('duplicate-review-controls-internal');
    setAxiomButtonBusy(btn, true, 'Scanning...');
    document.getElementById('dupes-strictness')?.setAttribute('disabled', 'disabled');
    document.getElementById('duplicates-review-ready-badge').textContent = 'Safe scan running';
    const headerCopy = document.getElementById('duplicates-review-copy');
    if (headerCopy) headerCopy.textContent = 'Finding duplicate library rows. This scan cannot delete or change audio files.';
    container.innerHTML = `
        <div class="duplicate-review-shell">
            <div class="duplicate-review-progress" aria-live="polite">
                <div class="duplicate-review-progress-head"><span>Scan accepted. Comparing AXIOM library rows. No files are being changed.</span><strong>Working</strong></div>
                <div class="duplicate-review-progress-track"><span style="width:42%"></span></div>
            </div>
        </div>
    `;

    if (axiomReviewMode() === 'health') {
        window.setTimeout(() => {
            renderDuplicates(duplicateReviewFixtureData(strictness));
            setAxiomButtonBusy(btn, false);
            document.getElementById('dupes-strictness')?.removeAttribute('disabled');
        }, 420);
        return;
    }

    fetch(`/api/library/dupes?strictness=${strictness}`)
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                renderDuplicates(res);
            } else {
                container.innerHTML = `<div class="text-center text-red-400 p-8">${escapeHtml(res.error || 'Failed')}</div>`;
            }
        })
        .catch(err => {
            container.innerHTML = `<div class="duplicate-review-shell"><div class="health-review-error"><strong>Duplicate scan failed</strong><p>AXIOM could not finish the comparison. Nothing was moved and source audio stayed untouched.</p></div></div>`;
            document.getElementById('duplicates-review-ready-badge').textContent = 'Scan failed';
        })
        .finally(() => {
            setAxiomButtonBusy(btn, false);
            document.getElementById('dupes-strictness')?.removeAttribute('disabled');
        });
}
