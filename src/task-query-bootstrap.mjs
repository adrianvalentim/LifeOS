// Node preloader for the pinned Wrangler CLI. --command uses the query API;
// --file uses bulk import and cannot return SELECT/RETURNING rows. Load the
// private query into JavaScript argv after launch so SQL/task content never
// appears in the OS process command line. Wrangler still owns authentication.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const commandIndex = process.argv.indexOf('--command');
const file = process.argv[commandIndex + 1];
try {
  if (commandIndex < 0 || !file || !path.isAbsolute(file)
    || process.argv[2] !== 'd1' || process.argv[3] !== 'execute'
    || !process.argv.includes('--remote') || !process.argv.includes('--json')) throw new Error();
  const info = await stat(file);
  if (!info.isFile() || info.mode & 0o077 || info.size > 99000) throw new Error();
  // Keep the value attached to the option: SQL may begin with a -- comment,
  // which a CLI parser otherwise mistakes for a second option.
  process.argv.splice(commandIndex, 2, `--command=${await readFile(file, 'utf8')}`);
} catch {
  throw new Error('Private task query input is unavailable.');
}
