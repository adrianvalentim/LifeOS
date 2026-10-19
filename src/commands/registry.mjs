// The LifeOS command registry. Every capability the person has in the app is a
// named command with a validated input schema. The browser, the CLI
// (`lifeos run`), the JavaScript SDK, the HTTP API and the MCP server all call
// commands through runCommand, so agents and the person share one surface and
// one set of rules. Add a capability by defining a command in this folder; it
// then appears everywhere automatically, including the in-app command palette.
import { z } from 'zod';
import { DEFAULT_STORE_PATH } from '../lifeos-data.mjs';
import { operationContext } from '../lifeos-history.mjs';

export const registry = new Map();
export const SOURCES = ['app', 'cli', 'sdk', 'mcp', 'http', 'codex', 'capture', 'test'];

export class CommandError extends Error {
  constructor(message, { status = 400, code = 'invalid' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} spec
 * @param {string} spec.name dotted name, e.g. "tasks.create"
 * @param {string} spec.title short human title for menus and the palette
 * @param {string} spec.description what it does, for agents (be specific)
 * @param {'read'|'write'|'ui'} spec.kind
 * @param {import('zod').ZodObject} [spec.input]
 * @param {(input, ctx) => Promise<any>} spec.run returns a result, or { result, state }
 * @param {string|((result, input) => string)} [spec.label] Activity/Undo wording
 * @param {boolean} [spec.destructive]
 * @param {boolean} [spec.idempotent]
 * @param {boolean} [spec.openWorld] reaches the network
 * @param {string[]} [spec.keywords] palette search terms
 */
export function defineCommand(spec) {
  if (!/^[a-z]+(\.[a-zA-Z]+)?$/.test(spec.name)) throw new Error(`Invalid command name: ${spec.name}`);
  if (registry.has(spec.name)) throw new Error(`Duplicate command: ${spec.name}`);
  const command = {
    input: z.object({}),
    destructive: false,
    idempotent: spec.kind === 'read',
    openWorld: false,
    keywords: [],
    group: spec.name.split('.')[0],
    ...spec,
  };
  registry.set(spec.name, command);
  return command;
}

export function getCommand(name) {
  return registry.get(name) || null;
}

export function listCommands({ kind } = {}) {
  return [...registry.values()]
    .filter((command) => !kind || command.kind === kind)
    .map(describeCommand);
}

export function describeCommand(command) {
  let inputSchema;
  try {
    inputSchema = z.toJSONSchema(command.input, { unrepresentable: 'any' });
    delete inputSchema.$schema;
  } catch {
    inputSchema = { type: 'object' };
  }
  return {
    name: command.name,
    title: command.title,
    description: command.description,
    group: command.group,
    kind: command.kind,
    destructive: command.destructive,
    idempotent: command.idempotent,
    openWorld: command.openWorld,
    keywords: command.keywords,
    inputSchema,
  };
}

export function formatInputError(error) {
  const issues = error.issues || [];
  if (!issues.length) return 'Invalid input.';
  return issues.slice(0, 4).map((issue) => {
    const where = issue.path?.length ? `${issue.path.join('.')}: ` : '';
    return `${where}${issue.message}`;
  }).join('; ');
}

/**
 * Runs one command.
 * @returns {Promise<{ command: string, result: any, state?: any, operationId?: string|null, label?: string|null }>}
 */
export async function runCommand(name, rawInput = {}, context = {}) {
  const command = registry.get(name);
  if (!command) throw new CommandError(`Unknown command: ${name}. Run "lifeos commands" to list them.`, { status: 404, code: 'unknown_command' });
  const parsed = command.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new CommandError(`${command.title}: ${formatInputError(parsed.error)}`);
  const ctx = {
    storePath: context.storePath || DEFAULT_STORE_PATH,
    source: SOURCES.includes(context.source) ? context.source : 'app',
    actor: context.actor ? String(context.actor).slice(0, 80) : null,
    ui: context.ui || null,
    now: context.now,
  };
  if (command.kind !== 'write') {
    const output = await command.run(parsed.data, ctx);
    return { command: name, ...normalizeOutput(output) };
  }
  const operation = {
    command: name,
    source: ctx.source,
    actor: ctx.actor,
    label: null,
    undoOf: context.undoOf || null,
    coalesceKey: null,
  };
  ctx.operation = operation;
  const label = command.label;
  operation.label = (result) => {
    try {
      return typeof label === 'function' ? label(result, parsed.data) : label || command.title;
    } catch {
      return command.title;
    }
  };
  if (command.coalesce) operation.coalesceKey = command.coalesce(parsed.data);
  let output;
  try {
    output = await operationContext.run(operation, () => command.run(parsed.data, ctx));
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw asCommandError(error);
  }
  const normalized = normalizeOutput(output);
  const operationId = operation.recorded?.at(-1) || null;
  return { command: name, ...normalized, operationId, label: operationId ? operation.recordedLabel || command.title : null };
}

function normalizeOutput(output) {
  if (output && typeof output === 'object' && !Array.isArray(output) && Object.hasOwn(output, 'state') && Object.keys(output).every((key) => ['result', 'state'].includes(key))) {
    return output;
  }
  if (output && typeof output === 'object' && !Array.isArray(output) && Object.hasOwn(output, 'state')) {
    const { state, ...result } = output;
    return { result, state };
  }
  return { result: output };
}

// Domain validation errors are the person's (or agent's) to fix, so they are
// reported as 400s with their message; anything else stays a server error.
const CLIENT_ERROR = /not found|already|required|must|cannot|can only|unknown|ambiguous|invalid|choose|no more than|in Trash|not in Trash|permanently|changed|conflict|offline|reconnect|busy|future|duplicate|still|needs|unavailable|blocked|is running|no active|at least|at most|only a top-level|exists|characters/i;
export function asCommandError(error) {
  if (error instanceof CommandError) return error;
  const wrapped = new CommandError(error.message, { status: CLIENT_ERROR.test(error.message) ? 400 : 500, code: 'failed' });
  wrapped.cause = error;
  return wrapped;
}
