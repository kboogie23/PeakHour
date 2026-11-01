// Final runtime event wiring and native-shell readiness signal.
document.addEventListener('DOMContentLoaded', () => {
    const _rm = document.getElementById('rescan-report-modal');
    if (_rm) _rm.addEventListener('click', function(e) { if (e.target === this) closeRescanModal(); });
});

// Light mode compatibility for rescan button
const _origToggleTheme = typeof toggleTheme === 'function' ? toggleTheme : null;
document.addEventListener('DOMContentLoaded', () => {
    applyRescanBtnTheme();
});
function applyRescanBtnTheme() {
    const btn = document.getElementById('btn-rescan');
    if (!btn) return;
    const isLight = document.body.classList.contains('light-mode');
    btn.style.background = isLight ? '#fff' : '#000';
    btn.style.color = isLight ? '#0047AB' : 'var(--accent)';
    btn.style.borderColor = isLight ? '#0047AB' : 'var(--accent)';
}
const _rescanThemeObserver = new MutationObserver(() => applyRescanBtnTheme());
_rescanThemeObserver.observe(document.body, { attributeFilter: ['class'] });

function syncSidebarNavigationState(name = '') {
    const activeId = name ? `tab-btn-${name}` : '';
    const activeClasses = ['bg-gradient-to-r', 'from-axiom-accent/20', 'to-transparent', 'border-axiom-accent', 'text-axiom-accent'];
    const inactiveClasses = ['bg-transparent', 'border-transparent', 'text-white/40'];
    document.querySelectorAll('#axiom-sidebar .axiom-sidebar-nav-item').forEach(button => {
        const isActive = button.id === activeId;
        button.dataset.navState = isActive ? 'active' : 'inactive';
        activeClasses.forEach(className => button.classList.toggle(className, isActive));
        inactiveClasses.forEach(className => button.classList.toggle(className, !isActive));
    });
}

function closeSidebarDropdowns(except = '') {
    ['export', 'playlists'].forEach(name => {
        if (name === except) return;
        const menu = document.getElementById(`sidebar-${name}-menu`);
        const trigger = document.getElementById(name === 'export' ? 'tab-btn-export' : 'tab-btn-playlists');
        const counterTrigger = name === 'export' ? document.getElementById('sidebar-export-dropdown-btn') : null;
        const arrow = document.getElementById(`sidebar-${name}-arrow`);
        const group = document.getElementById(`sidebar-${name}-group`);
        menu?.classList.add('hidden');
        trigger?.setAttribute('aria-expanded', 'false');
        counterTrigger?.setAttribute('aria-expanded', 'false');
        group?.classList.remove('is-expanded');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
    });
    syncSidebarNavigationState(except || String(window.axiomVisibleTab || ''));
}

function toggleSidebarDropdown(event, name) {
    event?.stopPropagation();
    const menu = document.getElementById(`sidebar-${name}-menu`);
    const trigger = document.getElementById(name === 'export' ? 'tab-btn-export' : 'tab-btn-playlists');
    const counterTrigger = name === 'export' ? document.getElementById('sidebar-export-dropdown-btn') : null;
    const arrow = document.getElementById(`sidebar-${name}-arrow`);
    const group = document.getElementById(`sidebar-${name}-group`);
    if (!menu || !trigger) return;
    const opening = menu.classList.contains('hidden');
    closeSidebarDropdowns();
    closeExportDropdown();
    closeStudioMoreMenu();
    closeStudioToolsDropdown();
    if (!opening) return;
    if (name === 'export') syncSidebarNavigationState('export');
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    counterTrigger?.setAttribute('aria-expanded', 'true');
    group?.classList.add('is-expanded');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
}

function toggleStudioToolsDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('studio-tools-dropdown-menu');
    const arrow = document.getElementById('studio-tools-dropdown-arrow');
    const trigger = document.getElementById('studio-tools-dropdown-btn');
    const group = document.getElementById('studio-sidebar-tools-container');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeStudioToolsDropdown();
    closeExportDropdown();
    if (isHidden) {
        menu.classList.remove('hidden');
        group?.classList.add('is-expanded');
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
    }
}

function closeStudioToolsDropdown() {
    const menu = document.getElementById('studio-tools-dropdown-menu');
    const arrow = document.getElementById('studio-tools-dropdown-arrow');
    const trigger = document.getElementById('studio-tools-dropdown-btn');
    const group = document.getElementById('studio-sidebar-tools-container');
    if (menu) menu.classList.add('hidden');
    group?.classList.remove('is-expanded');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleExportDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('export-dropdown-menu');
    const arrow = document.getElementById('export-dropdown-arrow');
    const trigger = document.getElementById('export-dropdown-btn');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeExportDropdown();
    closeStudioMoreMenu();
    closeStudioToolsDropdown();

    if (isHidden) {
        menu.classList.remove('hidden');
        positionExportDropdown();
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
    }
}

function positionExportDropdown() {
    const menu = document.getElementById('export-dropdown-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.style.transform = '';
    const bounds = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const shift = bounds.left < 16 ? 16 - bounds.left
        : bounds.right > viewportWidth - 16 ? viewportWidth - 16 - bounds.right : 0;
    if (shift) menu.style.transform = `translateX(${shift}px)`;
}

window.addEventListener('resize', positionExportDropdown);

function closeExportDropdown() {
    const menu = document.getElementById('export-dropdown-menu');
    const arrow = document.getElementById('export-dropdown-arrow');
    const trigger = document.getElementById('export-dropdown-btn');
    if (menu) menu.classList.add('hidden');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleStudioMoreMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('studio-more-menu');
    const trigger = document.getElementById('studio-more-menu-btn');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeStudioMoreMenu();
    closeExportDropdown();
    closeStudioToolsDropdown();
    if (isHidden) {
        menu.classList.remove('hidden');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
    }
}

function closeStudioMoreMenu() {
    document.getElementById('studio-more-menu')?.classList.add('hidden');
    document.getElementById('studio-more-menu-btn')?.setAttribute('aria-expanded', 'false');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const sidebarExport = document.getElementById('sidebar-export-group');
    const sidebarPlaylists = document.getElementById('sidebar-playlists-group');
    if ((!sidebarExport || !sidebarExport.contains(event.target)) && (!sidebarPlaylists || !sidebarPlaylists.contains(event.target))) {
        closeSidebarDropdowns();
    }
    const container = document.getElementById('export-dropdown-container');
    if (container && !container.contains(event.target)) {
        closeExportDropdown();
    }
    const studioMore = document.getElementById('studio-more-menu-container');
    if (studioMore && !studioMore.contains(event.target)) {
        closeStudioMoreMenu();
    }
    const studioTools = document.getElementById('studio-sidebar-tools-container');
    if (studioTools && !studioTools.contains(event.target)) {
        closeStudioToolsDropdown();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key !== 'Escape') return;
    closeSidebarDropdowns();
    closeExportDropdown();
    closeStudioMoreMenu();
});

window.__AXIOM_BOOT_STAGE__ = 'cockpit-script-ready';
window.__AXIOM_UI_READY__ = true;
try {
    const nativeBridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.axiomNative;
    if (nativeBridge && nativeBridge.postMessage) {
        nativeBridge.postMessage({ action: 'clientReady', stage: window.__AXIOM_BOOT_STAGE__ });
    }
} catch (_) {}
