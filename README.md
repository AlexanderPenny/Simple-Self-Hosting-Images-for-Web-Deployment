<!--
Copyright 2026 Alexander L. Penny

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# contactsheet

A small self-hosted image host. Upload an image, get a short address you can
paste anywhere:

```
https://example.com/images/kivuhRjaTZ
```

The admin panel lives at `/images` behind a login. The images themselves are
served from `/images/<id>` with no authentication — unless you mark them
private, which you can do per image.

Built for a Raspberry Pi sitting behind Caddy, but nothing in it is Pi-specific.

\---

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

\---

## Requirements

* Node.js 20 or newer
* A reverse proxy that terminates TLS (Caddy, nginx, Cloudflare Tunnel…)
* Linux with systemd, if you want the supplied service unit
* fail2ban, optional but recommended

\---

## Quick start

```bash
git clone https://github.com/YOURNAME/contactsheet.git
cd contactsheet
npm install --omit=dev

SESSION\_SECRET=$(openssl rand -base64 48) \\
DATA\_DIR=./data \\
npm start
```

Create a user in a second terminal, then open [http://localhost:3021/images](http://localhost:3021/images):

```bash
DATA\_DIR=./data node scripts/adduser.js yourname
```

That is enough to try it. For a real deployment, keep reading.

\---

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
	handle /images\* {
		request\_body {
			max\_size 15MB
		}
		reverse\_proxy 127.0.0.1:3021
	}

	# ... your existing routes ...
}
```

Put this **above** any catch-all route, or the catch-all wins and `/images`
never reaches the app.

Behind Cloudflare, pass the real visitor address through so bans hit the right
IP:

```
	reverse\_proxy 127.0.0.1:3021 {
		header\_up CF-Connecting-IP {header.CF-Connecting-IP}
	}
