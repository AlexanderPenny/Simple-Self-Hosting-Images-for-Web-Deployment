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

import * as client from 'openid-client';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, q } from './db.js';
import { authEvents, clientIp, hashPassword } from './auth.js';
import { redirectUri } from './providers.js';

/* ------------------------------------------------------------------ *
 * Single sign-on through any number of providers, each either:
 *
 *   "oidc"   -- OpenID Connect (authentik, Keycloak, Authelia, Google,
 *               GitLab, Microsoft Entra ...). Endpoints come from the
 *               issuer's discovery document; identity comes from the
 *               signed-in user's ID token.
 *   "oauth2" -- plain OAuth 2.0 with a userinfo API (GitHub, Discord ...).
 *               Endpoints are configured by hand; identity comes from
 *               calling the userinfo URL with the access token.
 *
 * Every flow uses the authorization code grant with PKCE and a random
 * state (plus a nonce for OIDC), all bound to the browser by a signed,
 * short-lived cookie.
 *
 * Who gets in is decided here, never by the provider alone:
 *   1. The provider's allow rules (allowedEmails, allowedEmailDomains,
 *      requiredGroups) are checked on every sign-in.
 *   2. A provider account already linked to a local user signs in as that
 *      user. Links are by the provider's permanent subject ID, not email.
 *   3. Otherwise, with linkByEmail (the default), a verified email that
 *      matches a local account (set with scripts/setemail.js) links to it.
 *   4. Otherwise, only with autoCreate on, a new local account is made.
 *   5. Otherwise the sign-in is refused.
 * With the defaults (autoCreate off) a provider that lets anyone register
 * can still never hand out access by itself: an admin has to have opted a
 * specific local user in.
 * ------------------------------------------------------------------ */

// Discovery / client setup is one network round-trip per provider; cache it
// for the life of the process. A failure is not cached, so a provider that
// was briefly down just gets retried on the next sign-in attempt.
const clientConfigs = new Map();

function clientAuth(p) {
  return p.tokenAuthMethod === 'client_secret_post'
    ? client.ClientSecretPost(p.clientSecret)
    : client.ClientSecretBasic(p.clientSecret);
}

function getClientConfig(p) {
  if (!clientConfigs.has(p.id)) {
    const pending = (p.type === 'oidc'
      ? client.discovery(new URL(p.issuer), p.clientId, undefined, clientAuth(p))
      : Promise.resolve(new client.Configuration({
        // Plain OAuth2 has no issuer; the authorization server's origin
        // stands in for it as an identifier only.
        issuer: new URL(p.authorizationUrl).origin,
        authorization_endpoint: p.authorizationUrl,
        token_endpoint: p.tokenUrl,
        userinfo_endpoint: p.userinfoUrl,
      }, p.clientId, undefined, clientAuth(p)))
    ).catch((err) => { clientConfigs.delete(p.id); throw err; });
    clientConfigs.set(p.id, pending);
  }
  return clientConfigs.get(p.id);
}

/* ------------------------------------------------------------------ *
 * The state/nonce/PKCE verifier generated for one sign-in attempt has to
 * survive the round trip to the provider and back. A signed, HttpOnly,
 * short-lived cookie does that without a server-side table for something
 * this transient. The HMAC stops a visitor forging a state that would make
 * the callback skip its own checks, and the provider id inside it stops a
 * code issued by one provider being replayed at another's callback.
 * ------------------------------------------------------------------ */

const HANDSHAKE_COOKIE = 'apimg_oidc';
const HANDSHAKE_PATH = '/images/oidc';
const HANDSHAKE_TTL_MS = 10 * 60 * 1000;

function packHandshake(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(`oidc:${json}`).digest('base64url');
  return `${json}.${mac}`;
}

