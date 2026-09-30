/**
 * サイドメニュー（左からスライド）の開閉
 * index.html / main.html 共通で読み込む
 */
(function () {
  const btnOpen  = document.getElementById('btn-menu');
  const btnClose = document.getElementById('btn-drawer-close');
  const drawer   = document.getElementById('side-drawer');
  const overlay  = document.getElementById('drawer-overlay');
  if (!btnOpen || !drawer || !overlay) return;

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    btnOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
    if (btnClose) btnClose.focus();
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    btnOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('drawer-open');
    btnOpen.focus();
  }

  btnOpen.addEventListener('click', openDrawer);
  if (btnClose) btnClose.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });
})();
