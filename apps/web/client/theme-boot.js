// The theme before the first paint (docs/approach-specification.md, section 9.3; css/tokens.css). A classic script in <head>, before the
// styles: the visitor's choice from the footer (localStorage bns.theme: light or dark) goes on html[data-theme]; without one the system
// decides (prefers-color-scheme). It also sets the colour of the browser bar. js/shell.js writes the choice; the build keeps this script
// in every page the server draws (apps/web/app/root.tsx).
(function () {
  var t = null;
  try { t = localStorage.getItem('bns.theme'); } catch (e) { /* storage blocked: the system decides */ }
  var d = document.documentElement;
  if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  var dark = t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', dark ? '#14120F' : '#FDFAF4');
})();
