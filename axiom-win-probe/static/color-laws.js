/**
 * COLOUR LAWS ENFORCEMENT SYSTEM
 * Runtime contrast checking and theme management for DJ App
 */

class ColourLawsEnforcer {
  constructor() {
    this.contrastThreshold = {
      text: 4.5,      // WCAG AA for normal text
      interactive: 3.0 // WCAG AA for interactive elements
    };
    this.currentTheme = this.detectTheme();
    this.debugMode = false;
    this.init();
  }

  init() {
    this.applyTheme(this.currentTheme);
    this.setupThemeToggle();
    this.setupContrastChecking();
    this.enforceLaws();
  }

  /**
   * LAW 1: Detect and enforce contrast ratios
   */
  calculateContrastRatio(color1, color2) {
    // Convert hex to RGB
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);

    if (!rgb1 || !rgb2) return 1;

    // Calculate relative luminance
    const lum1 = this.getRelativeLuminance(rgb1);
    const lum2 = this.getRelativeLuminance(rgb2);

    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);

    return (lighter + 0.05) / (darker + 0.05);
  }

  getRelativeLuminance(rgb) {
    const [r, g, b] = rgb.map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : null;
  }

  checkContrast(element) {
    const computedStyle = window.getComputedStyle(element);
    const textColor = computedStyle.color;
    const bgColor = this.getVisibleBackgroundColor(element);

    // Extract RGB from rgba/rgb strings
    const textRgb = this.extractRgb(textColor);
    const bgRgb = this.extractRgb(bgColor);

    if (!textRgb || !bgRgb) return true; // Skip if can't parse

    const contrast = this.calculateContrastRatio(
      this.rgbToHex(textRgb),
      this.rgbToHex(bgRgb)
    );

    const isText = element.tagName.match(/^(P|H[1-6]|SPAN|DIV|A|BUTTON)$/i);
    const threshold = isText ? this.contrastThreshold.text : this.contrastThreshold.interactive;

    return contrast >= threshold;
  }

  getVisibleBackgroundColor(element) {
    let current = element;
    while (current) {
      const bgColor = window.getComputedStyle(current).backgroundColor;
      const alpha = this.extractAlpha(bgColor);
      if (alpha > 0.15) return bgColor;
      current = current.parentElement;
    }
    return window.getComputedStyle(document.body).backgroundColor;
  }

  extractRgb(colorString) {
    const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return rgbMatch ? [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])] : null;
  }

  extractAlpha(colorString) {
    const rgbaMatch = colorString.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/);
    if (rgbaMatch) return parseFloat(rgbaMatch[1]);
    return colorString && colorString !== 'transparent' ? 1 : 0;
  }

  rgbToHex([r, g, b]) {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  }

  /**
   * LAW 2: Theme-specific palettes
   */
  detectTheme() {
    const savedTheme = localStorage.getItem('axiomTheme');
    localStorage.removeItem('theme');
    localStorage.removeItem('axiom-theme');
    return savedTheme === 'light' ? 'green' : 'indigo';
  }

  applyTheme(theme) {
    const isLight = theme === 'green' || theme === 'light' || theme === 'day';
    const resolvedTheme = isLight ? 'green' : 'indigo';

    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.classList.toggle('light-mode', isLight);
    document.body.classList.toggle('light-mode', isLight);
    localStorage.setItem('axiomTheme', isLight ? 'light' : 'dark');
    localStorage.removeItem('theme');
    localStorage.removeItem('axiom-theme');
    this.currentTheme = resolvedTheme;

    this.enforceThemeSpecificRules();
  }

  /**
   * LAW 3: No adjacent muted conflict
   */
  enforceThemeSpecificRules() {
    // Remove forbidden colors based on current theme
    const forbiddenElements = document.querySelectorAll(`[style*="${this.getForbiddenColor()}"]`);
    forbiddenElements.forEach(el => {
      if (this.currentTheme === 'indigo') {
        el.style.color = 'var(--accent-primary)'; // Replace green with gold
      } else {
        el.style.color = 'var(--accent-secondary)'; // Replace indigo with steel blue
      }
    });
  }

  getForbiddenColor() {
    return this.currentTheme === 'indigo' ? '#a3ff00' : '#4B0082';
  }

  /**
   * LAW 4: Day/Night mode logic mapping
   */
  setupThemeToggle() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn && !toggleBtn.hasAttribute('onclick')) {
      toggleBtn.addEventListener('click', () => {
        const nextTheme = document.body.classList.contains('light-mode') ? 'indigo' : 'green';
        this.applyTheme(nextTheme);
      });
    }

    // AXIOM's inline app toggle is the source of truth when present.
  }

  /**
   * LAW 5: Library vs Studio distinctiveness
   */
  setMode(mode) {
    document.body.classList.remove('library-mode', 'studio-mode');
    document.body.classList.add(`${mode}-mode`);
  }

  /**
   * LAW 6 & 7: Text color restrictions
   */
  enforceTextRestrictions() {
    // LAW 6: No black text on indigo
    if (this.currentTheme === 'indigo') {
      const blackTextElements = document.querySelectorAll('.text-black, .text-gray-900, .text-gray-800');
      blackTextElements.forEach(el => {
        if (this.shouldPreserveAccentText(el)) return;
        el.classList.add('text-theme-primary');
        el.classList.remove('text-black', 'text-gray-900', 'text-gray-800');
      });
    }

    // LAW 7: No white text on green
    if (this.currentTheme === 'green') {
      const whiteTextElements = document.querySelectorAll('.text-white, .text-gray-100');
      whiteTextElements.forEach(el => {
        if (this.shouldPreserveAccentText(el)) return;
        el.classList.add('text-theme-primary');
        el.classList.remove('text-white', 'text-gray-100');
      });
    }
  }

  shouldPreserveAccentText(element) {
    return Boolean(element.closest('.bg-axiom-accent, .bg-\\[\\#39FF14\\], .bg-\\[\\#ADFF2F\\], #btn-upload-csv'));
  }

  /**
   * LAW 8: Runtime contrast checking
   */
  setupContrastChecking() {
    if (this.debugMode) {
      document.body.classList.add('debug-contrast');
    }

    // Check contrast on all text elements
    const checkElements = () => {
      const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, button, input, textarea');
      textElements.forEach(el => {
        const hasGoodContrast = this.checkContrast(el);
        if (!hasGoodContrast && this.debugMode) {
          el.classList.add('low-contrast-warning');
        }
      });
    };

    // Check on load and when theme changes
    checkElements();
    // Also check periodically for dynamic content
    setInterval(checkElements, 2000);
  }

  /**
   * Master enforcement function
   */
  enforceLaws() {
    this.enforceTextRestrictions();
    this.enforceThemeSpecificRules();

    // Add contrast classes to all text elements
    const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span:not(.icon), div:not(.container)');
    textElements.forEach(el => {
      if (!el.classList.contains('text-primary-contrast') &&
          !el.classList.contains('text-secondary-contrast') &&
          !el.classList.contains('interactive-contrast')) {
        // Auto-assign based on element type
        if (el.tagName.match(/^(H[1-6]|BUTTON|A)$/)) {
          el.classList.add('interactive-contrast');
        } else if (el.classList.contains('text-muted') || el.classList.contains('text-gray')) {
          el.classList.add('text-secondary-contrast');
        } else {
          el.classList.add('text-primary-contrast');
        }
      }
    });
  }

  /**
   * Debug mode toggle
   */
  toggleDebugMode() {
    this.debugMode = !this.debugMode;
    document.body.classList.toggle('debug-contrast', this.debugMode);
    console.log(`Colour Laws Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}`);
  }

  /**
   * Get current theme colors for external use
   */
  getCurrentThemeColors() {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    return {
      bgPrimary: computedStyle.getPropertyValue('--bg-primary'),
      textPrimary: computedStyle.getPropertyValue('--text-primary'),
      accentPrimary: computedStyle.getPropertyValue('--accent-primary'),
      theme: this.currentTheme
    };
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.colourLaws = new ColourLawsEnforcer();

  // Add global debug function
  window.toggleColourDebug = () => window.colourLaws.toggleDebugMode();
});

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColourLawsEnforcer;
}
