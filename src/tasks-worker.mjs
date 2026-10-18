import OAuthProvider, { AuthorizationError, CimdFetchError, authorizationErrorRedirect, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createTasksMcpServer } from './tasks-mcp.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function configuration(env) {
  const origin = new URL(env.MCP_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.MCP_ORIGIN || origin.hostname.endsWith('.invalid')) {
    throw new Error('A canonical HTTPS MCP_ORIGIN must be configured.');
  }
  return { origin: origin.origin, resource: `${origin.origin}/mcp` };
}

function loginConfigured(env) {
  return /^\d+$/.test(env.OWNER_GITHUB_ID || '') && Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function consentPage(details, handle, demo) {
  const identity = details.clientDomain
    ? `Client domain: <strong>${escape(details.clientDomain)}</strong>.`
    : 'This client registered itself; its name is not verified.';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>LifeOS task authorization</title><body>
<h1>Allow ${escape(details.clientName)} to access LifeOS tasks?</h1>
<p>${demo ? "Three synthetic records only. No personal tasks or changes are available." : "Private task titles, notes, dates, tags, status and hierarchy. No Projects or Reading content is shared."}</p>
<p>${identity} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>' : ''}
<p>GitHub verifies the one allowed owner using public identity. No repository, email, or private profile permissions are requested.</p>
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">
<label><input type="checkbox" name="scope" value="tasks:read" checked> Read ${demo ? "synthetic" : "private"} tasks (tasks:read)</label>
${!demo && details.requestedScopes.includes("tasks:write") ? '<label><input type="checkbox" name="scope" value="tasks:write" checked> Create, edit, complete, Trash and restore tasks (tasks:write)</label>' : ""}
<p>${demo ? "Access expires in one hour. No refresh token or remembered consent." : "Access tokens expire in one hour. Renewable access uses refresh tokens valid for 30 days. Permanent deletion is unavailable."}</p>
<button name="decision" value="approve">Allow and sign in with GitHub</button>
<button name="decision" value="deny">Deny</button></form></body></html>`;
}

async function s256(verifier) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function authorize(req, env, config, demo) {
  if (!loginConfigured(env)) return json({ error: 'Owner sign-in is not configured.' }, 503);
  const oauth = env.OAUTH_PROVIDER;
  if (req.method === 'GET') {
    const request = await oauth.parseAuthRequest(req);
    // Required resource binding and allowed task permissions are enforced here,
    // not merely advertised by the provider's metadata.
    if (request.resource !== config.resource || request.scope.some((scope) => !['tasks:read', ...(!demo ? ['tasks:write'] : [])].includes(scope)) || !request.scope.includes('tasks:read')) {
      return json({ error: 'Request task permissions for this MCP resource only.' }, 400);
    }
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    consent.headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(consentPage({ ...details, requestedScopes: request.scope }, consent.handle, demo), { headers: consent.headers });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (req.headers.get('origin') !== config.origin) return json({ error: 'Invalid Origin.' }, 403);
  const form = await req.formData();
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(req, String(form.get('handle')));
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(req, String(form.get('handle')), { scope: form.getAll('scope').map(String) });
  if (approved.request.resource !== config.resource || !approved.request.scope.includes('tasks:read') || approved.request.scope.some(scope => !['tasks:read', ...(!demo ? ['tasks:write'] : [])].includes(scope))) {
    return json({ error: 'Only the requested task permissions can be approved.' }, 400);
  }
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${config.origin}/callback`,
    scope: '', state, code_challenge: await s256(verifier), code_challenge_method: 'S256', allow_signup: 'false' }).toString();
  headers.set('Location', url.href);
  return new Response(null, { status: 302, headers });
}

async function callback(req, env, config) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (!loginConfigured(env)) return json({ error: 'Owner sign-in is not configured.' }, 503);
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, data, headers } = await oauth.finishUpstream(req);
  const url = new URL(req.url);
  async function denied() {
    headers.set('Location', authorizationErrorRedirect(original, 'access_denied'));
    return new Response(null, { status: 302, headers });
  }
  if (url.searchParams.has('error') || !url.searchParams.get('code')) return denied();
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
      redirect_uri: `${config.origin}/callback`, code: url.searchParams.get('code'), code_verifier: data.verifier }),
  });
  if (!tokenResponse.ok) return denied();
  const token = await tokenResponse.json();
  // Reject previously granted broader GitHub scopes. We need public identity only.
  if (token.error || typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer' || token.scope !== '') return denied();
  const profileResponse = await fetch('https://api.github.com/user', { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: {
    'Authorization': `Bearer ${token.access_token}`, 'Accept': 'application/vnd.github+json',
    'User-Agent': 'lifeos-synthetic-tasks-mcp', 'X-GitHub-Api-Version': '2022-11-28',
  } });
  if (!profileResponse.ok) return denied();
  const profile = await profileResponse.json();
  if (String(profile.id) !== env.OWNER_GITHUB_ID) return denied();
  const userId = `github-${env.OWNER_GITHUB_ID}`;
  const { redirectTo } = await oauth.completeAuthorization({ request: original, userId, metadata: {},
    scope: original.scope, props: { userId } });
  // The upstream token is never saved in KV, grant props, logs, or MCP results.
  headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers });
}

