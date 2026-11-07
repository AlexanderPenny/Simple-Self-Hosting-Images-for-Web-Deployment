// Copyright 2026 Alexander L. Penny
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Minimal mock identity provider for testing: OIDC (discovery, authorize,
// token with RS256 id_token, userinfo, jwks) and GitHub-style OAuth2
// (/user, /user/emails). The identity handed out next is set by
// POST /set-user with a JSON body. Test use only.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = 8443;
const ISSUER = `https://localhost:${PORT}`;
const CLIENTS = { 'oidc-client': 'oidc-secret', 'oauth-client': 'oauth-secret', 'legacy-client': 'legacy-secret' };

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

let nextUser = { sub: 'u1', email: 'a@example.com', email_verified: true };
const codes = new Map();
const tokens = new Map();

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

function readBody(req) {
  return new Promise((r) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => r(d)); });
}

function clientFrom(req, form) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const [id, secret] = Buffer.from(h.slice(6), 'base64').toString().split(':').map(decodeURIComponent);
    return { id, secret, method: 'basic' };
  }
  return { id: form.get('client_id'), secret: form.get('client_secret'), method: 'post' };
}

https.createServer({
  key: fs.readFileSync(process.argv[2]), cert: fs.readFileSync(process.argv[3]),
}, async (req, res) => {
  const url = new URL(req.url, ISSUER);
  if (url.pathname === '/.well-known/openid-configuration') {
    return json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
  }
  if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });
  if (url.pathname === '/set-user' && req.method === 'POST') {
    nextUser = JSON.parse(await readBody(req));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/authorize') {
    const p = url.searchParams;
    if (!CLIENTS[p.get('client_id')]) return json(res, 400, { error: 'unknown client' });
    if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) return json(res, 400, { error: 'pkce required' });
    const code = crypto.randomBytes(12).toString('hex');
    codes.set(code, {
      client: p.get('client_id'), redirect: p.get('redirect_uri'), nonce: p.get('nonce'),
      challenge: p.get('code_challenge'), scope: p.get('scope') || '', user: nextUser,
    });
    const to = new URL(p.get('redirect_uri'));
    to.searchParams.set('code', code);
    to.searchParams.set('state', p.get('state'));
    res.writeHead(302, { location: to.href });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const c = clientFrom(req, form);
    const entry = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    if (!entry || CLIENTS[c.id] !== c.secret || entry.client !== c.id) return json(res, 400, { error: 'invalid_grant' });
    if (entry.redirect !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri' });
    const verifier = form.get('code_verifier') || '';
    if (crypto.createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) {
      return json(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
    }
    const at = crypto.randomBytes(16).toString('hex');
    tokens.set(at, entry.user);
    const out = { access_token: at, token_type: 'bearer', expires_in: 300 };
    if (entry.scope.split(' ').includes('openid')) {
      const now = Math.floor(Date.now() / 1000);
      const { id, emails, ...claims } = entry.user;
      out.id_token = sign({ iss: ISSUER, aud: c.id, iat: now, exp: now + 300, nonce: entry.nonce, ...claims });
    }
    return json(res, 200, out);
  }
  const bearer = (req.headers.authorization || '').replace(/^Bearer /i, '');
  const user = tokens.get(bearer);
  if (url.pathname === '/userinfo' || url.pathname === '/user') {
    if (!user) return json(res, 401, { error: 'bad token' });
    const { emails, ...rest } = user;
    return json(res, 200, rest);
  }
  if (url.pathname === '/user/emails') {
    if (!user) return json(res, 401, { error: 'bad token' });
    return json(res, 200, user.emails || []);
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log('mock idp up'));
