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
import { q } from './db.js';
import { createSession, authEvents, clientIp } from './auth.js';

/* ------------------------------------------------------------------ *
 * This app is deliberately NOT an identity provider and does not do
 * account signup. OIDC only ever signs a visitor into an ACCOUNT THAT
 * ALREADY EXISTS, matched by email (set with `node scripts/setemail.js`).
 * A provider that lets anyone self-register (or a misconfigured "everyone"
 * group) can therefore never hand out access on its own -- an admin still
 * has to have opted a specific local user in. This is the same shape as
 * pointing Gitea's "OAuth2 / OpenID Connect" authentication source at
 * authentik: the IdP verifies who someone is, the app decides what they
 * can do.
 * ------------------------------------------------------------------ */

const CALLBACK_PATH = '/images/oidc/callback';
export const oidcRedirectUri = () => `${config.publicOrigin}${CALLBACK_PATH}`;

// Discovery is one network round-trip; cache it for the life of the process.
// A failure is not cached, so a transient outage at the IdP does not require
// a restart -- the next login attempt just retries discovery.
let discoveryPromise = null;
function getOidcConfig() {
  if (!discoveryPromise) {
    discoveryPromise = client
      .discovery(new URL(config.oidc.issuerUrl), config.oidc.clientId, config.oidc.clientSecret)
      .catch((err) => { discoveryPromise = null; throw err; });
  }
  return discoveryPromise;
}

/* ------------------------------------------------------------------ *
 * The state/nonce/PKCE verifier generated for one login attempt has to
 * survive the round trip to the identity provider and back. A signed,
 * HttpOnly, short-lived cookie does that without needing a server-side
 * table for something this transient. The HMAC stops a visitor forging a
 * state that would make the callback skip its own checks.
 * ------------------------------------------------------------------ */

const HANDSHAKE_COOKIE = 'apimg_oidc';
const HANDSHAKE_TTL_MS = 10 * 60 * 1000;

function packHandshake(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(json).digest('base64url');
  return `${json}.${mac}`;
}

function unpackHandshake(raw) {
  if (typeof raw !== 'string') return null;
  const idx = raw.lastIndexOf('.');
  if (idx < 1) return null;
  const json = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(json).digest('base64url');
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

export async function startOidcLogin(req, res) {
  const openidConfig = await getOidcConfig();

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  res.cookie(HANDSHAKE_COOKIE, packHandshake({
    codeVerifier, state, nonce, exp: Date.now() + HANDSHAKE_TTL_MS,
  }), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: CALLBACK_PATH,
    maxAge: HANDSHAKE_TTL_MS,
  });

  const url = client.buildAuthorizationUrl(openidConfig, {
    redirect_uri: oidcRedirectUri(),
    scope: config.oidc.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  res.redirect(url.href);
}

export async function finishOidcLogin(req, res) {
  const ip = clientIp(req);

  const handshake = unpackHandshake(req.cookies?.[HANDSHAKE_COOKIE]);
  res.clearCookie(HANDSHAKE_COOKIE, { path: CALLBACK_PATH });

  const deny = (reason, message) => {
    authEvents.failed(ip, `(oidc:${reason})`, reason);
    res.status(403).type('txt').send(message);
  };

  if (!handshake) {
    return deny('handshake_missing_or_expired', 'Sign-in expired. Please try again.');
  }

  let claims;
  try {
    const openidConfig = await getOidcConfig();
    const currentUrl = new URL(req.originalUrl, config.publicOrigin);
    const tokens = await client.authorizationCodeGrant(openidConfig, currentUrl, {
      pkceCodeVerifier: handshake.codeVerifier,
      expectedState: handshake.state,
      expectedNonce: handshake.nonce,
    });
    claims = tokens.claims();
  } catch {
    return deny('exchange_failed', 'Single sign-on failed. Please try again.');
  }

  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) return deny('no_email_claim', 'Your identity provider did not share an email address.');
  // Only reject an email the provider explicitly marked unverified. Some
  // providers (e.g. an authentik user backed by a trusted internal source)
  // omit the claim entirely rather than asserting `true`.
  if (claims.email_verified === false) return deny('email_unverified', 'That email address is not verified.');

  const user = q.userByEmail.get(email);
  if (!user) {
    authEvents.failed(ip, email, 'oidc_no_matching_local_account');
    return res.status(403).type('txt').send(
      'Signed in with your identity provider, but no local account uses that email. '
      + 'Ask the admin to run: node scripts/setemail.js <username> ' + email
    );
  }

  if (!user.oidc_subject) {
    // First SSO sign-in for this account: pin it to this specific provider
    // subject from here on.
    q.setOidcSubject.run(claims.sub, user.id);
  } else if (user.oidc_subject !== claims.sub) {
    // The email matches but the provider's stable subject does not. This is
    // what a second, different IdP account re-using the same address would
    // look like -- refuse rather than silently re-linking.
    authEvents.failed(ip, email, 'oidc_subject_mismatch');
    return deny('subject_mismatch', 'That identity is not linked to this account.');
  }

  authEvents.success(ip, user.username);
  createSession(res, user, req);
  res.redirect('/images');
}
