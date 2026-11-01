(function () {
  'use strict';

  document.documentElement.dataset.axiomCtaTypographyScript = 'loaded';

  const CTA_SELECTOR = 'button, input[type="button"], input[type="submit"], input[type="reset"]';
  const CTA_FONT_STACK = "'Bebas Neue', Impact, sans-serif";
  const baselineInlineStyles = new WeakMap();
  let observer = null;
  let reconciliationScheduled = false;
  const EXCLUDED_CTA_SURFACE_SELECTOR = [
    '#library-matching-rail',
    '.transition-preview-controls',
    '.studio-daw-context-menu'
  ].join(', ');
  const EXCLUDED_CTA_BUTTON_SELECTOR = [
    '[role="tab"]',
    '[role="radio"]',
    '[role="menuitem"]',
    '[data-axiom-cta-skip="true"]',
    '[role="switch"]',
    '[aria-pressed]',
    '[id^="tab-btn-"]',
    '.axiom-sidebar-nav-item',
    '.settings-toggle',
    '.settings-tab',
    '.refresh-icon-btn',
    '.fav-star-btn',
    '.studio-remove-btn',
    '.anchor-suggestion-play',
    '.transition-play-btn',
    '[class*="icon"]',
    '[class*="toggle"]',
    '[class*="chip"]',
    '[class*="pill"]',
    '[class*="close"]',
    '[class*="transport"]',
    '[class*="filter"]',
    '[class*="sort"]',
    '[class*="counter"]',
    '[class*="menu"]',
    '[class*="stepper"]'
  ].join(', ');

  function labelFor(button) {
    if (button instanceof HTMLInputElement) return String(button.value || '').trim();
    return String(button.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hasReadableLabel(button) {
    return /[A-Za-z0-9]/.test(labelFor(button));
  }

  function isExcludedCta(button) {
    return Boolean(button.closest(EXCLUDED_CTA_SURFACE_SELECTOR))
      || button.matches(EXCLUDED_CTA_BUTTON_SELECTOR);
  }

  function isCtaButton(button) {
    return button instanceof HTMLElement
      && button.matches(CTA_SELECTOR)
      && hasReadableLabel(button)
      && !isExcludedCta(button);
  }

  function rememberBaselineInlineStyles(button) {
    if (baselineInlineStyles.has(button)) return;
    baselineInlineStyles.set(button, {
      family: button.style.getPropertyValue('font-family'),
      familyPriority: button.style.getPropertyPriority('font-family'),
      size: button.style.getPropertyValue('font-size'),
      sizePriority: button.style.getPropertyPriority('font-size'),
      variable: button.style.getPropertyValue('--axiom-cta-upgraded-font-size'),
      variablePriority: button.style.getPropertyPriority('--axiom-cta-upgraded-font-size')
    });
  }

  function restoreInlineProperty(button, property, value, priority) {
    if (value) button.style.setProperty(property, value, priority || '');
    else button.style.removeProperty(property);
  }

  function restoreBaselinePresentation(button) {
    const baseline = baselineInlineStyles.get(button);
    button.classList.remove('axiom-cta-type-upgraded');
    if (!baseline) return;
    restoreInlineProperty(button, 'font-family', baseline.family, baseline.familyPriority);
    restoreInlineProperty(button, 'font-size', baseline.size, baseline.sizePriority);
    restoreInlineProperty(button, '--axiom-cta-upgraded-font-size', baseline.variable, baseline.variablePriority);
  }

  function clearTypographyState(button) {
    delete button.dataset.axiomCtaTypography;
    delete button.dataset.axiomCtaOriginalFontFamily;
    delete button.dataset.axiomCtaOriginalFontSize;
  }

  function reconcileCtaButton(button) {
    if (button.dataset.axiomCtaTypography === 'upgraded' && isCtaButton(button)) {
      const originalSize = Number.parseFloat(button.dataset.axiomCtaOriginalFontSize);
      if (Number.isFinite(originalSize) && originalSize > 0) {
        const upgradedSize = Number((originalSize + 3).toFixed(3));
        button.classList.add('axiom-cta-type-upgraded');
        button.style.setProperty('--axiom-cta-upgraded-font-size', `${upgradedSize}px`);
        button.style.setProperty('font-family', CTA_FONT_STACK, 'important');
        button.style.setProperty('font-size', `${upgradedSize}px`, 'important');
        return true;
      }
    }
    if (button.dataset.axiomCtaTypography === 'upgraded') restoreBaselinePresentation(button);
    clearTypographyState(button);
    if (!isCtaButton(button)) return false;

    const computed = window.getComputedStyle(button);
    const originalFamily = String(computed.fontFamily || '');
    const originalSize = Number.parseFloat(computed.fontSize);

    if (originalFamily.toLowerCase().includes('bebas')) {
      button.dataset.axiomCtaTypography = 'preserved-bebas';
      return false;
    }
    if (!Number.isFinite(originalSize) || originalSize <= 0) return false;

    const upgradedSize = Number((originalSize + 3).toFixed(3));
    rememberBaselineInlineStyles(button);
    button.dataset.axiomCtaOriginalFontFamily = originalFamily;
    button.dataset.axiomCtaOriginalFontSize = String(originalSize);
    button.dataset.axiomCtaTypography = 'upgraded';
    button.style.setProperty('--axiom-cta-upgraded-font-size', `${upgradedSize}px`);
    button.classList.add('axiom-cta-type-upgraded');
    button.style.setProperty('font-family', CTA_FONT_STACK, 'important');
    button.style.setProperty('font-size', `${upgradedSize}px`, 'important');
    return true;
  }

  function scanCtaButtons(root) {
    const candidates = [];
    if (root instanceof Element && root.matches(CTA_SELECTOR)) candidates.push(root);
    if (root && typeof root.querySelectorAll === 'function') {
      candidates.push(...root.querySelectorAll(CTA_SELECTOR));
    }
    candidates.forEach(reconcileCtaButton);
    return candidates.length;
  }

  function observeCtaChanges() {
    if (!observer) return;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-expanded', 'aria-pressed', 'data-library-brief-panel']
    });
  }

  function reconcileAllCtaButtons() {
    reconciliationScheduled = false;
    if (observer) observer.disconnect();
    scanCtaButtons(document);
    observeCtaChanges();
  }

  function scheduleCtaReconciliation() {
    if (reconciliationScheduled) return;
    reconciliationScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(reconcileAllCtaButtons));
  }

  function summary() {
    return {
      upgraded: document.querySelectorAll('[data-axiom-cta-typography="upgraded"]').length,
      preservedBebas: document.querySelectorAll('[data-axiom-cta-typography="preserved-bebas"]').length,
      libraryMatchingSongsUpgraded: document.querySelectorAll('#library-matching-rail [data-axiom-cta-typography="upgraded"]').length
    };
  }

  function start() {
    observer = new MutationObserver(scheduleCtaReconciliation);
    reconcileAllCtaButtons();
    window.__AXIOM_CTA_TYPOGRAPHY__.observer = observer;
  }

  function startSafely() {
    try {
      start();
      document.documentElement.dataset.axiomCtaTypographyScript = 'ready';
    } catch (error) {
      document.documentElement.dataset.axiomCtaTypographyError = String(error && error.message ? error.message : error);
      throw error;
    }
  }

  window.__AXIOM_CTA_TYPOGRAPHY__ = {
    version: '20260904-v1',
    isCtaButton,
    scan: scanCtaButtons,
    reconcile: reconcileAllCtaButtons,
    summary,
    observer: null
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      requestAnimationFrame(() => requestAnimationFrame(startSafely));
    }, { once: true });
  } else {
    requestAnimationFrame(() => requestAnimationFrame(startSafely));
  }
}());
