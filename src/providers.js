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

import fs from 'node:fs';
import { config } from './config.js';

/* ------------------------------------------------------------------ *
 * Sign-in providers.
 *
 * Every provider ends up as one normalised object, whichever way it was
 * configured:
 *
 *  1. OIDC_PROVIDERS_FILE -- a JSON file with any number of providers:
 *       { "providers": [ { "id": "authentik", "type": "oidc", ... }, ... ] }
 *     Full reference: the project wiki, "Provider configuration", and
 *     deploy/oidc-providers.example.json.
 *
 *  2. The OIDC_ISSUER_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET variables --
 *     the single-provider setup from earlier versions. It becomes provider
 *     "default" and keeps its original addresses (/images/oidc/login and
 *     /images/oidc/callback) so an existing redirect URI keeps working.
 *
 * Validation is strict on purpose. A typo such as "autocreate" for
 * "autoCreate" would otherwise be silently ignored, and in an auth
 * config a silently ignored line is a security bug waiting to happen.
 * Any problem stops the app at startup with a message naming the field.
 * ------------------------------------------------------------------ */

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CLAIM_RE = /^[A-Za-z0-9_:\-]+(?:\.[A-Za-z0-9_:\-]+)*$/;

// Ready-made settings for common providers. Anything set in the file wins
// over the preset, so a preset is only ever a starting point.
export const PRESETS = {
  github: {
    type: 'oauth2',
    label: 'Sign in with GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    // /user only shows an address the person made public; this lists all
    // of them with their verified flag, so the app can pick a verified one.
    emailsUrl: 'https://api.github.com/user/emails',
    scopes: 'read:user user:email',
    tokenAuthMethod: 'client_secret_post',
    claims: { subject: 'id', email: 'email', username: 'login', name: 'name' },
    color: '#24292f',
  },
  discord: {
    type: 'oauth2',
    label: 'Sign in with Discord',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userinfoUrl: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
    claims: { subject: 'id', email: 'email', emailVerified: 'verified', username: 'username', name: 'global_name' },
    color: '#5865f2',
  },
  google: {
    type: 'oidc',
    label: 'Sign in with Google',
    issuer: 'https://accounts.google.com',
    color: '#ffffff',
    textColor: '#1f1f1f',
  },
  gitlab: {
    type: 'oidc',
    label: 'Sign in with GitLab',
    issuer: 'https://gitlab.com',
    color: '#fc6d26',
  },
};

const KEYS = new Set([
  'id', 'preset', 'type', 'label', 'icon', 'color', 'textColor',
  'clientId', 'clientSecret', 'clientSecretEnv', 'clientSecretFile', 'tokenAuthMethod',
  'scopes', 'issuer', 'useUserinfo',
  'authorizationUrl', 'tokenUrl', 'userinfoUrl', 'emailsUrl',
  'claims', 'requireVerifiedEmail', 'linkByEmail', 'autoCreate',
  'allowedEmails', 'allowedEmailDomains', 'requiredGroups',
]);
const CLAIM_KEYS = new Set(['subject', 'email', 'emailVerified', 'username', 'name', 'groups']);
const DEFAULT_CLAIMS = {
  subject: 'sub', email: 'email', emailVerified: 'email_verified',
  username: 'preferred_username', name: 'name', groups: 'groups',
};

class ConfigError extends Error {}

function fail(where, message) {
  throw new ConfigError(`Sign-in provider config, ${where}: ${message}`);
}

function httpsUrl(where, field, value) {
  if (typeof value !== 'string' || !value) fail(where, `"${field}" is required.`);
  let u;
  try { u = new URL(value); } catch { fail(where, `"${field}" is not a valid URL.`); }
  // Tokens and secrets travel over these. openid-client refuses plain HTTP
  // too, but saying so here gives a clearer message at startup.
  if (u.protocol !== 'https:') fail(where, `"${field}" must start with https://.`);
  return value;
}

function stringList(where, field, value, transform = (x) => x) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.trim())) {
    fail(where, `"${field}" must be a list of strings.`);
  }
  return value.map((v) => transform(v.trim()));
}

function bool(where, field, value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(where, `"${field}" must be true or false.`);
  return value;
}

function readSecret(where, raw) {
  const given = ['clientSecret', 'clientSecretEnv', 'clientSecretFile'].filter((k) => raw[k] !== undefined);
  if (given.length !== 1) {
    fail(where, 'set exactly one of "clientSecret", "clientSecretEnv" or "clientSecretFile".');
  }
  let secret;
  if (raw.clientSecretEnv !== undefined) {
    secret = process.env[raw.clientSecretEnv];
    if (!secret) fail(where, `environment variable ${raw.clientSecretEnv} (clientSecretEnv) is empty or not set.`);
  } else if (raw.clientSecretFile !== undefined) {
    try {
      secret = fs.readFileSync(String(raw.clientSecretFile), 'utf8').trim();
    } catch (err) {
      fail(where, `could not read clientSecretFile ${raw.clientSecretFile} (${err.code || err.message}).`);
    }
    if (!secret) fail(where, `clientSecretFile ${raw.clientSecretFile} is empty.`);
  } else {
    secret = raw.clientSecret;
    if (typeof secret !== 'string' || !secret) fail(where, '"clientSecret" must be a non-empty string.');
  }
  return secret;
}

