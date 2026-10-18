// Small helpers shared by the browser specs.

/** A YYYY-MM-DD date moved by whole days, independent of the local time zone. */
export function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The visible task row for a task ID in the main column. */
export function taskRow(page, id) {
  return page.locator(`.main .task-row[data-task="${id}"]`);
}

/** Task IDs of the visible rows in the main column, top to bottom. */
export function rowIds(page, selector = '.main .task-row:not(.is-input)') {
  return page.locator(selector).evaluateAll((rows) => rows.map((row) => row.dataset.task));
}
