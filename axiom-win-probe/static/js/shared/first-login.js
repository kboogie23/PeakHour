// AXIOM PRO first-launch account handoff. Credentials never enter browser storage.
(function () {
  'use strict';
  let mode = 'signin';
  let busy = false;
  const fixture = () => Boolean(axiomReviewMode() || axiomUiPreviewMode());
  const field = id => document.getElementById(id);

  function feedback(message, error = false) {
    const node = field('first-login-feedback');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function setFirstLoginPreviewMode(next = 'signin') {
    mode = next === 'signup' ? 'signup' : 'signin';
    const signup = mode === 'signup';
    field('first-login-title').textContent = signup ? 'Create account' : 'Welcome';
    field('first-login-copy').textContent = signup ? 'Start your AXIOM library' : 'Sign in to Axiom Pro';
    field('first-login-submit').textContent = signup ? 'Create Account' : 'Sign In';
    field('first-login-recovery').hidden = signup;
    field('first-login-switch-prompt').textContent = signup ? 'Already have an account?' : 'New here?';
    const switchButton = field('first-login-switch-button');
    switchButton.textContent = signup ? 'Sign In' : 'Create an account';
    switchButton.onclick = () => setFirstLoginPreviewMode(signup ? 'signin' : 'signup');
    field('first-login-password').autocomplete = signup ? 'new-password' : 'current-password';
    feedback('');
  }

  function showLogin(message = '') {
    document.documentElement.dataset.axiomLogin = 'required';
    field('first-login-preview')?.removeAttribute('hidden');
    document.getElementById('main-content-wrapper')?.setAttribute('inert', '');
    document.querySelector('.axiom-sidebar')?.setAttribute('inert', '');
    document.getElementById('license-modal')?.classList.remove('active');
    setFirstLoginPreviewMode('signin');
    if (message) feedback(message, true);
    field('first-login-email')?.focus({ preventScroll: true });
  }

  function releaseLogin(data) {
    field('first-login-preview')?.setAttribute('hidden', '');
    delete document.documentElement.dataset.axiomLogin;
    document.getElementById('main-content-wrapper')?.removeAttribute('inert');
    document.querySelector('.axiom-sidebar')?.removeAttribute('inert');
    field('first-login-password').value = '';
    if (data && typeof renderAxiomLicense === 'function') renderAxiomLicense(data);
    const pending = window.__axiomPendingRelease;
    window.__axiomPendingRelease = null;
    if (pending && typeof maybeShowAxiomReleaseSplash === 'function') maybeShowAxiomReleaseSplash(pending);
  }

  async function jsonRequest(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || 'Account request failed. Please try again.');
    return data;
  }

  async function submitFirstLogin() {
    if (busy) return;
    if (fixture()) { feedback('Local design review. Account actions are disabled here.'); return; }
    const email = field('first-login-email').value.trim();
    const password = field('first-login-password').value;
    if (!field('first-login-email').checkValidity()) { field('first-login-email').reportValidity(); return; }
    if (password.length < (mode === 'signup' ? 8 : 1)) {
      feedback(mode === 'signup' ? 'Use a password of at least 8 characters.' : 'Enter your password.', true);
      field('first-login-password').focus();
      return;
    }
    const button = field('first-login-submit');
    const submittedMode = mode;
    const switchButton = field('first-login-switch-button');
    busy = true;
    button.disabled = true;
    switchButton.disabled = true;
    button.textContent = mode === 'signup' ? 'Creating Account...' : 'Signing In...';
    feedback('');
    try {
      const data = submittedMode === 'signup'
        ? await jsonRequest('/api/account/email-action', { action: 'signup', email, password })
        : await jsonRequest('/api/account/login', {
            email, password,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            locale: navigator.language || ''
          });
      if (submittedMode === 'signup') {
        field('first-login-password').value = '';
        setFirstLoginPreviewMode('signin');
        feedback(data.message || 'Check your email to confirm your account, then sign in.');
      } else {
        updateSettings(data.email || email, true);
        releaseLogin(data);
      }
    } catch (error) {
      feedback(error.message || 'Account request failed. Please try again.', true);
    } finally {
      busy = false;
      button.disabled = false;
      switchButton.disabled = false;
      button.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    }
  }

  async function recoverFirstLogin() {
    if (busy) return;
    if (fixture()) { feedback('Local design review. Account actions are disabled here.'); return; }
    const emailField = field('first-login-email');
    if (!emailField.checkValidity()) { emailField.reportValidity(); return; }
    busy = true;
    feedback('Sending reset email...');
    try {
      const data = await jsonRequest('/api/account/email-action', { action: 'recovery', email: emailField.value.trim() });
      feedback(data.message || 'If this account exists, a reset link has been sent.');
    } catch (error) {
      feedback(error.message || 'Could not send a reset email.', true);
    } finally {
      busy = false;
    }
  }

  function updateSettings(email, signedIn) {
    const label = field('settings-account-email');
    if (label) label.textContent = signedIn ? `Signed in as ${email}` : 'Not signed in';
    const logout = field('settings-account-logout');
    if (logout) logout.hidden = !signedIn;
  }

  async function logoutAxiomAccount() {
    if (fixture() || !window.confirm('Sign out of AXIOM on this Mac? Your music and library remain untouched.')) return;
    try {
      const data = await jsonRequest('/api/account/logout', {});
      updateSettings('', false);
      showLogin();
      if (typeof renderAxiomLicense === 'function') renderAxiomLicense(data);
    } catch (error) {
      window.showToast?.(error.message || 'Sign out failed.', true);
    }
  }

  async function initialize() {
    field('first-login-password')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); submitFirstLogin(); }
    });
    if (fixture() || document.documentElement.dataset.axiomLogin !== 'checking') return;
    try {
      const response = await fetch('/api/account/status', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || 'Account status unavailable.');
      updateSettings(data.email, data.signed_in);
      if (data.login_required) showLogin();
      else releaseLogin();
    } catch (error) {
      showLogin('Could not check this Mac. Check your connection and sign in to continue.');
    }
  }

  window.setFirstLoginPreviewMode = setFirstLoginPreviewMode;
  window.submitFirstLogin = submitFirstLogin;
  window.recoverFirstLogin = recoverFirstLogin;
  window.logoutAxiomAccount = logoutAxiomAccount;
  document.addEventListener('DOMContentLoaded', initialize);
})();
