/* April Gate — theme.js
   Loaded synchronously in <head> so the theme is set before first paint.
   Precedence: saved choice  >  page default (data-theme-default)  >  OS preference.
   Note: persistence uses localStorage, which works on the real site but is
   blocked inside the in-chat artifact sandbox (so a preview won't remember). */
(function () {
  var KEY = 'ag-theme';
  var root = document.documentElement;

  function osPrefersLight() {
    try { return window.matchMedia('(prefers-color-scheme: light)').matches; }
    catch (e) { return false; }
  }
  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function apply(t) { root.setAttribute('data-theme', t === 'light' ? 'light' : 'dark'); }

  // ----- initial theme, applied immediately (pre-paint) -----
  var initial = saved();
  if (!initial) {
    initial = root.getAttribute('data-theme-default') || (osPrefersLight() ? 'light' : 'dark');
  }
  apply(initial);

  // ----- public toggle -----
  window.toggleTheme = function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    updateButtons();
  };

  function updateButtons() {
    var light = root.getAttribute('data-theme') === 'light';
    var btns = document.querySelectorAll('.theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = light ? '\u263E' : '\u2600';   /* ☾ moon : ☀ sun */
      btns[i].setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
      btns[i].setAttribute('title', light ? 'Switch to dark theme' : 'Switch to light theme');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateButtons);
  } else {
    updateButtons();
  }
})();
