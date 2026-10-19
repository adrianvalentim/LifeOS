import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ROOT_DIR } from './lifeos-storage.mjs';

export function httpsUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment.`);
  }
  return url;
}

// Resource-server authentication only: no credentials, grants, identity
// provider, login pages, or persistent access settings are created here.
export function createOAuthAuthentication(config, { keySet } = {}) {
  const resource = httpsUrl(config.resource, 'resource');
  if (resource.pathname !== '/mcp') throw new Error('resource must end in /mcp.');
  const issuer = httpsUrl(config.issuer, 'issuer').href;
  const jwksUrl = httpsUrl(config.jwksUrl, 'jwksUrl');
  if (typeof config.ownerSubject !== 'string' || !config.ownerSubject.trim()) throw new Error('ownerSubject is required.');
  const keys = keySet || createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000 });
  return {
    mode: 'oauth', resource: resource.href,
    metadata: { resource: resource.href, authorization_servers: [issuer],
      scopes_supported: ['tasks:read', 'tasks:write'], bearer_methods_supported: ['header'] },
    async authenticate(header) {
      const token = bearer(header);
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer, audience: resource.href, algorithms: ['RS256', 'ES256', 'EdDSA'],
          requiredClaims: ['exp', 'iat', 'sub'],
        });
        if (payload.sub !== config.ownerSubject) return null;
        const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
        if (!scopes.includes('tasks:read')) return null;
        return { token, clientId: payload.sub, scopes, expiresAt: payload.exp, resource };
      } catch { return null; }
    },
  };
}

// Explicit local-development authentication. ChatGPT's custom plugin route
// cannot supply an arbitrary API key; this mode must never be tunneled publicly.
export function createLocalTokenAuthentication(token) {
  if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) throw new Error('Local token must have at least 32 non-whitespace characters.');
  const expected = Buffer.from(token);
  return {
    mode: 'local-token',
    async authenticate(header) {
      const actual = Buffer.from(bearer(header) || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      return { token, clientId: 'local-owner', scopes: ['tasks:read', 'tasks:write'] };
    },
  };
}

export async function readMcpAuthentication(filename) {
  if (!filename || !path.isAbsolute(filename)) throw new Error('LIFEOS_MCP_AUTH_FILE must name an absolute configuration path outside Git.');
  const resolved = path.resolve(filename);
  const relative = path.relative(ROOT_DIR, resolved);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..') throw new Error('MCP authentication configuration must be outside the workspace.');
  const actual = await realpath(resolved);
  const actualRelative = path.relative(await realpath(ROOT_DIR), actual);
  if (!actualRelative.startsWith(`..${path.sep}`) && actualRelative !== '..') throw new Error('MCP authentication configuration must be outside the workspace.');
  const info = await stat(actual);
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('MCP authentication configuration must be a private file (mode 0600).');
  const config = JSON.parse(await readFile(actual, 'utf8'));
  if (config.mode === 'oauth') return createOAuthAuthentication(config);
  if (config.mode === 'local-token') return createLocalTokenAuthentication(config.token);
  throw new Error('MCP authentication mode must be oauth or local-token.');
}

function bearer(header) {
  if (typeof header !== 'string' || header.length > 16_384) return null;
  return /^Bearer ([^\s]+)$/i.exec(header)?.[1] || null;
}
