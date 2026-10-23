// Isolated content script: connects the control tab (extension) to the game
// page (MAIN world). Control tab -> port -> here -> window.postMessage -> inject.js
(() => {
  const TO_PAGE = 1;
  const FROM_PAGE = 2;
  let port = null;
  let lastActive = false;
  let toastText = {
    connected: 'Joy-Con connected',
    disconnected: 'Joy-Con disconnected',
    hubClosed: 'Joy2Cloud tab closed, controller disconnected',
  };

  // Toast strings follow the language picked in the control tab.
  chrome.storage.local.get('toast').then((s) => { if (s.toast) toastText = s.toast; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.toast && changes.toast.newValue) toastText = changes.toast.newValue;
  });

  function toPage(msg) {
    window.postMessage({ __joy2cloud: TO_PAGE, ...msg }, '*');
  }

  function connect() {
    try {
      port = chrome.runtime.connect({ name: 'joy2cloud' });
    } catch (_) {
      // extension reloaded or disabled: stop trying
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'state' && msg.active !== lastActive) {
        lastActive = msg.active;
        toast(msg.active ? toastText.connected : toastText.disconnected);
      }
      toPage(msg);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      if (lastActive) {
        lastActive = false;
        toast(toastText.hubClosed);
      }
      toPage({ type: 'state', active: false });
      setTimeout(connect, 2000);
    });
  }

  // Vibration requests from the game (inject.js) -> control tab
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__joy2cloud !== FROM_PAGE) return;
    if (port && e.data.type === 'rumble') {
      try {
        port.postMessage({ type: 'rumble', strong: e.data.strong, weak: e.data.weak, duration: e.data.duration });
      } catch (_) { /* ignore */ }
    }
  });

  let toastEl = null;
  let toastTimer = null;
  function toast(text) {
    const show = () => {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.setAttribute('role', 'status');
        toastEl.style.cssText = [
          'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483647',
          'padding:10px 14px', 'border-radius:12px',
          'font:500 13px/1.3 -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
          'background:rgba(32,34,43,.94)', 'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.3)',
          'pointer-events:none', 'transition:opacity .3s', 'opacity:0',
        ].join(';');
        document.documentElement.appendChild(toastEl);
      }
      toastEl.textContent = '🎮 ' + text;
      toastEl.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2500);
    };
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  }

  connect();
})();
