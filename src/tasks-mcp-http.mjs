import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createTasksMcpServer } from './tasks-mcp.mjs';

const MAX_BODY_BYTES = 64 * 1024;

export function createTasksHttpServer({ service, authentication, enableWrites = false }) {
  if (!authentication?.authenticate) throw new Error('MCP authentication is required.');
  const resource = authentication.resource ? new URL(authentication.resource) : null;
  const metadataUrl = resource ? `${resource.origin}/.well-known/oauth-protected-resource` : null;
  const handler = createMcpHandler((ctx) => createTasksMcpServer({
    service, scopes: ctx.authInfo?.scopes || [], enableWrites, oauth: authentication.mode === 'oauth', resource: authentication.resource,
  }), { legacy: 'stateless', maxRequestBodySize: MAX_BODY_BYTES, maxSubscriptions: 0 });
  const handleMcp = toNodeHandler(handler, { maxRequestBodySize: MAX_BODY_BYTES });
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = new URL(`http://${req.headers.host || ''}`);
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname);
      if (!local && (!resource || host.host !== resource.host)) return json(res, 403, { error: 'Invalid Host.' });
      if (req.headers.origin && ![resource?.origin, local ? `http://${host.host}` : null].filter(Boolean).includes(req.headers.origin)) {
        return json(res, 403, { error: 'Invalid Origin.' });
      }
      const url = new URL(req.url, `http://${host.host}`);
      if (url.search) return json(res, 400, { error: 'Query parameters are not supported.' });
      if (['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(url.pathname)
        && req.method === 'GET' && authentication.metadata) return json(res, 200, authentication.metadata);
      if (url.pathname !== '/mcp') return json(res, 404, { error: 'Not found.' });
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed.' }); }
      const auth = await authentication.authenticate(req.headers.authorization);
      if (!auth) {
        res.setHeader('WWW-Authenticate', metadataUrl
          ? `Bearer resource_metadata="${metadataUrl}", scope="tasks:read"`
          : 'Bearer realm="lifeos-local-development"');
        return json(res, 401, { error: 'Authentication required.' });
      }
      // Never trust identity, scope, Host, or access tokens in forwarded headers.
      req.auth = auth;
      await handleMcp(req, res);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'LifeOS MCP request failed.' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, async close() {
    await handler.close();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  } };
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