function createProvider(config, serviceFactory, demo) {
  return new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: { async fetch(req, env, ctx) {
      const owner = `github-${env.OWNER_GITHUB_ID}`;
      if (!loginConfigured(env) || ctx.props?.userId !== owner || ctx.auth?.userId !== owner || ctx.auth?.audience !== config.resource) {
        return json({ error: 'Owner access required.' }, 403);
      }
      if (!ctx.auth.scope.includes('tasks:read')) return insufficientScope(ctx.auth, ['tasks:read']);
      const mcp = createMcpHandler(() => createTasksMcpServer({ service: serviceFactory(env), scopes: ctx.auth.scope, enableWrites: !demo, oauth: true,
        resource: config.resource, demo }), { legacy: 'stateless', maxRequestBodySize: MAX_BODY_BYTES, maxSubscriptions: 0 });
      return mcp.fetch(req);
    } },
    defaultHandler: { async fetch(req, env) {
      const path = new URL(req.url).pathname;
      try {
        if (path === '/authorize') return await authorize(req, env, config, demo);
        if (path === '/callback') return await callback(req, env, config);
        if (path === '/' && req.method === 'GET') return json(demo ? { name: 'LifeOS synthetic tasks MCP', dataset: 'synthetic-demo', taskCount: 3, access: 'read-only', signInConfigured: loginConfigured(env) } :
          { name: 'LifeOS private tasks MCP', access: 'authenticated', signInConfigured: loginConfigured(env) });
        return json({ error: 'Not found.' }, 404);
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo && path === '/authorize' && req.method === 'GET') return Response.redirect(error.redirectTo, 302);
        if (error instanceof AuthorizationError || error instanceof CimdFetchError) return json({ error: 'Authorization expired or could not be verified. Start again from the MCP client.' }, 400);
        return json({ error: 'Owner sign-in failed. Retry from the MCP client.' }, 503);
      }
    } },
    authorizeEndpoint: `${config.origin}/authorize`, tokenEndpoint: `${config.origin}/oauth/token`,
    scopesSupported: ['tasks:read', ...(!demo ? ['tasks:write'] : [])],
    accessTokenTTL: 3600, refreshTokenTTL: demo ? 0 : 30 * 86400,
    clientIdMetadataDocumentEnabled: true,
    onError: () => {}, // Expected failures must not log request/token contents.
    resourceMetadata: { resource: config.resource, authorization_servers: [config.origin], resource_name: demo ? 'LifeOS synthetic tasks' : 'LifeOS private tasks',
      scopes_supported: ['tasks:read', ...(!demo ? ['tasks:write'] : [])],
      bearer_methods_supported: ['header'] },
  });
}

export function createTaskWorker({ serviceFactory, demo = false }) {
  const providers = new Map();
  return {
  async fetch(req, env, ctx) {
    let config;
    try { config = configuration(env); } catch { return json({ error: 'Canonical HTTPS deployment is not configured.' }, 503); }
    const url = new URL(req.url);
    if (url.origin !== config.origin) return json({ error: 'Invalid Host.' }, 403);
    if (url.pathname === '/mcp') {
      if (url.search) return json({ error: 'Query parameters are not supported.' }, 400);
      if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (req.headers.has('origin') && req.headers.get('origin') !== config.origin) return json({ error: 'Invalid Origin.' }, 403);
    } else if (url.pathname.startsWith('/mcp')) return json({ error: 'Not found.' }, 404);
    if (req.body) {
      // Bound all bodies, including OAuth forms and DCR, before the provider parses them.
      const declared = req.headers.get('content-length');
      if (declared && Number(declared) > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
      const reader = req.body.getReader();
      const chunks = []; let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
        chunks.push(value);
      }
      const body = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      req = new Request(req, { body });
    }
    // No assets, proxy to the Mac, credentials in headers, or filesystem data path.
    if (!providers.has(config.origin)) providers.set(config.origin, createProvider(config, serviceFactory, demo));
    try { return await providers.get(config.origin).fetch(req, env, ctx); }
    catch { return json({ error: 'LifeOS task authentication is unavailable.' }, 503); }
  },
};
}
