// The theme before the first paint (docs/approach-specification.md, section 9.3; css/tokens.css). A classic script in <head>, before the
// styles. The site is light for everyone, whatever the system prefers; the visitor's choice of the dark theme (the switch in the header or
// the footer, localStorage bns.theme = 'dark') goes on html[data-theme]. It also sets the colour of the browser bar and the colour scheme
// of the page. js/shell.js writes the choice; the build keeps this script in every page the server draws (apps/web/app/root.tsx).
(function () {
  var t = null;
  try { t = localStorage.getItem('bns.theme'); } catch (e) { /* storage blocked: the light theme */ }
  if (t !== 'dark') return;
  document.documentElement.setAttribute('data-theme', 'dark');
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', '#14120F');
  var c = document.querySelector('meta[name="color-scheme"]');
  if (c) c.setAttribute('content', 'dark');
})();