function unpackHandshake(raw) {
  if (typeof raw !== 'string') return null;
  const idx = raw.lastIndexOf('.');
  if (idx < 1) return null;
  const json = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(`oidc:${json}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && Date.now() <= payload.exp ? payload : null;
  } catch {
    return null;
  }
}

export async function startLogin(p, req, res) {
  const clientConfig = await getClientConfig(p);

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = p.type === 'oidc' ? client.randomNonce() : undefined;

  res.cookie(HANDSHAKE_COOKIE, packHandshake({
    provider: p.id, codeVerifier, state, nonce, exp: Date.now() + HANDSHAKE_TTL_MS,
  }), {
    httpOnly: true,
    secure: config.isProduction,
    // Lax, not Strict: the provider's redirect back here is a cross-site
    // top-level navigation, and Strict would drop the cookie on it.
    sameSite: 'lax',
    path: HANDSHAKE_PATH,
    maxAge: HANDSHAKE_TTL_MS,
  });

  const params = {
    redirect_uri: redirectUri(p),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  };
  if (p.scopes) params.scope = p.scopes;
  if (nonce) params.nonce = nonce;

  res.setHeader('Cache-Control', 'no-store');
  res.redirect(client.buildAuthorizationUrl(clientConfig, params).href);
}

/* ------------------------------------------------------------------ *
 * Reading the identity.
 * ------------------------------------------------------------------ */

function pick(obj, dotted) {
  return dotted.split('.').reduce((v, key) => (v && typeof v === 'object' ? v[key] : undefined), obj);
}

async function getJson(clientConfig, accessToken, url) {
  const response = await client.fetchProtectedResource(
    clientConfig, accessToken, new URL(url), 'GET', undefined,
    new Headers({ accept: 'application/json' })
  );
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.json();
}

async function readIdentity(p, clientConfig, tokens) {
  let claims;
  if (p.type === 'oidc') {
    claims = { ...tokens.claims() };
    if (p.useUserinfo) {
      // fetchUserInfo checks the userinfo "sub" matches the ID token's.
      const info = await client.fetchUserInfo(clientConfig, tokens.access_token, claims.sub);
      claims = { ...claims, ...info, sub: claims.sub };
    }
  } else {
    claims = await getJson(clientConfig, tokens.access_token, p.userinfoUrl);
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      throw new Error('userinfo did not return a JSON object');
    }
  }

  const c = p.claims;
  const rawSubject = pick(claims, c.subject);
  const subject = (typeof rawSubject === 'string' || typeof rawSubject === 'number') ? String(rawSubject) : '';

  const rawEmail = pick(claims, c.email);
  let email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const rawVerified = pick(claims, c.emailVerified);
  // Some providers (AWS Cognito, for one) send the flag as a string.
  let verified = rawVerified === true || rawVerified === 'true';
  let explicitlyUnverified = rawVerified === false || rawVerified === 'false';

  if (p.emailsUrl) {
    // GitHub-style: a list of { email, primary, verified }. Use the primary
    // address if it is verified, else any verified one.
    const list = await getJson(clientConfig, tokens.access_token, p.emailsUrl);
    if (Array.isArray(list)) {
      const ok = list.filter((e) => e && typeof e.email === 'string' && e.verified === true);
      const chosen = ok.find((e) => e.primary) || ok[0];
      if (chosen) {
        email = chosen.email.trim().toLowerCase();
        verified = true;
        explicitlyUnverified = false;
      } else {
        // Only unverified addresses: keep one, so the refusal can say why.
        const any = list.find((e) => e && typeof e.email === 'string' && e.primary)
          || list.find((e) => e && typeof e.email === 'string');
        if (any) email = any.email.trim().toLowerCase();
        verified = false;
        explicitlyUnverified = true;
      }
    }
  }

  const rawGroups = pick(claims, c.groups);
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g) => typeof g === 'string')
    : (typeof rawGroups === 'string' ? [rawGroups] : []);

  const rawUsername = pick(claims, c.username);
  const rawName = pick(claims, c.name);

  return {
    subject,
    email,
    verified,
    explicitlyUnverified,
    groups,
    username: typeof rawUsername === 'string' ? rawUsername : '',
    name: typeof rawName === 'string' ? rawName : '',
  };
}

/* ------------------------------------------------------------------ *
 * Accounts.
 * ------------------------------------------------------------------ */

const USERNAME_OK = /^[A-Za-z0-9._-]{2,64}$/;

// SSO-created accounts still need a password hash for the column. It is a
// random value nobody knows, so the account can only sign in through SSO
// (until an admin sets a real password with scripts/passwd.js).
const createUserWithLink = db.transaction((username, email, p, subject) => {
  const now = Date.now();
  const info = q.insertUser.run(username, hashPassword(crypto.randomBytes(32).toString('hex')), email, now);
  q.insertLink.run(p.id, subject, info.lastInsertRowid, now);
  return q.userById.get(info.lastInsertRowid);
});

function provision(p, identity, email) {
  const base = (identity.username || (identity.email && identity.email.split('@')[0]) || identity.name || p.id)
    .replace(/[^A-Za-z0-9._-]+/g, '')
    .slice(0, 56);
  const start = USERNAME_OK.test(base) ? base : `${p.id}-user`;
  for (let n = 1; n <= 50; n += 1) {
    const username = n === 1 ? start : `${start}${n}`;
    try {
      return createUserWithLink(username, email, p, identity.subject);
    } catch (err) {
      if (!/UNIQUE/i.test(String(err.message))) throw err;
    }
  }
  throw new Error('Could not find a free username for a new single sign-on account.');
}

/* ------------------------------------------------------------------ *
 * The callback. Returns { user } on success or { status, message } to show
 * on the sign-in page; server.js renders either.
 * ------------------------------------------------------------------ */

export async function finishLogin(p, req, res) {
  const ip = clientIp(req);
  const handshake = unpackHandshake(req.cookies?.[HANDSHAKE_COOKIE]);
  res.clearCookie(HANDSHAKE_COOKIE, { path: HANDSHAKE_PATH });

  const deny = (reason, message, who = `(sso:${p.id})`) => {
    authEvents.failed(ip, who, `sso_${reason}`);
    return { status: 403, message };
  };

  if (!handshake || handshake.provider !== p.id) {
    return deny('handshake_missing_or_expired', 'That sign-in expired. Please try again.');
  }

  let identity;
  try {
    const clientConfig = await getClientConfig(p);
    const currentUrl = new URL(req.originalUrl, config.publicOrigin);
    const tokens = await client.authorizationCodeGrant(clientConfig, currentUrl, {
      pkceCodeVerifier: handshake.codeVerifier,
      expectedState: handshake.state,
      expectedNonce: handshake.nonce,
      idTokenExpected: p.type === 'oidc',
    });
    identity = await readIdentity(p, clientConfig, tokens);
  } catch (err) {
    console.error(`[sso:${p.id}] sign-in failed:`, err?.message || err);
    return deny('exchange_failed', 'Single sign-on failed. Please try again.');
  }

  if (!identity.subject || identity.subject.length > 255) {
    return deny('no_subject', 'Your sign-in provider did not say which account you are.');
  }

  // An email counts only if it is verified -- or, with requireVerifiedEmail
  // off, as long as the provider did not explicitly say it is unverified.
  const usableEmail = identity.email && (identity.verified
    || (!p.requireVerifiedEmail && !identity.explicitlyUnverified))
    ? identity.email : '';
  const who = usableEmail || identity.email || `(sso:${p.id})`;

  if (p.allowedEmails.length || p.allowedEmailDomains.length) {
    const domain = usableEmail.slice(usableEmail.lastIndexOf('@') + 1);
    const allowed = usableEmail
      && (p.allowedEmails.includes(usableEmail) || p.allowedEmailDomains.includes(domain));
    if (!allowed) return deny('email_not_allowed', 'That account is not allowed to sign in here.', who);
  }
  if (p.requiredGroups.length && !identity.groups.some((g) => p.requiredGroups.includes(g))) {
    return deny('group_not_allowed', 'That account is not in a group allowed to sign in here.', who);
  }

  // 1. Already linked.
  const link = q.linkBySubject.get(p.id, identity.subject);
  if (link) {
    const user = q.userById.get(link.user_id);
    if (!user || user.disabled) return deny('account_disabled', 'That account is disabled.', who);
    authEvents.success(ip, `${user.username} (sso:${p.id})`);
    return { user };
  }

  // 2. Link to an existing account by verified email.
  const byEmail = usableEmail ? q.userByEmailAny.get(usableEmail) : null;
  if (byEmail && p.linkByEmail) {
    if (byEmail.disabled) return deny('account_disabled', 'That account is disabled.', who);
    if (q.linkForUser.get(byEmail.id, p.id)) {
      // The email matches but a DIFFERENT account at this provider is already
      // linked. That is what someone re-using the address on a second
      // provider account looks like -- refuse rather than silently re-link.
      return deny('subject_mismatch', 'That sign-in is not the one linked to this account.', who);
    }
    q.insertLink.run(p.id, identity.subject, byEmail.id, Date.now());
    authEvents.success(ip, `${byEmail.username} (sso:${p.id}, newly linked)`);
    return { user: byEmail };
  }

  // 3. Create an account.
  if (p.autoCreate) {
    // Give the new account the email only if no other account has it, so the
    // unique email index can never be tripped by a sign-in.
    const user = provision(p, identity, usableEmail && !byEmail ? usableEmail : null);
    authEvents.success(ip, `${user.username} (sso:${p.id}, account created)`);
    return { user };
  }

  // 4. Nothing to sign in to.
  if (identity.email && !usableEmail) {
    return deny('email_unverified', 'Your sign-in provider did not confirm that your email address is verified.', who);
  }
  if (!usableEmail) {
    return deny('no_email', 'Your sign-in provider did not share an email address.', who);
  }
  return deny('no_matching_account',
    `Signed in, but there is no account here for ${usableEmail}. Ask the admin to link it.`, who);
}
