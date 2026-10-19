const HOST = 'com.lifeos.capture';
const pending = new Map();

export function nativeRequest(message, runtime = chrome.runtime) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The save could not be confirmed. Retry is safe; the same link will not be added twice.' }), 20_000);
    runtime.sendNativeMessage(HOST, message, (response) => {
      clearTimeout(timer);
      const error = runtime.lastError;
      if (error) return resolve({ ok: false, error: 'LifeOS could not be reached. Make sure the LifeOS Capture helper is installed.', setup: true });
      resolve(response?.ok === true || response?.ok === false ? response : { ok: false, error: 'LifeOS returned an incomplete response. Retry is safe.' });
    });
  });
}

export async function capture(tab, api = chrome) {
  if (!tab || !Number.isInteger(tab.id) || !/^https?:\/\//i.test(tab.url || '')) {
    return { ok: false, error: 'Open an article or webpage first. Browser settings, new tabs, and local files cannot be saved.' };
  }
  const key = `${tab.id}:${tab.url}`;
  if (pending.has(key)) return pending.get(key);
  // Keep feedback in the popup: a per-tab Saved badge could go stale after navigation.
  const operation = nativeRequest({ action: 'capture', url: tab.url, title: tab.title || '' }, api.runtime);
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
    const operation = message?.type === 'capture' ? capture(message.tab)
      : message?.type === 'open' ? nativeRequest({ action: 'open' }) : null;
    if (!operation) return false;
    operation.then(sendResponse, () => sendResponse({ ok: false, error: 'The save could not be confirmed. Please retry.' }));
    return true;
  });
}
