// Classic (non-module) script in <head>: pins the saved theme before first paint, so there is no flash.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('bns.prefs.v1') || '{}');
    if (p.theme === 'light' || p.theme === 'dark') document.documentElement.setAttribute('data-theme', p.theme);
    if (p.sources === true) document.documentElement.setAttribute('data-sources', '1');
  } catch (e) { /* storage blocked: system theme */ }
})();
