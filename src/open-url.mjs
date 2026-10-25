import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Opens a sign-in page the server itself got from an agent (never a URL the
// browser sent) in the person's default browser.
export async function openSignInPage(url, { platform = process.platform, run = promisify(execFile) } = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error('There is no sign-in page to open yet.');
  }
  if (target.protocol !== 'https:') throw new Error('Only https sign-in pages can be opened.');
  if (platform !== 'darwin') throw new Error('Open the sign-in page directly in your browser.');
  await run('/usr/bin/open', [target.href], { timeout: 10_000 });
  return { ok: true };
}
