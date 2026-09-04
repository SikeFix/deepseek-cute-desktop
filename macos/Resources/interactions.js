(() => {
  if (window.__dsmInteractions) return;
  window.__dsmInteractions = true;

  const root = document.documentElement;
  let themeMode = window.__dsmThemeMode === 'official' ? 'official' : 'cute';
  root.dataset.dsmTheme = themeMode;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pointerFrame = 0;
  let scrollTimer = 0;
  let petBusy = false;
  let petInitialized = false;
  let petTaskTitle = '';
  let petTaskURL = '';
  let petStartedAt = 0;
  let clearSamples = 0;

  const pageTitle = () => document.title
    .replace(/\s*[—-]\s*DeepSeek Harness.*$/i, '')
    .trim() || '当前任务';

  const postNative = (name, message) => {
    try { window.webkit?.messageHandlers?.[name]?.postMessage(message); } catch (_) {}
  };

  const taskURL = () => location.href;
  const usefulTitle = (title) => title && !/^(当前任务|DeepSeek|新会话)$/i.test(title);

  const beginPetTask = (source = 'page') => {
    const currentTitle = pageTitle();
    if (!petBusy) {
      petBusy = true;
      petStartedAt = Date.now();
      petTaskURL = taskURL();
      petTaskTitle = currentTitle;
    } else if (usefulTitle(currentTitle)) {
      petTaskTitle = currentTitle;
    }
    clearSamples = 0;
    postNative('dsmPet', {
      event: 'busy',
      title: petTaskTitle || currentTitle,
      url: petTaskURL || taskURL(),
      startedAt: petStartedAt,
      source
    });
  };

  const completePetTask = () => {
    if (!petBusy) return;
    const currentTitle = pageTitle();
    const finishedAt = Date.now();
    if (usefulTitle(currentTitle)) petTaskTitle = currentTitle;
    postNative('dsmPet', {
      event: 'complete',
      title: petTaskTitle || currentTitle,
      url: petTaskURL || taskURL(),
      startedAt: petStartedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - petStartedAt)
    });
    petBusy = false;
    petStartedAt = 0;
    petTaskURL = '';
    clearSamples = 0;
  };

  const servicePill = document.createElement('button');
  servicePill.type = 'button';
  servicePill.className = 'dsm-service-pill';
  servicePill.dataset.state = 'starting';
  servicePill.innerHTML = '<span class="dsm-service-dot"></span><span class="dsm-service-label">正在启动</span>';
  servicePill.title = '本地 DeepSeek 服务状态';
  document.body.appendChild(servicePill);

  window.__dsmSetThemeMode = (mode) => {
    themeMode = mode === 'official' ? 'official' : 'cute';
    root.dataset.dsmTheme = themeMode;
    servicePill.style.display = themeMode === 'official' ? 'none' : '';
  };
  window.__dsmSetThemeMode(themeMode);

  window.__dsmSetServiceStatus = (status) => {
    const labels = { online: '已连接', starting: '正在启动', offline: '服务异常' };
    servicePill.dataset.state = status;
    servicePill.querySelector('.dsm-service-label').textContent = labels[status] || labels.offline;
    servicePill.title = status === 'online' ? 'DeepSeek 服务运行正常' : '点击尝试恢复本地服务';
    // 顶栏状态胶囊(app-chrome 层)接管展示, 同步状态
    if (window.__dsmSetTopStatus) window.__dsmSetTopStatus(status);
  };

  servicePill.addEventListener('click', () => {
    postNative('dsmService', servicePill.dataset.state === 'online' ? 'check' : 'recover');
  });

  const decorateButtons = (scope = document) => {
    if (themeMode === 'official') return;
    scope.querySelectorAll?.('button:not([data-dsm-interactive])').forEach((button) => {
      button.dataset.dsmInteractive = '';
    });
  };

  const updatePointer = (event) => {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      const x = Math.round(event.clientX / Math.max(window.innerWidth, 1) * 100);
      const y = Math.round(event.clientY / Math.max(window.innerHeight, 1) * 100);
      root.style.setProperty('--dsm-pointer-x', `${x}%`);
      root.style.setProperty('--dsm-pointer-y', `${y}%`);

      if (reducedMotion.matches || themeMode === 'official') return;
      const mascot = event.target.closest?.('[class$="_fishHitbox"], [data-slot="sidebar"] button[class*="_brand"]');
      if (!mascot) return;
      const rect = mascot.getBoundingClientRect();
      const tiltY = ((event.clientX - rect.left) / Math.max(rect.width, 1) - .5) * 8;
      const tiltX = -((event.clientY - rect.top) / Math.max(rect.height, 1) - .5) * 8;
      mascot.style.setProperty('--dsm-tilt-x', `${tiltX.toFixed(2)}deg`);
      mascot.style.setProperty('--dsm-tilt-y', `${tiltY.toFixed(2)}deg`);
    });
  };

  document.addEventListener('pointermove', updatePointer, { passive: true });
  document.addEventListener('pointerout', (event) => {
    const mascot = event.target.closest?.('[class$="_fishHitbox"], [data-slot="sidebar"] button[class*="_brand"]');
    if (!mascot || mascot.contains(event.relatedTarget)) return;
    mascot.style.removeProperty('--dsm-tilt-x');
    mascot.style.removeProperty('--dsm-tilt-y');
  }, { passive: true });

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-dsm-interactive]:not(:disabled)');
    if (!button) return;
    const label = button.getAttribute('aria-label') || '';
    if (/发送消息|send message/i.test(label)) {
      beginPetTask('send-button');
      if (!reducedMotion.matches) {
        const pop = document.createElement('span');
        pop.className = 'dsm-send-pop';
        const buttonRect = button.getBoundingClientRect();
        pop.style.left = `${buttonRect.left + buttonRect.width / 2}px`;
        pop.style.top = `${buttonRect.top}px`;
        document.body.appendChild(pop);
        pop.addEventListener('animationend', () => pop.remove(), { once: true });
      }
    }
    if (reducedMotion.matches || themeMode === 'official') return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'dsm-ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });

  document.addEventListener('scroll', () => {
    root.classList.add('dsm-is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => root.classList.remove('dsm-is-scrolling'), 180);
  }, { passive: true, capture: true });

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('button')) node.dataset.dsmInteractive = '';
        decorateButtons(node);
      }
    }
  });

  const taskTick = () => {
    const busyButton = Array.from(document.querySelectorAll('button')).some((button) => {
      const name = [
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.textContent
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return /停止生成|停止回答|停止运行|取消生成|Stop generation|Stop response|Stop running|Cancel generation/i.test(name);
    });
    const runningState = Boolean(document.querySelector(
      '[data-slot="conversation.session"] [data-state="streaming"], ' +
      '[data-slot="conversation.session"] [data-status="streaming"], ' +
      '[data-slot="conversation.session"] [data-status="running"], ' +
      '[data-slot="conversation.session"] [aria-busy="true"]'
    ));
    const liveStatus = Array.from(document.querySelectorAll(
      '[data-slot="conversation.session"] [role="status"], ' +
      '[data-slot="conversation.session"] [aria-live="polite"]'
    )).some((element) => /正在思考|正在生成|正在调用|Running tool|Generating|Thinking/i.test(element.textContent || ''));
    const busy = busyButton || runningState || liveStatus;

    if (!petInitialized) {
      petInitialized = true;
      if (busy) beginPetTask('initial-state');
      return;
    }

    if (busy) {
      if (!petBusy) beginPetTask('dom-state');
      else if (usefulTitle(pageTitle())) petTaskTitle = pageTitle();
      clearSamples = 0;
    } else if (petBusy) {
      // 发送后先给页面足够时间切换为运行态；随后需连续稳定为空闲，避免工具切换时误报完成。
      if (Date.now() - petStartedAt < 2500) return;
      clearSamples += 1;
      if (clearSamples >= 4) completePetTask();
    }
  };

  decorateButtons();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  taskTick();
  window.setInterval(taskTick, 350);
})();
