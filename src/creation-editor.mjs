// Browser entry for the Creation editor: an inline, Notion-style editor over
// Markdown, bundled locally (scripts/build-creation-editor.mjs) so it works
// without a network. The idea's `markdown` string stays the stored form; the
// editor renders it where you type and serializes it back on every change.
import { Editor, Extension } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { marked } from 'marked';

// Two documents are the same when they render the same, whatever their
// spacing or list markers. The editor only claims a document when its own
// Markdown renders like the original; otherwise the screen offers the source.
const rendered = (source) => marked.parse(String(source || ''), { gfm: true, breaks: false, async: false }).replace(/\s+/g, ' ').trim();
export const sameDocument = (a, b) => rendered(a) === rendered(b);

// The serializer escapes every *, _, [, ] and ~, which turns plain prose such as
// snake_case or a script cue like [Música sobe] into backslash noise in the
// stored text. These characters are escaped only where they could be read as
// Markdown: an underscore inside a word, a lone * between spaces, and brackets
// that cannot start a link, reference or task marker are literal anyway.
// Text that merely starts like a heading, list item or quote ("# ", "1. ", "- ") would turn into one when read back.
const WORD = /[\p{L}\p{N}]/u;
const BLOCK_START = /^(?:(\d{1,9}|[A-Za-z]{1,4})([.)])|#{1,6}|[-+>])(?=\s|$)/;
export function escapeText(text) {
  const linkish = /\]\(|\]\[|\]:/.test(text) || /^\s*\[[ xX]?\]/.test(text);
  const lead = BLOCK_START.exec(text);
  const blockAt = lead ? (lead[2] ? lead[1].length : 0) : -1;
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const before = text[index - 1];
    const after = text[index + 1];
    if (index === blockAt && char !== '*') out += `\\${char}`;
    else if (char === '\\' || char === '`' || char === '~') out += `\\${char}`;
    else if (char === '*') out += before && after && /\s/.test(before) && /\s/.test(after) ? char : '\\*';
    else if (char === '_') out += before && after && WORD.test(before) && WORD.test(after) ? char : '\\_';
    else if ((char === '[' || char === ']') && linkish) out += `\\${char}`;
    else out += char;
  }
  return out;
}

const MARKDOWN_HINT = /^(#{1,6} |[-*+] |\d+[.)] |> |```|\|.+\||- \[[ xX]\] )|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/m;

const COMMANDS = {
  heading: (chain) => chain.toggleHeading({ level: 2 }),
  bold: (chain) => chain.toggleBold(),
  italic: (chain) => chain.toggleItalic(),
  strike: (chain) => chain.toggleStrike(),
  quote: (chain) => chain.toggleBlockquote(),
  bullet: (chain) => chain.toggleBulletList(),
  number: (chain) => chain.toggleOrderedList(),
  check: (chain) => chain.toggleTaskList(),
  code: (chain) => chain.toggleCode(),
  block: (chain) => chain.toggleCodeBlock(),
  rule: (chain) => chain.setHorizontalRule(),
  table: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
};

const ACTIVE = {
  heading: 'heading', bold: 'bold', italic: 'italic', strike: 'strike', quote: 'blockquote', bullet: 'bulletList',
  number: 'orderedList', check: 'taskList', link: 'link', code: 'code', block: 'codeBlock', table: 'table',
};

/**
 * @param {HTMLElement} element  where the editor mounts
 * @param {object} options
 * @param {string} options.markdown  the document to open
 * @param {string} [options.placeholder]
 * @param {(markdown: string) => void} [options.onChange]  the person edited the document
 * @param {() => void} [options.onSelection]  the caret, selection or formatting under it changed
 * @param {() => void} [options.onLink]  ⌘K, to ask for an address
 */
export function createEditor(element, { markdown = '', placeholder = '', onChange, onSelection, onLink } = {}) {
  const shortcuts = Extension.create({
    name: 'ideaShortcuts',
    addKeyboardShortcuts: () => ({ 'Mod-k': () => { onLink?.(); return true; } }),
  });
  const editor = new Editor({
    element,
    content: markdown,
    contentType: 'markdown',
    extensions: [
      // Underline has no Markdown form, and a trailing empty paragraph would be saved as noise.
      StarterKit.configure({
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder }),
      Markdown,
      shortcuts,
    ],
    editorProps: {
      attributes: {
        class: 'markdown-preview',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Idea body',
        spellcheck: 'true',
      },
      // Markdown pasted as plain text (from a script, a chat, a README) becomes the real thing.
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        const text = data?.getData('text/plain') || '';
        if (!text || data.types.includes('text/html') || view.state.selection.$from.parent.type.spec.code) return false;
        if (!MARKDOWN_HINT.test(text)) return false;
        editor.commands.insertContent(text, { contentType: 'markdown' });
        return true;
      },
      // A plain click edits; ⌘/Ctrl-click follows the link.
      handleClick: (view, pos, event) => {
        const link = event.target.closest?.('a[href]');
        if (!link || !(event.metaKey || event.ctrlKey)) return false;
        event.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
    onUpdate: () => onChange?.(markdownOf()),
    onTransaction: () => onSelection?.(),
  });

  if (editor.markdown) editor.markdown.escapeMarkdownSyntax = escapeText;
  const chain = () => editor.chain().focus();
  // The serializer pads tables with blank lines; the stored text should not start or end with them.
  const markdownOf = () => editor.getMarkdown().replace(/^\n+/, '').replace(/\s+$/, '');
  return {
    editor,
    /** The editor shows this document faithfully (its Markdown renders like the original). */
    faithful: sameDocument(markdown, markdownOf()),
    getMarkdown: markdownOf,
    /** Replace the document (an agent or a reload changed it), keeping the caret near where it was. */
    setMarkdown: (value) => {
      const { from, to } = editor.state.selection;
      const focused = editor.isFocused;
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
      if (!focused) return;
      const end = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
    },
    focus: (where = 'end') => editor.commands.focus(where),
    hasFocus: () => editor.isFocused,
    isActive: (name) => Boolean(ACTIVE[name] && editor.isActive(ACTIVE[name])),
    /** A toolbar command: heading, bold, italic, strike, quote, bullet, number, check, code, block, rule, table. */
    run: (name) => { const command = COMMANDS[name]; if (command) command(chain()).run(); },
    currentLink: () => editor.getAttributes('link').href || '',
    selectedText: () => { const { from, to } = editor.state.selection; return editor.state.doc.textBetween(from, to, ' '); },
    /** Link the selection (or insert the address as a link); an empty address removes the link. */
    setLink: (href, label) => {
      const address = String(href || '').trim();
      if (!address) { chain().extendMarkRange('link').unsetLink().run(); return; }
      if (editor.state.selection.empty && !editor.isActive('link')) {
        chain().insertContent({ type: 'text', text: label || address, marks: [{ type: 'link', attrs: { href: address } }] }).run();
      } else chain().extendMarkRange('link').setLink({ href: address }).run();
    },
    insertImage: (src, alt = '') => { if (String(src || '').trim()) chain().setImage({ src: String(src).trim(), alt }).run(); },
    destroy: () => editor.destroy(),
  };
}
