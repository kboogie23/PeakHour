// Read-only owner results. The private receipt is served only by the task's
// isolated localhost review server, never by the packaged app.
(() => {
    'use strict';
    const params = new URLSearchParams(location.search);
    if (!['127.0.0.1', 'localhost'].includes(location.hostname)
        || params.get('review') !== 'health'
        || params.get('ui_preview') !== 'health-cleanup-owner') return;
    const esc = value => String(value ?? '').replace(/[&<>"']/g,
        char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    let results;
    const row = entry => `<article class="health-batch-example">
        <div><p>${esc(entry.before.artist)}</p><strong>${esc(entry.before.title)}</strong></div>
        <img src="/static/icons/arrow-right.svg" alt="" aria-hidden="true">
        <div><p>${esc(entry.after.artist)}</p><strong>${esc(entry.after.title)}</strong></div>
    </article>`;
    const matches = query => results.entries.filter(entry =>
        `${entry.before.artist} ${entry.before.title} ${entry.after.artist} ${entry.after.title}`
            .toLowerCase().includes(query.toLowerCase())).map(row).join('')
        || '<p class="health-batch-empty">No songs match this search.</p>';
    const root = () => document.getElementById('health-review-container');
    function render(showAll = false) {
        const receipt = results.receipt;
        const examples = [3, 4, 5, 13].map(index => results.entries.find(entry => entry.index === index)).filter(Boolean);
        root().innerHTML = `<section class="health-batch-shell">
            <div class="health-batch-context"><span>YOUR AXIOM LIBRARY · VERIFIED SAVED RESULTS</span></div>
            <article class="health-batch-card">
                <h3>${showAll ? 'Your corrected songs' : `${receipt.corrected} songs corrected`}</h3>
                <p class="health-batch-explanation">${receipt.problem_list} suggestions checked against your actual tracks. ${receipt.rejected_invalid_suggestions} incorrect suggestion rejected.</p>
                ${showAll ? '<label class="health-batch-search">Find a song<input type="search" placeholder="Search your artist or title" oninput="healthOwnerReview.search(this.value)"></label>' : ''}
                <div class="health-batch-columns"><span>BEFORE</span><span>SAVED IN AXIOM</span></div>
                <div ${showAll ? 'id="health-owner-matches" class="health-batch-matches"' : ''}>${showAll ? matches('') : examples.map(row).join('')}</div>
                <p class="health-batch-explanation" style="margin-top:18px">Full version wording preserved, including Epic Live Intro Edit and Epic Open Show. Each song keeps its own identity.</p>
                <footer class="health-batch-simple-actions"><button class="primary" onclick="healthOwnerReview.${showAll ? 'summary' : 'all'}()">${showAll ? 'Back to results' : `See all ${receipt.corrected} changes`}</button></footer>
            </article>
            <div class="health-batch-possibility"><strong>No Title Cleanup suggestions remain.</strong><p>Rechecked the installed AXIOM after saving. “DJ Owe Opener” was left unchanged because its suggested correction was invalid.</p></div>
            <p class="health-batch-safety">${receipt.checked.toLocaleString()} library tracks preserved. All ${receipt.source_files_sha256_unchanged} music files passed before/after SHA-256 checks. Corrections are in AXIOM’s cache; file tags are unchanged. Full cache and rules backups saved.</p>
        </section>`;
    }
    window.healthOwnerReview = {
        all() { render(true); }, summary() { render(false); },
        search(value) { document.getElementById('health-owner-matches').innerHTML = matches(value); },
    };
    window.mountHealthCleanupOwnerReview = async () => {
        const link = document.createElement('link'); link.rel = 'stylesheet';
        link.href = '/static/css/surfaces/health/cleanup-batch-preview.css?v=20261009-3';
        document.head.appendChild(link);
        document.body.classList.add('health-cleanup-batch-preview');
        document.getElementById('music-intake-overlay')?.remove();
        document.getElementById('axiom-arrival-overlay')?.remove();
        document.getElementById('master-hud')?.classList.remove('active');
        showTab('health-review');
        document.getElementById('health-review-title').textContent = 'Title Cleanup';
        document.getElementById('health-review-copy').textContent = 'Your real songs. Your verified corrections.';
        document.getElementById('health-review-ready-badge').classList.add('hidden');
        document.getElementById('health-metadata-rules-button').classList.add('hidden');
        root().textContent = 'Loading your verified results…';
        try {
            const response = await fetch('/api/review/owner-title-cleanup?review=health&ui_preview=health-cleanup-owner', {cache:'no-store'});
            if (!response.ok) throw new Error('Verified owner results are unavailable on this server.');
            results = await response.json();
            if (!results.receipt?.verified || results.entries.length !== results.receipt.corrected)
                throw new Error('The correction receipt could not be verified.');
            libraryHasTracks = true;
            // The isolated server's guest bootstrap can finish after the
            // receipt. This read-only review displays the verified owner count.
            const renderCount = updateLibraryCount;
            updateLibraryCount = () => renderCount(results.receipt.checked);
            updateLibraryCount(results.receipt.checked);
            render();
        } catch (error) {
            root().textContent = error.message;
        }
    };
})();
