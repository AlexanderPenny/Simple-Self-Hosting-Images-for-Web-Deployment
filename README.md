# contactsheet

A small self-hosted image host. Upload an image, get a short address you can
paste anywhere:

```
https://example.com/images/kivuhRjaTZ
```

<img width="1263" height="964" alt="image" src="https://apenny.me.uk/images/Yd4pKEK76f.png" />

The admin panel lives at `/images` behind a login. The images themselves are
served from `/images/<id>` with no authentication — unless you mark them
private, which you can do per image.

<img width="1263" height="964" alt="image" src="https://apenny.me.uk/images/Hfr8kaxPq6.png" />

Built for a Raspberry Pi sitting behind Caddy, but nothing in it is Pi-specific.

---

## What you get

* **Short unguessable addresses.** 10 random characters from a 57-character
alphabet — about 3.6 × 10¹⁷ combinations.
* **Titles and search.** Name each image, then find it by title, filename or ID.
* **Per-image visibility.** Public by default; flip any image to private and
only a signed-in session can load it.
* **Brute-force protection.** Failed logins are written to a dedicated log in a
format fail2ban parses, with ready-made filters and jails included.
* **Split storage.** Point the image store at a USB disk while the database
stays on the system disk — worth doing if you are running from an SD card.
* **No build step, few dependencies.** Express, multer, better-sqlite3,
cookie-parser. Server-rendered HTML, no framework, no bundler.
* **Single sign-on, as many providers as you like.** Any OpenID Connect
provider (authentik, Keycloak, Authelia, Google, GitLab, Microsoft Entra…) and
plain OAuth2 ones like GitHub and Discord, each with its own button. Accounts
are linked by email, or created on first sign-in if you allow it, with
per-provider rules on who may sign in. See the [wiki](https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment/wiki/Single-sign-on).
* **Shared or per-user libraries.** One library for a few trusted people, or
each account sees and manages only its own uploads.
* **A clean, light look.** Frosted-glass panels on a soft blue background,
with solid fallbacks when the browser or visitor turns transparency off.

---

## Requirements

* Node.js 20 or newer
* A reverse proxy that terminates TLS (Caddy, nginx, Cloudflare Tunnel…)
* Linux with systemd, if you want the supplied service unit
* fail2ban, optional but recommended

---

## Quick start

```bash
git clone https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment.git contactsheet
cd contactsheet
npm install --omit=dev

SESSION_SECRET=$(openssl rand -base64 48) \
DATA_DIR=./data \
npm start
```

