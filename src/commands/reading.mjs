import { z } from 'zod';
import { enrichOpenLibraryBook, searchOpenLibrary } from '../book-catalog.mjs';
import { deleteCachedReadingBookCover } from '../book-cover-cache.mjs';
import {
  addReadingBook,
  deleteReadingBook,
  normalizeText,
  reorderReadingBook,
  setReadingBookStatus,
  updateReadingBookFinishedDate,
  updateReadingBookTags,
} from '../lifeos-data.mjs';
import { updateReadingBook } from '../lifeos-manage.mjs';
import { defineCommand } from './registry.mjs';
import { bookRef, date, derivedState, id, quote, readingStatus, resolveBookId, tags, titleOf } from './shared.mjs';

const STATUS_LABELS = { to_read: 'To read', next_up: 'Next up', reading: 'Reading', finished: 'Finished', dropped: 'Dropped' };

const bookSummary = (book) => ({
  id: book.id, title: book.title, subtitle: book.subtitle, authors: book.authors, status: book.status,
  tags: book.tags, pageCount: book.pageCount, publishedYear: book.publishedYear,
  startedAt: book.startedAt || null, finishedAt: book.finishedAt || null, addedAt: book.addedAt,
});

defineCommand({
  name: 'reading.list',
  title: 'List books',
  kind: 'read',
  description: 'List the reading library in queue order, optionally by status, tag or text.',
  input: z.object({ status: readingStatus.optional(), tag: z.string().optional(), query: z.string().optional() }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx);
    const needle = normalizeText(input.query || '');
    const books = state.reading.books.filter((book) => (!input.status || book.status === input.status)
      && (!input.tag || book.tags.some((tag) => normalizeText(tag) === normalizeText(input.tag)))
      && (!needle || normalizeText(`${book.title} ${book.authors.join(' ')} ${book.tags.join(' ')}`).includes(needle)));
    return { summary: state.reading.summary, books: books.map(bookSummary) };
  },
});

defineCommand({
  name: 'reading.get',
  title: 'Read book',
  kind: 'read',
  description: 'Read one book\'s full record including description and edition metadata.',
  input: z.object({ ...bookRef }),
  run: async (input, ctx) => {
    const bookId = await resolveBookId(input, ctx);
    const state = await derivedState(ctx);
    const book = state.reading.books.find((item) => item.id === bookId);
    if (!book) throw new Error(`Reading book not found: ${bookId}`);
    return { book };
  },
});

defineCommand({
  name: 'reading.searchCatalog',
  title: 'Search book catalog',
  kind: 'read',
  openWorld: true,
  description: 'Search Open Library (20 results per page) by title, author or ISBN. Results are temporary; add one with reading.add { catalogBook }.',
  input: z.object({ query: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(50).optional() }),
  run: async (input) => ({ provider: 'open_library', ...await searchOpenLibrary(input.query, { page: input.page || 1 }) }),
});

defineCommand({
  name: 'reading.add',
  title: 'Add book',
  kind: 'write',
  openWorld: true,
  description: 'Add a book to Reading: either a catalogBook from reading.searchCatalog (enriched from Open Library) or manual fields (title and authors). Status defaults to to_read. Duplicates are refused.',
  keywords: ['book', 'library'],
  input: z.object({
    catalogBook: z.record(z.string(), z.any()).optional(),
    title: z.string().trim().min(1).max(300).optional(),
    authors: z.array(z.string().trim().min(1).max(180)).max(12).optional(),
    subtitle: z.string().max(400).optional(),
    pageCount: z.number().int().min(1).max(100000).optional(),
    publishedYear: z.number().int().min(1).max(3000).optional(),
    coverUrl: z.string().url().optional(),
    tags: tags.optional(),
    status: readingStatus.optional(),
  }),
  label: (result) => `Added ${quote(titleOf(result))} to Reading`,
  run: async (input, ctx) => {
    let book;
    if (input.catalogBook) {
      book = input.catalogBook.source?.provider === 'open_library' ? await enrichOpenLibraryBook(input.catalogBook) : input.catalogBook;
      if (input.tags) book = { ...book, tags: input.tags };
    } else {
      if (!input.title) throw new Error('Give a catalogBook or a title.');
      book = {
        title: input.title, authors: input.authors || [], subtitle: input.subtitle, pageCount: input.pageCount,
        publishedYear: input.publishedYear, coverUrl: input.coverUrl, tags: input.tags || [],
        source: { provider: 'manual' },
      };
    }
    return addReadingBook({ book, status: input.status }, ctx.storePath);
  },
});

