(() => {
  if (window.__dsmWindowsChrome) return;
  window.__dsmWindowsChrome = true;

  const style = document.createElement('style');
  style.textContent = `
    .dsm-windows-titlebar {
      position: fixed; inset: 0 0 auto 0; height: 38px; z-index: 2147483646;
      display: flex; align-items: center; justify-content: space-between;
      padding-left: 14px; color: var(--dsw-alias-label-primary, #fff4df);
      background: linear-gradient(180deg, rgba(29,25,26,.72), rgba(29,25,26,.08));
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      -webkit-app-region: drag; user-select: none; pointer-events: auto;
    }
    .dsm-windows-brand { display:flex; align-items:center; gap:8px; font:700 12px/1 system-ui; opacity:.86; }
    .dsm-windows-brand::before { content:'✦'; color:#55d8c2; font-size:15px; }
    .dsm-windows-controls { height:38px; display:flex; margin-left:auto; -webkit-app-region:no-drag; }
    .dsm-windows-control {
      width:48px; height:38px; border:0!important; border-radius:0!important; box-shadow:none!important;
      display:grid; place-items:center; color:inherit!important; background:transparent!important;
      font:600 16px/1 system-ui!important; cursor:pointer;
    }
    .dsm-windows-control:hover { background:rgba(85,216,194,.18)!important; transform:none!important; }
    .dsm-windows-control[data-action='close']:hover { background:#e85b4f!important; color:white!important; }
    .dsm-service-pill { top:48px!important; right:16px!important; }
  `;
  document.documentElement.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'dsm-windows-titlebar';
  bar.innerHTML = `
    <span class="dsm-windows-brand">DeepSeek Cute</span>
    <span class="dsm-windows-controls">
      <button class="dsm-windows-control" data-action="minimize" title="最小化">—</button>
      <button class="dsm-windows-control" data-action="maximize" title="最大化">□</button>
      <button class="dsm-windows-control" data-action="close" title="隐藏窗口">×</button>
    </span>`;
  bar.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => window.deepseekDesktop?.windowAction(button.dataset.action));
  });
  bar.addEventListener('dblclick', (event) => {
    if (!event.target.closest('button')) window.deepseekDesktop?.windowAction('maximize');
  });
  document.body.appendChild(bar);
})();
