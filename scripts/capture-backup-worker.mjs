// A short-lived child of the capture helper. It can be terminated if cloud
// filesystem I/O stalls; the local store and its recovery copy are already safe.
import { backUpStore } from '../src/lifeos-storage.mjs';

if (!process.send) process.exit(1);
process.once('message', async (store) => {
  let result;
  try { result = await backUpStore(store); }
  catch (error) { result = { configured: true, ok: false, error: error.message }; }
  process.send(result, () => process.exit(0));
});
