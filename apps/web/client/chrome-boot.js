// Preserve taps while the module graph is still downloading. Anchors remain native.
document.addEventListener(
  'click',
  function (event) {
    if (window.__chromeReady) return;
    var button = event.target.closest('#btn-menu, #btn-search, #btn-period, .nav-main');
    if (!button) return;
    window.__chromeTap = button.id ? '#' + button.id : '[data-grp="' + button.dataset.grp + '"]';
  },
  true,
);