```

nginx equivalent:

```nginx
location /images {
	proxy\_pass http://127.0.0.1:3021;
	proxy\_set\_header Host $host;
	proxy\_set\_header X-Forwarded-For $proxy\_add\_x\_forwarded\_for;
	proxy\_set\_header X-Forwarded-Proto $scheme;
	client\_max\_body\_size 15M;
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
sudo fail2ban-regex /var/lib/contactsheet/log/auth.log \\
  /etc/fail2ban/filter.d/contactsheet.conf
```

|Jail|Watches|Trigger|Ban|
|-|-|-|-|
|`contactsheet`|app auth log|5 failed logins in 10 min|4 h, doubling on repeat, max 1 week|
|`contactsheet-probe`|proxy access log|20 × 401/403/404 on `/images\*` in 5 min|2 h|

The app also throttles in-process: after 10 failures from one IP in 15 minutes
it stops checking passwords entirely and returns 429, so a burst cannot burn CPU
on password hashing in the seconds before fail2ban reacts.

\---

## Configuration

Everything is environment variables. In production put `SESSION\_SECRET` in a
file readable only by root, e.g. `/etc/contactsheet.env`.

|Variable|Default|Meaning|
|-|-|-|
|`SESSION\_SECRET`|*(required)*|HMAC key for session cookies. `openssl rand -base64 48`|
|`PORT`|`3021`|Port to listen on|
|`BIND\_HOST`|`127.0.0.1`|Keep on loopback so only the proxy can reach it|
|`PUBLIC\_ORIGIN`|*(derived)*|e.g. `https://example.com`. Derived from the request if unset|
|`SITE\_NAME`|`Image store`|Shown on the login page and in page titles|
|`DATA\_DIR`|`/var/lib/contactsheet`|Database and logs|
|`STORE\_DIR`|`$DATA\_DIR/store`|Image files. Point at a separate disk if you like|
|`REQUIRE\_STORE\_MARKER`|`false`|Refuse to start if the store is not mounted|
|`MAX\_UPLOAD\_BYTES`|`12582912`|Per-file limit (12 MB)|
|`MAX\_FILES\_PER\_UPLOAD`|`10`|Files per submission|
|`ID\_LENGTH`|`10`|Characters in a generated ID|
|`TRUST\_PROXY`|`true`|Read the client IP from proxy headers|
|`PROXY\_HOPS`|`2`|Proxies in front. Caddy alone is 1; Cloudflare Tunnel → Caddy is 2|
|`TRUST\_CLOUDFLARE`|`true`|Use `CF-Connecting-IP`. **Set false if the origin is reachable without Cloudflare**|
|`LOGIN\_MAX\_ATTEMPTS`|`10`|In-process throttle threshold|

\---

## Managing users

```bash
node scripts/adduser.js alice     # create
node scripts/passwd.js alice      # change password
node scripts/lsusers.js           # list
```

Run these as the service user in production:

```bash
cd /opt/contactsheet
sudo -u contactsheet node scripts/adduser.js alice
```

There is no signup page and no password reset by design — this is meant for a
handful of people you know.

\---

## Storing images on a separate disk

Image writes are almost all of the write volume, and SD cards wear out. Put the
store on a USB disk and leave the small database on the system disk:

```bash
sudo bash deploy/setup-store.sh /mnt/storage
```

That creates the directory, sets ownership, and writes a `.store-ok` marker.

**The marker is not decoration.** If the disk is not mounted, `STORE\_DIR` still
exists as an empty directory on the system disk underneath. Without the marker
the service would start, write images to the wrong disk, and appear to lose them
when the drive came back. With `REQUIRE\_STORE\_MARKER=true` it refuses to start
instead.

Add the disk to `/etc/fstab` with `nofail` so it remounts on boot without
blocking it:

```
UUID=xxxx-xxxx  /mnt/storage  ext4  defaults,nofail,x-systemd.device-timeout=10  0  2
```

Use a filesystem with POSIX ownership — ext4 is fine, exFAT and NTFS are not.

\---

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
* **Private is access control, not encryption.** Anyone with server access, and
any other signed-in user, can read the file.

\---

## Security notes

**Passwords** use scrypt (N=16384, r=8, p=1) from Node's standard library. An
unknown username still triggers a dummy hash, so response timing does not reveal
which accounts exist.

**Uploads** are identified by their leading magic bytes, not the filename or the
browser-supplied `Content-Type`. A PHP script renamed to `.png` is rejected.
Accepted: PNG, JPEG, GIF, WebP, AVIF.

**SVG is deliberately not accepted.** An SVG can contain JavaScript; served from
your own domain it would run in your origin, where it could read an admin
session. Rasterise before uploading.

**Sessions** are opaque random tokens stored server-side and signed with an
HMAC. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, scoped to
`/images`. State-changing requests carry a CSRF token.

**Addresses are unguessable but not secret.** Anyone with the link can view a
public image. Treat it like a Google Drive "anyone with the link" share.

Found a security problem? Open an issue, or email the maintainer for anything
sensitive rather than filing publicly.

\---

## Backups

The database and the image files must be backed up together — a row without its
file, or a file without its row, is invisible.

```bash
sudo -u contactsheet sqlite3 /var/lib/contactsheet/images.db \\
  ".backup '/tmp/contactsheet-db.sqlite'"

tar czf contactsheet-$(date +%F).tar.gz \\
  /tmp/contactsheet-db.sqlite "$STORE\_DIR"
```

Use `.backup` rather than copying the file — the database runs in WAL mode and a
plain copy can be inconsistent.

\---

## Upgrading

```bash
git pull
npm install --omit=dev
sudo systemctl restart contactsheet
```

Schema changes are applied automatically at startup and logged as
`\[migration] …`. New columns are added with defaults that preserve existing
behaviour — an upgrade never changes who can see what.

\---

## Troubleshooting

**fail2ban bans `127.0.0.1` instead of the attacker.** The app is not seeing the
forwarded address. Check `TRUST\_PROXY`, `PROXY\_HOPS` and `TRUST\_CLOUDFLARE`, then
watch `tail -f /var/lib/contactsheet/log/auth.log` while submitting a wrong
password from a phone on mobile data.

**Bans appear in `fail2ban-client status` but attackers still get through.**
Behind Cloudflare, `iptables` bans block the tunnel, not the visitor. Switch
`banaction` to `cloudflare-zone`.

**Uploads fail with 413.** The reverse proxy's body limit is below the app's.
Raise `request\_body max\_size` (Caddy) or `client\_max\_body\_size` (nginx).

**`/images` returns your site's 404.** A catch-all route is matching first. Move
the `/images` block above it.

**Service will not start, "Store marker missing".** The store disk is not
mounted. That is the guard doing its job — mount it, or unset
`REQUIRE\_STORE\_MARKER`.

**Images 404 after a restore.** The database and store must be restored
together.
