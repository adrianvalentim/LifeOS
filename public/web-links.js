// Notes remain the source of truth; links are a safe, derived convenience.
export function extractWebLinks(notes) {
  const links = new Map();
  for (const match of String(notes || '').matchAll(/https?:\/\/[^\s<>"`]+/giu)) {
    try {
      const url = new URL(match[0]);
      if (!url.hostname || url.username || url.password) continue;
      links.set(url.href, { url: url.href, label: url.hostname });
    } catch { /* Incomplete addresses stay editable as plain text. */ }
    if (links.size === 10) break;
  }
  return [...links.values()];
}