defineCommand({
  name: 'reading.update',
  title: 'Edit book',
  kind: 'write',
  description: 'Edit a book\'s metadata: title, subtitle, authors, description, publisher, year, pages, language, ISBNs, cover URL or tags.',
  input: z.object({
    ...bookRef,
    title: z.string().trim().min(1).max(300).optional(),
    subtitle: z.string().max(400).nullable().optional(),
    authors: z.array(z.string().trim().min(1).max(180)).max(12).optional(),
    description: z.string().max(12000).nullable().optional(),
    publisher: z.string().max(300).nullable().optional(),
    publishedYear: z.number().int().min(1).max(3000).nullable().optional(),
    pageCount: z.number().int().min(1).max(100000).nullable().optional(),
    language: z.string().max(30).nullable().optional(),
    isbn10: z.string().max(20).nullable().optional(),
    isbn13: z.string().max(20).nullable().optional(),
    coverUrl: z.string().max(2000).nullable().optional(),
    tags: tags.optional(),
  }),
  label: (result) => `Edited ${quote(titleOf(result))}`,
  run: async (input, ctx) => {
    const bookId = await resolveBookId(input, ctx);
    const { book: _title, ...fields } = input;
    const output = await updateReadingBook({ ...fields, bookId }, ctx.storePath);
    if (Object.hasOwn(input, 'coverUrl')) await deleteCachedReadingBookCover(bookId, ctx.storePath).catch(() => undefined);
    return output;
  },
});

defineCommand({
  name: 'reading.setStatus',
  title: 'Change book status',
  kind: 'write',
  description: 'Move a book to to_read, next_up, reading, finished or dropped (records first start/finish/drop dates).',
  input: z.object({ ...bookRef, status: readingStatus }),
  label: (result, input) => `Moved ${quote(titleOf(result))} to ${STATUS_LABELS[input.status]}`,
  run: async (input, ctx) => setReadingBookStatus({ bookId: await resolveBookId(input, ctx), status: input.status }, ctx.storePath),
});

defineCommand({
  name: 'reading.move',
  title: 'Reorder book',
  kind: 'write',
  description: 'Place a book at an exact queue position within a status (before beforeBookId, or last), changing status if needed. Or move it one step with direction up/down.',
  input: z.object({
    ...bookRef,
    status: readingStatus.optional(),
    beforeBookId: id.nullable().optional(),
    direction: z.enum(['up', 'down']).optional(),
  }),
  label: (result) => `Reordered ${quote(titleOf(result))}`,
  run: async (input, ctx) => {
    const bookId = await resolveBookId(input, ctx);
    const payload = input.status !== undefined
      ? { bookId, status: input.status, beforeBookId: input.beforeBookId ?? null }
      : { bookId, direction: input.direction };
    return reorderReadingBook(payload, ctx.storePath);
  },
});

defineCommand({
  name: 'reading.setTags',
  title: 'Tag book',
  kind: 'write',
  description: 'Replace a book\'s tag set (normalized, deduplicated, up to 24).',
  input: z.object({ ...bookRef, tags }),
  label: (result) => `Retagged ${quote(titleOf(result))}`,
  run: async (input, ctx) => updateReadingBookTags({ bookId: await resolveBookId(input, ctx), tags: input.tags }, ctx.storePath),
});

defineCommand({
  name: 'reading.setFinishedDate',
  title: 'Set date read',
  kind: 'write',
  description: 'Set or clear (null) the date a finished book was read. Future dates are refused.',
  input: z.object({ ...bookRef, date: date.nullable() }),
  label: (result) => `Set the date read for ${quote(titleOf(result))}`,
  run: async (input, ctx) => updateReadingBookFinishedDate({ bookId: await resolveBookId(input, ctx), date: input.date }, ctx.storePath),
});

defineCommand({
  name: 'reading.delete',
  title: 'Delete book',
  kind: 'write',
  destructive: true,
  description: 'Remove one book from the library and its cached cover. Undo restores the record. Confirm with the person first.',
  input: z.object({ ...bookRef }),
  label: (result) => `Removed ${quote(titleOf(result))} from Reading`,
  run: async (input, ctx) => {
    const bookId = await resolveBookId(input, ctx);
    const output = await deleteReadingBook({ bookId }, ctx.storePath);
    await deleteCachedReadingBookCover(bookId, ctx.storePath).catch(() => undefined);
    return output;
  },
});
