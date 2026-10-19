#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { DEFAULT_STORE_PATH } from '../src/lifeos-data.mjs';
import { createTaskService } from '../src/task-service.mjs';
import { readMcpAuthentication } from '../src/tasks-mcp-auth.mjs';
import { createTasksHttpServer } from '../src/tasks-mcp-http.mjs';

try {
  const port = Number(process.env.LIFEOS_MCP_PORT || 3010);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('LIFEOS_MCP_PORT must be a port number.');
  const enableWrites = process.env.LIFEOS_MCP_ENABLE_WRITES === 'true';
  const authentication = await readMcpAuthentication(process.env.LIFEOS_MCP_AUTH_FILE);
  await stat(DEFAULT_STORE_PATH); // Never seed, purge, or rewrite data at startup.
  const app = createTasksHttpServer({
    service: createTaskService({ enableWrites }), authentication, enableWrites,
  });
  app.server.once('error', () => { console.error('LifeOS MCP could not listen on the requested loopback port.'); process.exitCode = 1; });
  app.server.listen(port, '127.0.0.1', () => {
    console.log(`LifeOS Tasks MCP: http://127.0.0.1:${app.server.address().port}/mcp (${enableWrites ? 'read/write' : 'read-only'}, ${authentication.mode})`);
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
  });
} catch (error) {
  // Configuration errors contain no token values; filesystem/JSON diagnostics may.
  const safe = /^(LIFEOS_MCP_|MCP authentication |Local token |resource |issuer |jwksUrl |ownerSubject)/.test(error.message);
  console.error(safe ? error.message : 'LifeOS MCP could not load its authentication configuration or existing store.');
  process.exitCode = 1;
}
