// Browser entry; bundled locally so editing and preview work without a network.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
export function renderMarkdown(source) {
  const html = marked.parse(String(source || ''), { gfm: true, breaks: false, async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'id', 'name'],
  });
}
