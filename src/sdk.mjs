// LifeOS for code. Agents (and scripts) can control everything the person can,
// in-process, without the app running:
//
//   import { createLifeOS } from '/path/to/LifeOS/src/sdk.mjs';
//   const lifeos = createLifeOS({ actor: 'weekly-review script' });
//   const { tasks } = await lifeos.tasks.list({ due: 'overdue' });
//   await lifeos.tasks.create({ title: 'Draft Act III', project: 'Portia', dueDate: '2026-10-20' });
//   await lifeos.history.undo();               // revert the last change
//   await lifeos.ui.open({ kind: 'project', id: 'portia' });   // needs the app open
//
// Every method is a registered command (see lifeos.commands()). Writes are
// validated, locked, atomic, journaled for Undo and visible in Activity.
import { DEFAULT_STORE_PATH } from './lifeos-data.mjs';
import { describeCommand, getCommand, listCommands, runCommand } from './commands/index.mjs';

export function createLifeOS({ storePath = DEFAULT_STORE_PATH, source = 'sdk', actor = null } = {}) {
  const context = { storePath, source, actor };
  const api = {
    /** Run a command by name; returns { result, operationId, label }. */
    async run(name, input = {}) {
      const { state: _state, ...output } = await runCommand(name, input, context);
      api.lastOperation = output.operationId ? { id: output.operationId, label: output.label } : api.lastOperation;
      return output;
    },
    /** All commands with their JSON input schemas. */
    commands: (filter = {}) => listCommands(filter),
    describe: (name) => {
      const command = getCommand(name);
      return command ? describeCommand(command) : null;
    },
    lastOperation: null,
  };
  return new Proxy(api, {
    get(target, property) {
      if (property in target || typeof property !== 'string') return target[property];
      // lifeos.overview() and lifeos.search() are top-level commands.
      if (getCommand(property)) return (input) => target.run(property, input).then((output) => output.result);
      return new Proxy({}, {
        get(_group, verb) {
          if (typeof verb !== 'string') return undefined;
          const name = `${property}.${verb}`;
          if (!getCommand(name)) return undefined;
          return (input) => target.run(name, input).then((output) => output.result);
        },
      });
    },
  });
}

export const lifeos = createLifeOS();