function normalise(input, index) {
  let where = `provider #${index + 1}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(where, 'must be an object.');

  for (const key of Object.keys(input)) {
    // Keys starting with "_" are free for comments; JSON has none of its own.
    if (!key.startsWith('_') && !KEYS.has(key)) fail(where, `unknown setting "${key}".`);
  }

  let preset = {};
  if (input.preset !== undefined) {
    preset = PRESETS[input.preset];
    if (!preset) fail(where, `unknown preset "${input.preset}". Known: ${Object.keys(PRESETS).join(', ')}.`);
  }
  const raw = { ...preset, ...input, claims: { ...(preset.claims || {}), ...(input.claims || {}) } };

  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
    fail(where, '"id" is required: 1-32 lowercase letters, digits, "-" or "_", starting with a letter or digit.');
  }
  where = `provider "${raw.id}"`;
  if (raw.id === 'default') fail(where, '"default" is reserved for the OIDC_* environment variables.');

  const type = raw.type || 'oidc';
  if (!['oidc', 'oauth2'].includes(type)) fail(where, '"type" must be "oidc" or "oauth2".');

  if (typeof raw.clientId !== 'string' || !raw.clientId) fail(where, '"clientId" is required.');

  const tokenAuthMethod = raw.tokenAuthMethod || 'client_secret_basic';
  if (!['client_secret_basic', 'client_secret_post'].includes(tokenAuthMethod)) {
    fail(where, '"tokenAuthMethod" must be "client_secret_basic" or "client_secret_post".');
  }

  if (raw.label !== undefined && (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 60)) {
    fail(where, '"label" must be 1-60 characters.');
  }
  for (const f of ['color', 'textColor']) {
    if (raw[f] !== undefined && (typeof raw[f] !== 'string' || !COLOR_RE.test(raw[f]))) {
      fail(where, `"${f}" must be a hex colour such as "#0b306e".`);
    }
  }
  if (raw.icon !== undefined) {
    // An https URL or a path on this site. Nothing else, so the attribute can
    // never carry a javascript: or data: payload.
    const ok = typeof raw.icon === 'string'
      && (/^\/[^/\\]/.test(raw.icon) || /^https:\/\//i.test(raw.icon))
      && !/["'<>\s]/.test(raw.icon);
    if (!ok) fail(where, '"icon" must be an https:// URL or a path starting with "/".');
  }

  if (raw.scopes !== undefined && (typeof raw.scopes !== 'string' || !raw.scopes.trim())) {
    fail(where, '"scopes" must be a space-separated string.');
  }

  for (const key of Object.keys(raw.claims)) {
    if (!CLAIM_KEYS.has(key)) fail(where, `unknown claim mapping "claims.${key}".`);
    if (typeof raw.claims[key] !== 'string' || !CLAIM_RE.test(raw.claims[key])) {
      fail(where, `"claims.${key}" must be a claim name, optionally dotted (e.g. "realm_access.roles").`);
    }
  }

  const p = {
    id: raw.id,
    type,
    label: (raw.label || `Sign in with ${raw.id}`).trim(),
    icon: raw.icon || null,
    color: raw.color || null,
    textColor: raw.textColor || null,
    clientId: raw.clientId,
    clientSecret: readSecret(where, raw),
    tokenAuthMethod,
    scopes: (raw.scopes || (type === 'oidc' ? 'openid email profile' : '')).trim(),
    claims: { ...DEFAULT_CLAIMS, ...raw.claims },
    requireVerifiedEmail: bool(where, 'requireVerifiedEmail', raw.requireVerifiedEmail, true),
    linkByEmail: bool(where, 'linkByEmail', raw.linkByEmail, true),
    autoCreate: bool(where, 'autoCreate', raw.autoCreate, false),
    allowedEmails: stringList(where, 'allowedEmails', raw.allowedEmails, (v) => v.toLowerCase()),
    allowedEmailDomains: stringList(where, 'allowedEmailDomains', raw.allowedEmailDomains,
      (v) => v.toLowerCase().replace(/^@/, '')),
    requiredGroups: stringList(where, 'requiredGroups', raw.requiredGroups),
    loginPath: `/images/oidc/${raw.id}/login`,
    callbackPath: `/images/oidc/${raw.id}/callback`,
  };

  if (type === 'oidc') {
    // No trailing-slash normalisation: discovery requires the issuer the
    // provider returns to match this value byte-for-byte, and some
    // providers (authentik, for one) always end theirs with "/".
    p.issuer = httpsUrl(where, 'issuer', raw.issuer);
    p.useUserinfo = bool(where, 'useUserinfo', raw.useUserinfo, false);
    for (const f of ['authorizationUrl', 'tokenUrl', 'userinfoUrl', 'emailsUrl']) {
      if (raw[f] !== undefined) fail(where, `"${f}" is only for "type": "oauth2" (an OIDC provider is found through its issuer).`);
    }
    if (!p.scopes.split(/\s+/).includes('openid')) fail(where, '"scopes" must include "openid" for an OIDC provider.');
  } else {
    p.authorizationUrl = httpsUrl(where, 'authorizationUrl', raw.authorizationUrl);
    p.tokenUrl = httpsUrl(where, 'tokenUrl', raw.tokenUrl);
    p.userinfoUrl = httpsUrl(where, 'userinfoUrl', raw.userinfoUrl);
    p.emailsUrl = raw.emailsUrl !== undefined ? httpsUrl(where, 'emailsUrl', raw.emailsUrl) : null;
    if (raw.issuer !== undefined) fail(where, '"issuer" is only for "type": "oidc".');
    if (raw.useUserinfo !== undefined) fail(where, '"useUserinfo" is only for "type": "oidc" (OAuth2 always uses userinfoUrl).');
    // A plain OAuth2 provider has no "sub" claim; there is no safe default
    // for which field is the stable account ID.
    if (raw.claims.subject === undefined) {
      fail(where, '"claims.subject" is required for OAuth2: the field holding the account\'s permanent ID (e.g. "id").');
    }
  }
  return p;
}

function fromEnv() {
  if (!config.oidc.enabled) return null;
  return {
    id: 'default',
    type: 'oidc',
    label: config.oidc.buttonLabel,
    icon: null,
    color: null,
    textColor: null,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    tokenAuthMethod: 'client_secret_basic',
    scopes: config.oidc.scopes,
    issuer: config.oidc.issuerUrl,
    useUserinfo: false,
    claims: { ...DEFAULT_CLAIMS },
    // Earlier versions only refused an email the provider explicitly marked
    // unverified. Kept as-is for this provider so an upgrade cannot lock
    // anyone out; file-configured providers default to the stricter rule.
    requireVerifiedEmail: false,
    linkByEmail: true,
    autoCreate: false,
    allowedEmails: [],
    allowedEmailDomains: [],
    requiredGroups: [],
    loginPath: '/images/oidc/login',
    callbackPath: '/images/oidc/callback',
  };
}

function fromFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`OIDC_PROVIDERS_FILE ${file} could not be read (${err.code || err.message}).`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`OIDC_PROVIDERS_FILE ${file} is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.providers;
  if (!Array.isArray(list)) {
    throw new ConfigError(`OIDC_PROVIDERS_FILE ${file} must contain {"providers": [ ... ]}.`);
  }
  const out = list.map(normalise);

  // A secret written straight into a file other users can read is a leak.
  try {
    const mode = fs.statSync(file).mode;
    if ((mode & 0o004) && list.some((r) => r && r.clientSecret !== undefined)) {
      console.warn(`[providers] WARNING: ${file} is world-readable and contains a clientSecret. `
        + 'Run chmod 640 on it, or move the secret to clientSecretEnv / clientSecretFile.');
    }
  } catch { /* stat failing here is not worth refusing to start over */ }
  return out;
}