Create a user in a second terminal, then open [http://localhost:3021/images](http://localhost:3021/images):

```bash
DATA_DIR=./data node scripts/adduser.js yourname
```

That is enough to try it. For a real deployment, keep reading.

---

## Production install

The installer creates a service user, directories, a session secret and a
systemd unit:

```bash
sudo bash deploy/install.sh
```

It asks for your domain, install path and (optionally) a separate disk for the
image store, then prints the remaining reverse-proxy and fail2ban steps.

If you would rather do it by hand, `deploy/install.sh` is short and readable —
follow along with it.

### Reverse proxy

Caddy, merged into your existing site block:

```
example.com {
	handle /images* {
		request_body {
			max_size 15MB
		}
		reverse_proxy 127.0.0.1:3021
	}

	# ... your existing routes ...
}
```

Put this **above** any catch-all route, or the catch-all wins and `/images`
never reaches the app.

Behind Cloudflare, pass the real visitor address through so bans hit the right
IP, and set `TRUST_CLOUDFLARE=true` (plus `PROXY_HOPS=2` for a Cloudflare
Tunnel → Caddy setup):

```
	reverse_proxy 127.0.0.1:3021 {
		header_up CF-Connecting-IP {header.CF-Connecting-IP}
	}
```

**Only do this if the server cannot be reached except through Cloudflare.**
Otherwise anyone can send their own `CF-Connecting-IP` header and choose the
address that gets logged — dodging bans, or getting someone else banned.

nginx equivalent:

```nginx
location /images {
	proxy_pass http://127.0.0.1:3021;
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
	client_max_body_size 15M;
}
```

### fail2ban

```bash
sudo cp deploy/filter-contactsheet.conf       /etc/fail2ban/filter.d/contactsheet.conf
sudo cp deploy/filter-contactsheet-probe.conf /etc/fail2ban/filter.d/contactsheet-probe.conf
sudo cp deploy/jail.d-contactsheet.local      /etc/fail2ban/jail.d/contactsheet.local
```

**Edit the jail file before starting it.** Two things matter:

1. Add your own IP to `ignoreip`, or a few mistyped passwords will lock you out.
2. Set `banaction`. The default `iptables-multiport` is right for a directly
exposed origin. **Behind Cloudflare Tunnel it will silently do nothing**,
because every connection arrives from localhost — use `cloudflare-zone`
instead.

Then:

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status contactsheet
```

Verify the filter matches your actual logs before trusting it:

```bash
sudo fail2ban-regex /var/lib/contactsheet/log/auth.log \
  /etc/fail2ban/filter.d/contactsheet.conf
```

|Jail|Watches|Trigger|Ban|
|-|-|-|-|
|`contactsheet`|app auth log|5 failed logins in 10 min|4 h, doubling on repeat, max 1 week|
|`contactsheet-probe`|proxy access log|20 × 401/403/404 on `/images*` in 5 min|2 h|

The app also throttles in-process: after 10 failures from one IP in 15 minutes
it stops checking passwords entirely and returns 429, so a burst cannot burn CPU
on password hashing in the seconds before fail2ban reacts.

---

## Configuration

Everything is environment variables. In production put `SESSION_SECRET` in a
file readable only by root, e.g. `/etc/contactsheet.env`.

|Variable|Default|Meaning|
|-|-|-|
|`SESSION_SECRET`|*(required)*|HMAC key for session cookies. `openssl rand -base64 48`|
|`PORT`|`3021`|Port to listen on|
|`BIND_HOST`|`127.0.0.1`|Keep on loopback so only the proxy can reach it|
|`PUBLIC_ORIGIN`|*(derived)*|e.g. `https://example.com`. Derived from the request if unset|
|`SITE_NAME`|`Image store`|Shown on the login page and in page titles|
|`DATA_DIR`|`/var/lib/contactsheet`|Database and logs|
|`STORE_DIR`|`$DATA_DIR/store`|Image files. Point at a separate disk if you like|
|`REQUIRE_STORE_MARKER`|`false`|Refuse to start if the store is not mounted|
|`MAX_UPLOAD_BYTES`|`12582912`|Per-file limit (12 MB)|
|`MAX_FILES_PER_UPLOAD`|`10`|Files per submission|
|`ID_LENGTH`|`10`|Characters in a generated ID|
|`TRUST_PROXY`|`true`|Read the client IP from proxy headers|
|`PROXY_HOPS`|`1`|Proxies in front. Caddy alone is 1; Cloudflare Tunnel → Caddy is 2. **Never higher than the real number** (was `2` before 1.2)|
|`TRUST_CLOUDFLARE`|`false`|Use `CF-Connecting-IP`. **Only set true if the origin cannot be reached without Cloudflare** (was `true` before 1.2)|
|`LOGIN_MAX_ATTEMPTS`|`10`|In-process throttle threshold|
|`LIBRARY_MODE`|`shared`|`shared`: every account sees and manages every image. `per-user`: each account only its own, and private images only to their uploader|
|`PASSWORD_LOGIN`|`true`|`false` hides the username/password form, for SSO-only installs|
|`OIDC_PROVIDERS_FILE`|*(unset)*|JSON file listing any number of SSO providers. See the [provider reference](https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment/wiki/Provider-configuration)|
|`OIDC_ISSUER_URL`|*(unset)*|One OIDC provider without a file (the pre-1.2 way). Issuer URL, e.g. `https://auth.example.com/application/o/contactsheet/`|
|`OIDC_CLIENT_ID`|*(unset)*|Client ID for that provider|
|`OIDC_CLIENT_SECRET`|*(unset)*|Client secret for that provider|
|`OIDC_SCOPES`|`openid email profile`|Scopes requested from that provider|
|`OIDC_BUTTON_LABEL`|`Single sign-on`|Text on that provider's button|

---

## Managing users

```bash
node scripts/adduser.js alice     # create
node scripts/passwd.js alice      # change password
node scripts/lsusers.js           # list, with each account's SSO links
node scripts/setemail.js alice alice@example.com   # let alice link SSO by that email
```

Run these as the service user in production:

```bash
cd /opt/contactsheet
sudo -u contactsheet node scripts/adduser.js alice
```

Changing a password signs that account out everywhere. Changing or removing an
email with `setemail.js` also removes the account's SSO links, so it re-links
by the new address next time.

There is no signup page and no password reset by design — this is meant for a
handful of people you know. (Single sign-on can create accounts on first
sign-in if you switch that on per provider.)

---

## Single sign-on

Password login works on its own. On top of it — or instead of it, with
`PASSWORD_LOGIN=false` — you can add any number of sign-in providers, each
with its own button:

* **OpenID Connect:** authentik, Keycloak, Authelia, Pocket ID, Zitadel,
  Google, GitLab, Microsoft Entra ID, Okta, Auth0…
* **Plain OAuth2:** GitHub, Discord, or anything with a userinfo endpoint.

They go in a JSON file named by `OIDC_PROVIDERS_FILE`:

```json
{
  "providers": [
    {
      "id": "authentik",
      "label": "Sign in with authentik",
      "issuer": "https://auth.example.com/application/o/contactsheet/",
      "clientId": "…",
      "clientSecretEnv": "AUTHENTIK_CLIENT_SECRET"
    },
    { "id": "github", "preset": "github", "clientId": "…", "clientSecretEnv": "GITHUB_CLIENT_SECRET" }
  ]
}
```

Register `<PUBLIC_ORIGIN>/images/oidc/<id>/callback` as the redirect URI at
each provider. `PUBLIC_ORIGIN` must be set; the app refuses to start without
it, because a redirect URI built from the request's `Host` header could be
forged to send the login somewhere else.

**Who gets in is up to you, per provider.** By default SSO only signs people in
to accounts that already exist here, matched by a *verified* email you set
with `scripts/setemail.js`, so a provider that lets anyone register can
never hand out access by itself. You can also switch on `autoCreate` and limit it
with `allowedEmails`, `allowedEmailDomains` or `requiredGroups`. After the
first sign-in an account is pinned to that provider's permanent subject ID,
so a reassigned email cannot take it over.

The old single-provider variables (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`) still work, and keep their old redirect URI
`<PUBLIC_ORIGIN>/images/oidc/callback`.

**Full documentation is on the wiki:**
[Single sign-on](https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment/wiki/Single-sign-on) ·
[Provider configuration](https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment/wiki/Provider-configuration) ·
[Provider guides](https://github.com/AlexanderPenny/Simple-Self-Hosting-Images-for-Web-Deployment/wiki/Provider-guides) (authentik, Keycloak, Authelia, Google,
GitLab, Microsoft Entra, GitHub, Discord).

---

## Storing images on a separate disk

Image writes are almost all of the write volume, and SD cards wear out. Put the
store on a USB disk and leave the small database on the system disk:

```bash
sudo bash deploy/setup-store.sh /mnt/storage
```

That creates the directory, sets ownership, and writes a `.store-ok` marker.

**The marker is not decoration.** If the disk is not mounted, `STORE_DIR` still
exists as an empty directory on the system disk underneath. Without the marker
the service would start, write images to the wrong disk, and appear to lose them
when the drive came back. With `REQUIRE_STORE_MARKER=true` it refuses to start
instead.

Add the disk to `/etc/fstab` with `nofail` so it remounts on boot without
blocking it:

```
UUID=xxxx-xxxx  /mnt/storage  ext4  defaults,nofail,x-systemd.device-timeout=10  0  2
```

Use a filesystem with POSIX ownership — ext4 is fine, exFAT and NTFS are not.

---

## Public and private images

Public is the default: anyone with the address can view it, and the response is
cached hard since content at a given ID never changes.

Private images require a signed-in session. To anyone else the address returns a
404 that is byte-identical to the response for an ID that was never issued —
headers included — so the endpoint cannot be used to discover which IDs exist.

Worth knowing:

* **A CDN may already hold a copy.** Flipping an image from public to private
stops the origin serving it, but an edge cache can outlive that. Purge the URL
if it matters. Images that were private from the start are sent with
`no-store` and are never cached.
* **Private images will not render when embedded elsewhere.** The session cookie
is `SameSite=Lax`, so it is not sent with cross-site subresource requests.
Intended, but surprising if you forget.
* **Private is access control, not encryption.** Anyone with server access can
read the file — and so can any other signed-in user, unless
`LIBRARY_MODE=per-user`, which limits private images to their uploader.

---

## Security notes

**Passwords** use scrypt (N=16384, r=8, p=1) from Node's standard library. An
unknown username still triggers a dummy hash, so response timing does not reveal
which accounts exist.

**Uploads** are identified by their leading magic bytes, not the filename or the
browser-supplied `Content-Type`. A PHP script renamed to `.png` is rejected.
Accepted: PNG, JPEG, GIF, WebP, AVIF, MP4, WebM.

Video files are typically much larger than images. The default
`MAX_UPLOAD_BYTES` (12 MB) suits an images-only deployment; if you want to
accept clips, raise it — and raise your reverse proxy's body-size limit to
match, since that applies first (see Troubleshooting).

**SVG is deliberately not accepted.** An SVG can contain JavaScript; served from
your own domain it would run in your origin, where it could read an admin
session. Rasterise before uploading.

**Sessions** are opaque random tokens stored server-side and signed with an
HMAC. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, scoped to
`/images`. State-changing requests carry a CSRF token, including the sign-in
form, whose token is tied to a per-browser cookie.

**Pages** are sent with a strict Content-Security-Policy (scripts and styles
run only with a per-response nonce) and `frame-ancestors 'none'` /
`X-Frame-Options: DENY`, so the dashboard cannot be framed for clickjacking.

**Single sign-on** uses the authorization code flow with PKCE, a random state
and (for OIDC) a nonce, all bound to the browser by a signed short-lived
cookie that also names the provider, so a code from one provider cannot be
replayed at another's callback. Provider config is validated strictly at
startup: an unknown or misspelt setting stops the app rather than being
silently ignored.

**Addresses are unguessable but not secret.** Anyone with the link can view a
public image. Treat it like a Google Drive "anyone with the link" share.

Found a security problem? Open an issue, or email the maintainer for anything
sensitive rather than filing publicly.

---

## Backups

The database and the image files must be backed up together — a row without its
file, or a file without its row, is invisible.

```bash
sudo -u contactsheet sqlite3 /var/lib/contactsheet/images.db \
  ".backup '/tmp/contactsheet-db.sqlite'"

tar czf contactsheet-$(date +%F).tar.gz \
  /tmp/contactsheet-db.sqlite "$STORE_DIR"
```

Use `.backup` rather than copying the file — the database runs in WAL mode and a
plain copy can be inconsistent.

---

## Upgrading

```bash
git pull
npm install --omit=dev
sudo systemctl restart contactsheet
```

Schema changes are applied automatically at startup and logged as
`[migration] …`. New columns are added with defaults that preserve existing
behaviour — an upgrade never changes who can see what.

**Upgrading to 1.2 — check your proxy settings.** The defaults for
`TRUST_CLOUDFLARE` (now `false`) and `PROXY_HOPS` (now `1`) changed, because the
old ones let visitors fake their IP on any install not behind Cloudflare. If
you *are* behind Cloudflare and never set them, add `TRUST_CLOUDFLARE=true`
and `PROXY_HOPS=2` (Tunnel → Caddy) to your service before restarting, or
every visitor will be logged as your proxy's address. The supplied
`deploy/contactsheet.service` already sets both. Everything in 1.2, including
the security fixes, is listed in [CHANGELOG.md](CHANGELOG.md).

---

## Tests

```bash
npm test               # end-to-end smoke test of the main paths
npm run test:sso       # single sign-on against a throwaway local provider (needs openssl)
```

---

## Troubleshooting

**fail2ban bans `127.0.0.1` instead of the attacker.** The app is not seeing the
forwarded address. Check `TRUST_PROXY`, `PROXY_HOPS` and `TRUST_CLOUDFLARE`, then
watch `tail -f /var/lib/contactsheet/log/auth.log` while submitting a wrong
password from a phone on mobile data.

**Bans appear in `fail2ban-client status` but attackers still get through.**
Behind Cloudflare, `iptables` bans block the tunnel, not the visitor. Switch
`banaction` to `cloudflare-zone`.

**Uploads fail with 413.** The reverse proxy's body limit is below the app's.
Raise `request_body max_size` (Caddy) or `client_max_body_size` (nginx) to at
least `MAX_UPLOAD_BYTES` — the proxy's limit applies to the whole request
body, not one file at a time, so if you allow multiple files per submission
size it for a full batch, not a single file.

**`/images` returns your site's 404.** A catch-all route is matching first. Move
the `/images` block above it.

**Service will not start, "Store marker missing".** The store disk is not
mounted. That is the guard doing its job — mount it, or unset
`REQUIRE_STORE_MARKER`.

**Images 404 after a restore.** The database and store must be restored
together.
