// Local UI concept only. State is disposable and no cleanup APIs are called.
(() => {
    'use strict';
    const allowed = () => ['127.0.0.1', 'localhost'].includes(location.hostname)
        && new URLSearchParams(location.search).get('review') === 'health'
        && new URLSearchParams(location.search).get('ui_preview') === 'health-cleanup-batch';
    if (!allowed()) return;
    const originals = [
        ['Whitney Houston', 'Dance With Somebody', 'Clean'],
        ['Burna Boy', 'Last Last', ''],
        ['Story of the Year', 'Until the Day I Die', 'Clean'],
    ];
    const tracks = Array.from({length: 150}, (_, index) => {
        const [artist, title, rating] = originals[index] || [`Demo Artist ${index + 1}`, `Example Track ${index + 1}`, index % 2 ? 'Clean' : ''];
        const versions = index < 90 ? '(Intro) (Epic intro)' : index < 120 ? (index % 2 ? '(Intro) (Intro)' : '(Intro Intro)') : '(Epic)';
        return {artist, title, rating, originalArtist: `(Dj owe) ${artist}`,
            originalTitle: `${title} ${versions}${rating ? ` (${rating})` : ''}`};
    });
    const state = {stage: 'write', filter: '', excluded: new Set(), plan: null, error: '', approvePossible: false,
        correctedArtist: 'Whitney Houston', correctedTitle: 'Dance With Somebody (Epic Intro) (Clean)'};
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const key = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();
    const splitTitle = title => {
        const tags = [];
        const base = title.replace(/[([{]([^()[\]{}]+)[)\]}]/g, (_, tag) => {tags.push(tag.trim()); return '';}).replace(/\s+/g, ' ').trim();
        return {base, tags};
    };
    function buildPlan(artist, title) {
        const original = splitTitle(tracks[0].originalTitle), corrected = splitTitle(title);
        if (key(original.base) !== key(corrected.base)) return {error: 'Keep this song name and change its version wording to find a shared cleanup. A different song name cannot be copied to other songs.'};
        const known = new Map(corrected.tags.map(tag => [key(tag), tag]));
        const removed = original.tags.filter(tag => !known.has(key(tag)));
        if (removed.some(tag => key(tag) !== 'intro')) return {error: 'That removes version information beyond repeated Intro. This mockup keeps those songs for review.'};
        const introVersion = corrected.tags.find(tag => key(tag) !== 'intro' && /\bintro\b/i.test(tag));
        const artistPrefix = tracks[0].originalArtist.slice(0, tracks[0].originalArtist.length - tracks[0].artist.length);
        const stripCredit = key(artist) === key(tracks[0].artist);
        if (!stripCredit && key(artist) !== key(tracks[0].originalArtist)) return {error: 'Change the DJ credit while keeping the song artist. A replacement artist cannot be copied to other songs.'};
        const support = introVersion ? tracks.filter(track => splitTitle(track.originalTitle).tags.some(tag => key(tag) === key(introVersion))).length : 0;
        const ambiguous = introVersion && key(introVersion) === 'epic intro' ? 'epic' : '';
        const entries = tracks.map((track,index) => {
            const parsed = splitTitle(track.originalTitle);
            const possible = Boolean(ambiguous && parsed.tags.some(tag => key(tag) === ambiguous));
            const seen = new Set();
            let tags = parsed.tags.map(tag => tag.replace(/\bintro(?:\s+intro)+\b/ig, 'Intro'))
                .filter(tag => {const normalized = key(tag); if (normalized === 'intro' && seen.has(normalized)) return false; seen.add(normalized); return true;});
            if (tags.some(tag => key(tag) !== 'intro' && /\bintro\b/i.test(tag))) tags = tags.filter(tag => key(tag) !== 'intro');
            tags = tags.map(tag => known.get(key(tag)) || (key(tag) === 'intro' ? 'Intro' : tag));
            if (possible && state.approvePossible) tags = tags.map(tag => key(tag) === ambiguous ? introVersion : tag);
            // Content labels remain attached to their own song, after version notes.
            const content = tags.filter(tag => /^(clean|dirty|explicit)$/i.test(tag));
            tags = tags.filter(tag => !/^(clean|dirty|explicit)$/i.test(tag)).concat(content);
            const nextArtist = stripCredit && track.originalArtist.startsWith(artistPrefix) ? track.originalArtist.slice(artistPrefix.length) : track.originalArtist;
            return {index, track, possible, artist: nextArtist, title: `${parsed.base}${tags.map(tag => ` (${tag})`).join('')}`};
        });
        return {entries, support, introVersion, stripCredit, possibleCount: entries.filter(entry => entry.possible).length};
    }
    const included = () => state.plan?.entries.filter(entry => (!entry.possible || state.approvePossible) && !state.excluded.has(entry.index)) || [];
    const selected = () => included().length;
    const proposal = track => state.plan.entries.find(entry => entry.track === track);
    const example = (track, index, selectable = false) => {
        const after = proposal(track);
        return `<article class="health-batch-example${selectable ? ' selectable' : ''}">${selectable ? `<input type="checkbox" aria-label="Include ${esc(track.title)}" ${state.excluded.has(index) ? '' : 'checked'} onchange="healthBatchPreview.toggle(${index},this.checked)">` : ''}
            <div><span class="health-batch-label">BEFORE</span><p>${esc(track.originalArtist)}</p><strong>${esc(track.originalTitle)}</strong></div>
            <img src="/static/icons/arrow-right.svg" alt="" aria-hidden="true">
            <div><span class="health-batch-label health-batch-positive">AFTER</span><p>${esc(after.artist)}</p><strong>${esc(after.title)}</strong></div></article>`;
    };
    function render() {
        if (!allowed()) return;
        const root = document.getElementById('health-review-container');
        root.innerHTML = `<section class="health-batch-shell">
            <div class="health-batch-context"><span>INTERACTIVE MOCKUP · SAMPLE TRACKS</span></div>
            ${state.stage === 'write' ? correction() : state.stage === 'done' ? completion() : state.stage === 'review' ? uncertain() : group()}
            <p class="health-batch-safety">Sample preview only. Your library and music files are untouched.</p>
        </section>`;
        root.scrollTop = 0;
    }
    function correction() {
        return `<article class="health-batch-card"><h3>Write it the way you want it</h3><p class="health-batch-explanation">AXIOM will use your correction to find the same problems in other songs.</p>
            <div class="health-batch-original"><span class="health-batch-label">CURRENT</span><p>${esc(tracks[0].originalArtist)}</p><strong>${esc(tracks[0].originalTitle)}</strong></div>
            <form class="health-batch-teach" onsubmit="healthBatchPreview.learn(event)"><label>Correct artist<input name="artist" value="${esc(state.correctedArtist)}" required maxlength="180"></label><label>Correct title<input name="title" value="${esc(state.correctedTitle)}" required maxlength="300"></label>
            ${state.error ? `<p role="alert" class="health-batch-error">${esc(state.error)}</p>` : ''}<button class="primary" type="submit">Find similar fixes</button></form></article>`;
    }
    function group() {
        const previewing = state.stage === 'preview';
        const after = proposal(tracks[0]);
        return `<article class="health-batch-card">
            <header class="health-batch-card-head"><div><h3>${previewing ? 'Songs included in this cleanup' : `${selected()} songs can use your correction`}</h3><p>${previewing ? 'Uncheck any song you want to leave alone.' : `Remove repeated Intro. Keep the full version wording.${state.plan.stripCredit ? ' Remove only the matching DJ credit.' : ''}`}</p></div></header>
            ${previewing ? `<label class="health-batch-search">Find a song<input type="search" placeholder="Search title or artist" value="${esc(state.filter)}" oninput="healthBatchPreview.search(this.value)"></label><div class="health-batch-columns"><span>BEFORE</span><span>AFTER</span></div><div id="health-batch-matches" class="health-batch-matches">${matches()}</div>` : `<div class="health-batch-simple-example"><section><span>BEFORE</span><p>${esc(tracks[0].originalArtist)}</p><strong>${esc(tracks[0].originalTitle)}</strong></section><section class="health-batch-result"><span>AFTER</span><p>${esc(after.artist)}</p><strong>${esc(after.title)}</strong></section></div>`}
            <p class="health-batch-explanation">Only songs with the same issue are included. Each keeps its own artist and title.</p>
            <footer class="health-batch-simple-actions"><button class="primary" type="button" ${selected() ? '' : 'disabled'} onclick="healthBatchPreview.apply()">Apply ${selected()} fixes</button><div><button class="health-batch-text-button" type="button" onclick="healthBatchPreview.${previewing ? 'back' : 'preview'}()">${previewing ? 'Back to example' : 'See matching songs'}</button><button class="health-batch-text-button" type="button" onclick="healthBatchPreview.edit()">Edit my correction</button></div></footer>
        </article>${state.plan.possibleCount && !state.approvePossible ? `<div class="health-batch-possibility"><strong>${state.plan.possibleCount} more songs say “Epic”. Did they mean “Epic Intro”?</strong><p>${state.plan.support} sample titles already use “Epic Intro”. These ${state.plan.possibleCount} stay unchanged until you choose.</p><button class="health-batch-text-button" type="button" onclick="healthBatchPreview.review()">Check these possible fixes</button></div>` : ''}<p class="health-batch-safety">6 other unclear songs are left alone.</p>`;
    }
    function matches() {
        const query = state.filter.trim().toLowerCase();
        const result = state.plan.entries.filter(entry => !entry.possible || state.approvePossible).filter(({track}) => `${track.artist} ${track.title}`.toLowerCase().includes(query));
        return result.length ? result.map(({track,index}) => example(track,index,true)).join('') : '<p class="health-batch-empty">No matching tracks. Try another title or artist.</p>';
    }
    function completion() {
        return `<article class="health-batch-card health-batch-complete"><img src="/static/icons/check-circle.svg" alt="" aria-hidden="true"><h3>${selected()} songs cleaned up</h3><p>${156 - selected()} songs left unchanged.</p><p>The original titles are kept so you can undo.</p><div><button type="button" onclick="healthBatchPreview.undo()">Undo cleanup</button><button class="health-batch-text-button" type="button" onclick="healthBatchPreview.edit()">Try another correction</button></div></article>`;
    }
    function uncertain() {
        const entries = state.plan.entries.filter(entry => entry.possible).slice(0,3);
        return `<article class="health-batch-card"><h3>Does “Epic” mean “Epic Intro” here?</h3><p class="health-batch-explanation">${state.plan.support} sample titles use the full wording. These ${state.plan.possibleCount} may have lost “Intro”.</p><div class="health-batch-columns"><span>CURRENT</span><span>POSSIBLE FIX</span></div>${entries.map(entry => `<article class="health-batch-example"><div><p>${esc(entry.track.artist)}</p><strong>${esc(entry.track.originalTitle)}</strong></div><img src="/static/icons/arrow-right.svg" alt="" aria-hidden="true"><div><p>${esc(entry.artist)}</p><strong>${esc(entry.title.replace(/\(Epic\)/i, '(Epic Intro)'))}</strong></div></article>`).join('')}<footer class="health-batch-simple-actions"><button class="primary" type="button" onclick="healthBatchPreview.approve()">Yes, include these ${state.plan.possibleCount} fixes</button><div><button class="health-batch-text-button" type="button" onclick="healthBatchPreview.back()">Leave them unchanged</button></div></footer></article>`;
    }
    window.healthBatchPreview = {
        edit() {state.stage = 'write'; render();},
        learn(event) {event.preventDefault(); const data = new FormData(event.currentTarget); state.correctedArtist = String(data.get('artist')).trim(); state.correctedTitle = String(data.get('title')).trim(); state.approvePossible = false; state.excluded.clear(); const plan = buildPlan(state.correctedArtist,state.correctedTitle); state.error = plan.error || ''; if (!plan.error) {state.plan = plan; state.stage = 'group';} render();},
        preview() {state.stage = 'preview'; render();},
        back() {state.stage = 'group'; state.filter = ''; render();},
        apply() {if (!selected()) return; state.stage = 'done'; render();},
        undo() {state.stage = 'group'; render();},
        review() {state.stage = 'review'; render();},
        approve() {state.approvePossible = true; state.plan = buildPlan(state.correctedArtist,state.correctedTitle); state.stage = 'group'; render();},
        search(value) {state.filter = value; document.getElementById('health-batch-matches').innerHTML = matches();},
        toggle(index, included) {included ? state.excluded.delete(index) : state.excluded.add(index); const scroll = document.getElementById('health-batch-matches').scrollTop; render(); document.getElementById('health-batch-matches').scrollTop = scroll;},
    };
    window.mountHealthCleanupBatchPreview = () => {
        if (!allowed()) return;
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/static/css/surfaces/health/cleanup-batch-preview.css?v=20261009-3'; document.head.appendChild(link);
        document.body.classList.add('health-cleanup-batch-preview');
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        libraryHasTracks = true;
        updateLibraryCount(156);
        showTab('health-review');
        document.getElementById('health-review-title').textContent = 'Title Cleanup';
        document.getElementById('health-review-copy').textContent = 'Correct one song. AXIOM finds the same fixes for others.';
        document.getElementById('health-review-ready-badge').classList.add('hidden');
        document.getElementById('health-metadata-rules-button').classList.add('hidden');
        render();
    };
})();