function load() {
  const list = [];
  const env = fromEnv();
  if (env) list.push(env);
  if (config.oidcProvidersFile) list.push(...fromFile(config.oidcProvidersFile));

  const seen = new Set();
  for (const p of list) {
    if (seen.has(p.id)) throw new ConfigError(`Sign-in provider config: the id "${p.id}" is used twice.`);
    seen.add(p.id);
  }

  /* The OAuth redirect_uri must be a fixed address the app itself controls,
     never one built from the request's Host header. If it were request-
     derived, a forged Host header could send the authorization code
     somewhere else and hijack the login. PUBLIC_ORIGIN is the only source
     for it, so single sign-on refuses to start without one. */
  if (list.length && !config.publicOrigin) {
    throw new ConfigError(
      'Single sign-on is configured but PUBLIC_ORIGIN is not set. Set PUBLIC_ORIGIN, e.g. '
      + 'https://example.com -- each provider\'s redirect URI is built from it and must '
      + 'exactly match the one registered with that provider.'
    );
  }

  for (const p of list) {
    if (p.autoCreate && config.libraryMode === 'shared') {
      console.warn(`[providers] WARNING: provider "${p.id}" has autoCreate on while LIBRARY_MODE=shared. `
        + 'Every account it creates can see, change and delete EVERY image. '
        + 'Set LIBRARY_MODE=per-user unless that is really what you want.');
    }
    if (p.autoCreate && !p.allowedEmails.length && !p.allowedEmailDomains.length && !p.requiredGroups.length) {
      console.warn(`[providers] WARNING: provider "${p.id}" has autoCreate on with no allowedEmails, `
        + 'allowedEmailDomains or requiredGroups. ANYONE who can sign in to that provider gets an '
        + 'account here. That is only safe if the provider itself restricts who can use this app.');
    }
    if (p.type === 'oauth2' && !p.requireVerifiedEmail) {
      console.warn(`[providers] WARNING: provider "${p.id}" has requireVerifiedEmail off. An address `
        + 'the provider never checked can then be used to sign in to the local account that has it.');
    }
  }
  return list;
}

export const providers = load();
export const providerById = (id) => providers.find((p) => p.id === id) || null;
export const redirectUri = (p) => `${config.publicOrigin}${p.callbackPath}`;
