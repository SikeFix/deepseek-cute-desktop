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
    .dsm-update-pill, .dsm-theme-pill, .dsm-model-pill {
      -webkit-app-region:no-drag; margin-left:8px; padding:5px 9px; border:0; border-radius:999px;
      color:inherit; background:rgba(255,244,223,.1); font:700 11px/1 system-ui; cursor:pointer;
    }
    .dsm-update-pill:hover, .dsm-theme-pill:hover, .dsm-model-pill:hover { background:rgba(85,216,194,.18); }
    .dsm-update-pill[data-state='downloading'] { color:#f5dc26; }
    .dsm-update-pill[data-state='ready'] { color:#55d8c2; animation:dsmUpdatePulse 1s ease-in-out infinite alternate; }
    .dsm-windows-control {
      width:48px; height:38px; border:0!important; border-radius:0!important; box-shadow:none!important;
      display:grid; place-items:center; color:inherit!important; background:transparent!important;
      font:600 16px/1 system-ui!important; cursor:pointer;
    }
    .dsm-windows-control:hover { background:rgba(85,216,194,.18)!important; transform:none!important; }
    .dsm-windows-control[data-action='close']:hover { background:#e85b4f!important; color:white!important; }
    .dsm-service-pill { top:48px!important; right:16px!important; }
    html[data-dsm-theme='official'] .dsm-windows-titlebar { color:#17213a; background:rgba(247,249,255,.94); border-bottom:1px solid #dce3f2; }
    html[data-dsm-theme='official'] .dsm-windows-brand::before { content:'🐋'; filter:none; }
    html[data-dsm-theme='official'] .dsm-update-pill,
    html[data-dsm-theme='official'] .dsm-theme-pill,
    html[data-dsm-theme='official'] .dsm-model-pill { background:#edf2ff; color:#3157a5; }
    @keyframes dsmUpdatePulse { to { box-shadow:0 0 15px rgba(85,216,194,.55); } }
  `;
  document.documentElement.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'dsm-windows-titlebar';
  bar.innerHTML = `
    <span class="dsm-windows-brand">DeepSeek <button class="dsm-theme-pill" title="切换官方/正太主题">正太主题</button><button class="dsm-model-pill" title="选择 DeepSeek 官方或本地千问">模型设置</button><button class="dsm-update-pill" data-state="idle" title="点击检查更新">检查更新</button></span>
    <span class="dsm-windows-controls">
      <button class="dsm-windows-control" data-action="minimize" title="最小化">—</button>
      <button class="dsm-windows-control" data-action="maximize" title="最大化">□</button>
      <button class="dsm-windows-control" data-action="close" title="隐藏窗口">×</button>
    </span>`;
  bar.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.classList.contains('dsm-update-pill')) window.deepseekDesktop?.checkForUpdates();
      else if (button.classList.contains('dsm-theme-pill')) {
        const next = document.documentElement.dataset.dsmTheme === 'official' ? 'cute' : 'official';
        window.deepseekDesktop?.setTheme(next);
      }
      else if (button.classList.contains('dsm-model-pill')) window.deepseekDesktop?.openModelSettings();
      else window.deepseekDesktop?.windowAction(button.dataset.action);
    });
  });
  bar.addEventListener('dblclick', (event) => {
    if (!event.target.closest('button')) window.deepseekDesktop?.windowAction('maximize');
  });
  document.body.appendChild(bar);

  const updatePill = bar.querySelector('.dsm-update-pill');
  const themePill = bar.querySelector('.dsm-theme-pill');
  window.__dsmWindowsThemeChanged = (mode) => {
    document.documentElement.dataset.dsmTheme = mode;
    themePill.textContent = mode === 'official' ? '官方样式' : '正太主题';
    themePill.title = mode === 'official' ? '当前为官方样式，点击切换正太主题' : '当前为正太主题，点击切换官方样式';
  };
  window.deepseekDesktop?.getTheme?.().then(window.__dsmWindowsThemeChanged).catch(() => {});
  const renderUpdateStatus = (status = {}) => {
    updatePill.dataset.state = status.state || 'idle';
    if (status.state === 'downloading') updatePill.textContent = `更新 ${status.percent || 0}%`;
    else if (status.state === 'ready') updatePill.textContent = '重启更新';
    else if (status.state === 'checking') updatePill.textContent = '检查中…';
    else if (status.state === 'error') updatePill.textContent = '更新重试';
    else updatePill.textContent = status.message || '检查更新';
    updatePill.title = status.message || '点击检查 GitHub 更新';
  };
  window.deepseekDesktop?.onUpdateStatus?.(renderUpdateStatus);
  window.deepseekDesktop?.getStatus?.().then(({ update }) => renderUpdateStatus(update)).catch(() => {});
})();
