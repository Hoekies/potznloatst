import { initializeApp } from './modules/init.js';
import { submitAuth } from './modules/auth.js';

window.__submitAuth = submitAuth;
try {
  initializeApp();
} catch (err) {
  console.error('initializeApp mislukt:', err);
}

// Directe binding voor de login-overlay — buiten initializeApp zodat een
// crash daarin de form-binding niet blokkeert.
const overlayForm = document.getElementById('login-overlay-form');
const overlayEye  = document.getElementById('login-overlay-eye');
const overlayPw   = document.getElementById('auth-password');

if (overlayForm) {
  overlayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = document.getElementById('auth-sign-in');
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Inloggen…'; }
    try {
      await submitAuth();
    } finally {
      const overlay = document.getElementById('login-overlay');
      if (overlay && !overlay.hidden) {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
      }
    }
  });
}

if (overlayEye && overlayPw) {
  overlayEye.addEventListener('click', () => {
    const show = overlayPw.type === 'password';
    overlayPw.type = show ? 'text' : 'password';
    overlayEye.textContent = show ? '\u{1F648}' : '\u{1F441}';
    overlayEye.setAttribute('aria-label', show ? 'Wachtwoord verbergen' : 'Wachtwoord tonen');
  });
}
