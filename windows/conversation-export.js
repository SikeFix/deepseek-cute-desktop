// DeepSeek Cute — 会话导出与快捷操作注入层(双平台共享)
// macOS:  作为 Bundle 资源 conversation-export.js 以 WKUserScript 注入。
// Windows: main.js 在注入窗口外观后 executeJavaScript 同一份文件。
// 只暴露纯页面函数, 不碰网络、不碰密钥; 系统剪贴板由原生层写入,
// 页面内的 __dsmCopyConversation 仅作浏览器环境兜底。
(function () {
  'use strict';
  if (window.__dsmExportReady) return;
  window.__dsmExportReady = true;

  // ---------- 工具 ----------
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  var BLOCK_TAGS = {
    div: 1, section: 1, article: 1, header: 1, footer: 1, main: 1, aside: 1,
    nav: 1, li: 1, tr: 1, td: 1, th: 1, ul: 1, ol: 1, blockquote: 1,
    figure: 1, figcaption: 1, details: 1, summary: 1, p: 1,
    h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, hr: 1, table: 1, pre: 1
  };

  // 通用 DOM → Markdown 序列化; 未知结构安全降级为纯文本。
  function mdFromNode(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      // 文本节点: 压缩内部空白(换行由块级边界负责)
      return String(node.nodeValue || '').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    var tag = (node.tagName || '').toLowerCase();
    var kids = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var piece = mdFromNode(node.childNodes[i]);
      if (piece) kids.push(piece);
    }
    var inner = kids.join('');
    switch (tag) {
      case 'pre':
        return '```\n' + cleanText(node.innerText || node.textContent) + '\n```\n\n';
      case 'code':
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return inner;
        return inner ? '`' + inner + '`' : '';
      case 'strong': case 'b': return inner ? '**' + inner + '**' : '';
      case 'em': case 'i': return inner ? '*' + inner + '*' : '';
      case 'del': case 's': return inner ? '~~' + inner + '~~' : '';
      case 'a':
        if (!inner) return '';
        var href = node.getAttribute('href') || '';
        return /^https?:/i.test(href) ? '[' + inner + '](' + href + ')' : inner;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return inner ? ('#' + tag.slice(1) + ' ' + inner + '\n\n') : '';
      case 'li':
        return inner ? '- ' + inner + '\n' : '';
      case 'ul': case 'ol':
        return cleanText(inner);
      case 'blockquote':
        return inner ? inner.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n') + '\n\n' : '';
      case 'hr':
        return '\n---\n';
      case 'br':
        return '\n';
      case 'img':
        return '';
      default:
        return BLOCK_TAGS[tag] ? inner : inner;
    }
  }

  function mdFromEl(el) {
    if (!el) return '';
    var out = '';
    for (var i = 0; i < el.childNodes.length; i++) out += mdFromNode(el.childNodes[i]);
    // 折叠多余空行
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  function cap(s, n) {
    s = cleanText(s);
    return s.length > n ? s.slice(0, n) + ' …' : s;
  }

  // ---------- 会话结构识别 ----------
  // dsh 消息块: .Md3f7G_flowItem(哈希类名, 版本内稳定) > [data-slot=conversation.chat.node]
  // 用户消息带 .gdEzaW_userRow / .gdEzaW_bubble; 工具调用带 [data-slot=tool.call.toolview];
  // 思考块带 Sxvs8a 前缀类; 上下文注入块带 pC0e7a_source。识别失败时降级为助手文本。
  function flowItems() {
    var items = document.querySelectorAll('.Md3f7G_flowItem');
    if (items && items.length) return Array.prototype.slice.call(items);
    // 兜底: 按稳定 data-slot 逐个消息节点
    return Array.prototype.slice.call(document.querySelectorAll('[data-slot="conversation.chat.node"]'));
  }

  function classify(item) {
    if (item.querySelector('.gdEzaW_userRow, [class*="_userRow"]')) return 'user';
    if (item.querySelector('[data-slot="tool.call.toolview"]')) return 'tool';
    if (item.querySelector('[class*="Sxvs8a_"], [class*="_thinkRoot"]')) return 'think';
    if (item.querySelector('.pC0e7a_source') || /^上下文注入/.test((item.innerText || '').trim())) return 'context';
    var txt = cleanText(item.innerText);
    if (!txt) return 'empty';
    if (/^Think\b/.test(txt)) return 'think';
    return 'assist';
  }

  function userText(item) {
    var bubble = item.querySelector('.gdEzaW_bubble, [class*="_bubble"]');
    if (bubble && cleanText(bubble.innerText)) return cleanText(bubble.innerText);
    var stack = item.querySelector('.gdEzaW_userStack');
    if (stack) return cleanText(stack.innerText);
    return cap(item.innerText, 8000);
  }

  function toolText(item) {
    // 卡片内部: .o3BgMG_title = 工具名(Bash/提问…), .o3BgMG_summary = 命令/参数摘要
    var root = item.querySelector('[data-slot="tool.call.toolview"]') || item;
    // 不同工具卡片类名不同(o3BgMG_*/CY-8Ka_*), 但都遵循 _title/_summary 后缀
    var tEl = root.querySelector('[class*="_title"]');
    var sEl = root.querySelector('[class*="_summary"]');
    var title = tEl ? cleanText(tEl.textContent) : '';
    var summary = sEl ? cap(cleanText(sEl.textContent), 300) : '';
    if (title && summary) return '> 🔧 工具调用 `' + title + '` — ' + summary;
    if (title) return '> 🔧 工具调用 `' + title + '`';
    return summary ? '> 🔧 工具调用 — ' + summary : '';
  }

  function thinkText(item) {
    var root = item.querySelector('.Sxvs8a_root') || item;
    var sEl = root.querySelector('[class*="_summary"]');
    var txt = sEl ? cleanText(sEl.textContent)
      : cleanText(root.innerText).replace(/^Think\b[\s:]*/i, '');
    return txt;
  }

  function sessionTitle() {
    var row = document.querySelector('.wSkVaW_titleRow');
    if (row) {
      var line = (row.innerText || '').split('\n').map(cleanText).filter(Boolean)[0] || '';
      if (line) return cap(line, 80);
    }
    return cleanText(document.title) || '未命名会话';
  }

  // ---------- 主导出函数 ----------
  window.__dsmConversationMarkdown = function () {
    var items = flowItems();
    if (!items.length) return '';
    var date = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var out = [
      '# ' + sessionTitle(),
      '',
      '> 导出自 DeepSeek Cute · ' + date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()),
      ''
    ];
    var expectRole = null; // 'me' | 'ai' | null
    for (var i = 0; i < items.length; i++) {
      var kind = classify(items[i]);
      if (kind === 'empty') continue;
      if (kind === 'user') {
        var role = cleanText(userText(items[i]));
        if (!role) continue;
        if (expectRole !== 'me') { out.push('**🧑 我**', ''); expectRole = 'me'; }
        out.push(role, '');
        continue;
      }
      if (expectRole !== 'ai') { out.push('**🤖 助手**', ''); expectRole = 'ai'; }
      var body;
      if (kind === 'tool') body = toolText(items[i]);
      else if (kind === 'think') {
        var tt = cap(thinkText(items[i]), 4000);
        body = tt ? '> 💭 思考: ' + tt : '';
      } else if (kind === 'context') {
        var src = items[i].querySelector('.pC0e7a_source');
        body = '> 📎 上下文注入' + (src ? ' · ' + cap(cleanText(src.textContent), 200) : '');
      } else body = mdFromEl(items[i]);
      if (body) { out.push(body, ''); expectRole = 'ai'; }
    }
    var md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!md) return '';
    return md.length > 400000 ? md.slice(0, 400000) + '\n\n…(内容过长, 已截断)' : md;
  };

  // ---------- 新建会话 ----------
  window.__dsmNewSession = function () {
    var b = document.querySelector('button[aria-label="新建会话"]');
    if (b) { b.click(); return true; }
    var side = document.querySelector('[data-slot="sidebar"]');
    var first = side && side.querySelector('button');
    if (first) { first.click(); return true; }
    return false;
  };

  // ---------- 页面提示(原生复制成功后调用) ----------
  window.__dsmToast = function (message) {
    try {
      var el = document.getElementById('dsmToastPill');
      if (!el) {
        el = document.createElement('div');
        el.id = 'dsmToastPill';
        el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(8px);' +
          'z-index:2147483647;padding:9px 18px;border-radius:999px;font:600 13px/1 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;' +
          'color:#16130f;background:rgba(255,252,247,.94);border:1px solid rgba(16,16,16,.14);' +
          'box-shadow:0 8px 28px rgba(30,20,12,.18);opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;';
        document.documentElement.appendChild(el);
      }
      el.textContent = message;
      requestAnimationFrame(function () {
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
      });
      clearTimeout(el.__dsmToastTimer);
      el.__dsmToastTimer = setTimeout(function () {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
      }, 1800);
    } catch (e) { /* 提示失败不影响主流程 */ }
  };

  // 浏览器环境兜底复制(桌面环境由原生层直接写系统剪贴板)
  window.__dsmCopyConversation = function () {
    var md = window.__dsmConversationMarkdown();
    if (!md) { window.__dsmToast('当前没有可复制的会话'); return false; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(function () {
        window.__dsmToast('对话已复制为 Markdown');
      }).catch(function () { window.__dsmToast('复制失败, 请重试'); });
      return true;
    }
    return false;
  };

  // ---------- 首次启动快捷键提示卡 ----------
  var HINT_KEY = 'dsm.hints.v1';
  function isMac() { return /Mac/i.test(navigator.platform || navigator.userAgent || ''); }
  function mod() { return isMac() ? '⌘' : 'Ctrl'; }
  function shiftKey() { return isMac() ? '⇧' : 'Shift'; }

  function showHintCard() {
    try { if (localStorage.getItem(HINT_KEY)) return; } catch (e) {}
    // 等应用真正渲染出来再出现
    if (!document.querySelector('[data-slot="sidebar"]')) {
      if (Date.now() - hintStart < 45000) setTimeout(showHintCard, 1200);
      return;
    }
    if (document.getElementById('dsmHintCard')) return;
    var card = document.createElement('div');
    card.id = 'dsmHintCard';
    card.style.cssText = 'position:fixed;right:22px;top:86px;z-index:2147483646;width:296px;padding:16px 18px 14px;' +
      'border-radius:16px;background:rgba(255,253,249,.96);border:1px solid rgba(16,16,16,.12);' +
      'box-shadow:0 16px 44px rgba(30,20,12,.20);font:500 13px/1.7 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;' +
      'color:#16130f;-webkit-app-region:no-drag;';
    card.innerHTML =
      '<div style="font-weight:700;font-size:14px;margin-bottom:8px">✨ 新快捷键上线</div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span>新建会话</span><b>' + mod() + ' K</b></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span>复制对话为 Markdown</span><b>' + mod() + ' ' + shiftKey() + ' C</b></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span>切换主题</span><b>' + mod() + ' T</b></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span>模型服务设置</span><b>' + mod() + ' ,</b></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span>Token 统计</span><b>' + mod() + ' ' + shiftKey() + ' S</b></div>' +
      '<button id="dsmHintOk" style="margin-top:10px;width:100%;height:32px;border:0;border-radius:9px;cursor:pointer;' +
      'background:#16130f;color:#fff;font:600 13px/1 system-ui">知道了</button>';
    document.documentElement.appendChild(card);
    document.getElementById('dsmHintOk').addEventListener('click', function () {
      try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
      card.remove();
    });
  }
  var hintStart = Date.now();
  setTimeout(showHintCard, 2500);
})();
