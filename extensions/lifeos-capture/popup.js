const byId = (id) => document.getElementById(id);
let page;

function showMessage(message = '') {
  byId('message').textContent = message;
  byId('message').hidden = !message;
}

function showError(message) {
  document.body.classList.add('error');
  byId('capture').setAttribute('aria-busy', 'false');
  byId('icon').textContent = '!';
  byId('status').textContent = 'Save not confirmed';
  byId('title').textContent = page?.title || 'Let’s get this page saved.';
  showMessage(message);
  byId('retry').hidden = false;
}

async function save() {
  document.body.classList.remove('error');
  byId('retry').hidden = true;
  showMessage();
  byId('capture').setAttribute('aria-busy', 'true');
  byId('status').textContent = 'Saving to your reading list…';
  byId('icon').textContent = '↙';
  try {
    page ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (page?.title) byId('title').textContent = page.title;
    // The worker owns the write, so dismissing this popup does not cancel it.
    const result = await chrome.runtime.sendMessage({ type: 'capture', tab: { id: page?.id, title: page?.title, url: page?.url } });
    if (!result?.ok) return showError(result?.error || 'LifeOS could not confirm this save. Please retry.');
    byId('capture').setAttribute('aria-busy', 'false');
    byId('icon').textContent = '✓';
    byId('status').textContent = result.created ? 'Saved to LifeOS' : 'Already in LifeOS';
    byId('title').textContent = result.task.title;
    byId('title').title = result.task.title;
    const source = byId('source');
    source.href = result.url;
    source.textContent = `${new URL(result.url).hostname} ↗`;
    source.hidden = false;
    showMessage(result.warning || '');
    byId('open').hidden = false;
  } catch { showError('LifeOS could not confirm this save. Click Try again; the same link will not be added twice.'); }
}

byId('retry').addEventListener('click', save);
byId('open').addEventListener('click', async () => {
  byId('open').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'open' });
    if (!result?.ok) showMessage('Your task is saved. Open LifeOS from Applications to see it.');
    else window.close();
  } catch { showMessage('Your task is saved. Open LifeOS from Applications to see it.'); }
  finally { byId('open').disabled = false; }
});
save();
