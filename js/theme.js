// js/theme.js — theme toggle: System / Dark / Light (cycles on click)
const THEMES = ['system', 'dark', 'light'];
const ICONS  = { system: '⬤', dark: '🌙', light: '☀' };
const LABELS = { system: 'System theme', dark: 'Dark theme',  light: 'Light theme' };
const NEXT_LABEL = {
  system: 'Switch to dark theme',
  dark:   'Switch to light theme',
  light:  'Switch to system theme',
};

function storedPref() {
  try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; }
}

function savePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', pref);
  } catch (e) {}
}

function applyPref(pref) {
  const root = document.documentElement;
  const isDark =
    pref === 'dark' ||
    (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

export function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const mq = matchMedia('(prefers-color-scheme: dark)');

  function updateBtn(pref) {
    btn.textContent = ICONS[pref];
    btn.setAttribute('aria-label', LABELS[pref]);
    btn.title = NEXT_LABEL[pref];
  }

  function setPref(pref) {
    savePref(pref);
    applyPref(pref);
    updateBtn(pref);
  }

  // Keep system mode in sync when OS preference changes
  mq.addEventListener('change', () => {
    if (storedPref() === 'system') applyPref('system');
  });

  btn.addEventListener('click', () => {
    const current = storedPref();
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    setPref(next);
  });

  // Initialise button state (makes it visible)
  updateBtn(storedPref());
  btn.style.visibility = '';
}
