// Toolbar click: open (or focus) the control tab. It must be a normal tab:
// Chrome anchors the Bluetooth device chooser to the address bar, which
// popup windows don't have.

async function openHub() {
  const { hubTabId } = await chrome.storage.session.get('hubTabId');
  if (hubTabId != null) {
    try {
      const tab = await chrome.tabs.update(hubTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch (_) {
      // the tab was closed; open a new one
    }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('hub.html') });
  await chrome.storage.session.set({ hubTabId: tab.id });
}

chrome.action.onClicked.addListener(openHub);

chrome.tabs.onRemoved.addListener(async (id) => {
  const { hubTabId } = await chrome.storage.session.get('hubTabId');
  if (id === hubTabId) await chrome.storage.session.remove('hubTabId');
});
