// Loads every command group into the registry. Import this module (not the
// individual groups) to get the complete LifeOS command surface.
import './core.mjs';
import './projects.mjs';
import './tasks.mjs';
import './time.mjs';
import './reading.mjs';
import './creation.mjs';
import './planning.mjs';
import './workspace.mjs';
import './history.mjs';
import './ui.mjs';

export {
  CommandError,
  describeCommand,
  getCommand,
  listCommands,
  registry,
  runCommand,
} from './registry.mjs';
export { buildOverview, searchState } from './core.mjs';
export { readServerInfo, serverInfoPath } from './ui.mjs';
