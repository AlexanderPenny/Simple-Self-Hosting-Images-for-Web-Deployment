# Changelog

## 1.2.0

### Security fixes

Upgrade if you run an earlier version. **Read item 1 before restarting** — a
default changed.

1. **Visitors could fake their IP address on installs not behind Cloudflare
   (high).** `TRUST_CLOUDFLARE` defaulted to `true` and `PROXY_HOPS` to `2`, and
   `deploy/install.sh` set neither. On a server reached directly or through a
   single proxy, any visitor could send their own `CF-Connecting-IP` (or an
   extra `X-Forwarded-For` entry) and choose the address the app logged. That
   got around the login throttle and fail2ban, and let an attacker get
   somebody else's address banned.
   *Fix:* the defaults are now `TRUST_CLOUDFLARE=false` and `PROXY_HOPS=1`. The
   installer asks whether the site is behind Cloudflare and writes both values.
   The Caddyfile and service unit say when the Cloudflare lines apply.
   *If you are behind Cloudflare and relied on the old defaults*, set
   `TRUST_CLOUDFLARE=true` and `PROXY_HOPS=2` (Tunnel → Caddy) before
   upgrading. The supplied `deploy/contactsheet.service` already sets both.

2. **Vulnerable dependencies (critical/high).** The lockfile pinned
   `proxy-addr` 2.0.7 (critical, GHSA-jqcg-44mw-7w3h), `multer` 2.0–2.4 (high:
   several denial-of-service bugs and a file-size-limit bypass),
   `body-parser` < 1.20.9 (high, denial of service) and `qs` ≤ 6.16.0
   (moderate). The lockfile was also out of sync with `package.json`
   (`openid-client` was missing), so `npm ci` failed.
   *Fix:* `express` ^4.22.3 and `multer` ^2.5.0, lockfile regenerated;
   `npm audit` reports 0 vulnerabilities.

3. **Login CSRF (medium).** Every signed-out visitor got the same CSRF token,
   so another site could post a hidden form to `/images/login` and sign a
   visitor's browser in to the attacker's account. Anything the victim then
   uploaded would go to the attacker.
   *Fix:* before sign-in the token is tied to a random per-browser cookie.

4. **No clickjacking protection or Content-Security-Policy (medium).** The
   dashboard could be loaded in an invisible frame on another site, and a
   signed-in user tricked into clicking Publish or Delete.
   *Fix:* pages now send `frame-ancestors 'none'`, `X-Frame-Options: DENY` and a
   strict nonce-based CSP. Scripts and styles only run with that response's
   nonce, so if markup were ever injected, its scripts would not run.

5. **Changing a password left old sessions signed in (low).**
   `scripts/passwd.js` now ends every existing session for that account.

### Single sign-on

* **Any number of providers**, from a JSON file (`OIDC_PROVIDERS_FILE`). Both
  OpenID Connect and plain OAuth2 (GitHub, Discord…) are supported, with
  presets for GitHub, Google, GitLab and Discord. Each provider gets its own
  button, label, colour and icon.
* Per-provider rules: `autoCreate`, `linkByEmail`, `requireVerifiedEmail`,
  `allowedEmails`, `allowedEmailDomains`, `requiredGroups`, and claim
  mapping for providers with unusual field names.
* Links are stored per provider (new `oidc_links` table). Existing links move
  across automatically as provider `default`.
* The `OIDC_*` variables still work exactly as before, including the old
  redirect URI `/images/oidc/callback`.
* Hardening: the handshake cookie names the provider, so a code from one
  provider cannot be replayed at another's callback (mix-up). Config is
  validated strictly at startup: a misspelt setting is an error, not a
  silently ignored line. Secrets can come from an environment variable or a
  file. Providers from the file require a *verified* email before linking an
  account by email (the env-configured provider keeps the old, more lenient
  rule so upgrades don't lock anyone out).
* Errors from single sign-on now appear on the sign-in page instead of a
  plain-text page.
* `PASSWORD_LOGIN=false` for SSO-only installs.
* Full documentation on the project wiki.

### Other changes

* `LIBRARY_MODE=per-user`: each account only sees, edits and deletes its own
  uploads, and private images are only visible to their uploader. Default is
  still `shared`. Use `per-user` whenever SSO creates accounts automatically.
* New look: frosted-glass panels on a soft blue background, rounded corners,
  cyan main buttons. Solid fallbacks when blur is unavailable or reduced
  transparency is requested.
* The "Repeated failed sign-ins will get your IP address banned" notice is
  gone from the sign-in page. Not every install runs fail2ban.
* `scripts/lsusers.js` lists each account's SSO links. `scripts/setemail.js`
  clears all of an account's links when its email changes.
* `deploy/install.sh`: site names with spaces were cut off in the generated
  unit (`Environment=SITE_NAME=My images` became `My`); now quoted.
* `npm run test:sso`: end-to-end SSO test against a throwaway local provider.
* Added `.gitignore`. `package.json` license now matches `LICENSE`
  (Apache-2.0). Removed duplicate database query definitions.
