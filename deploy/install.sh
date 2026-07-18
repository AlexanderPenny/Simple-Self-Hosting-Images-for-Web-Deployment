#!/usr/bin/env bash
# contactsheet installer.  Run:  sudo bash deploy/install.sh
set -euo pipefail

APP=contactsheet
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m  %s\033[0m\n' "$*"; }
ask()  { # ask <prompt> <default> -> echoes the answer
  local reply
  read -r -p "  $1 [$2]: " reply </dev/tty
  echo "${reply:-$2}"
}

say "contactsheet installer"

# ---------------------------------------------------------------- checks
command -v node >/dev/null || { echo "  Node.js is not installed." >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  Node 20 or newer required (found $(node --version))." >&2
  exit 1
fi
echo "  Node $(node --version) — ok"

# ---------------------------------------------------------------- answers
INSTALL_DIR="$(ask 'Install directory' "/opt/$APP")"
DATA_DIR="$(ask 'Data directory (database and logs)' "/var/lib/$APP")"
PORT="$(ask 'Port to listen on' '3021')"
ORIGIN="$(ask 'Public address (blank to derive from requests)' '')"
SITE_NAME="$(ask 'Site name shown on the login page' 'Image store')"
STORE_DIR="$(ask 'Image store directory (blank = inside the data directory)' '')"

REQUIRE_MARKER=false
if [ -n "$STORE_DIR" ]; then
  MOUNT_ROOT="$(df -P "$(dirname "$STORE_DIR")" 2>/dev/null | awk 'NR==2 {print $6}' || true)"
  if [ -n "$MOUNT_ROOT" ] && [ "$MOUNT_ROOT" != "/" ]; then
    echo "  $STORE_DIR sits on the separate mount $MOUNT_ROOT"
    REQUIRE_MARKER=true
  fi
fi

# ---------------------------------------------------------------- user
say "Service account"
if id "$APP" >/dev/null 2>&1; then
  echo "  user '$APP' already exists"
else
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP"
  echo "  created user '$APP'"
fi

# ---------------------------------------------------------------- files
say "Installing application"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
if [ "$(readlink -f "$SRC")" != "$(readlink -f "$INSTALL_DIR")" ]; then
  tar -C "$SRC" --exclude=node_modules --exclude=.git -cf - . | tar -C "$INSTALL_DIR" -xf -
  echo "  copied to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi
chown -R "$APP:$APP" "$INSTALL_DIR" "$DATA_DIR"

# ---------------------------------------------------------------- store
if [ -n "$STORE_DIR" ]; then
  say "Image store"
  mkdir -p "$STORE_DIR/.incoming"
  chown -R "$APP:$APP" "$STORE_DIR"
  chmod 750 "$STORE_DIR"
  if [ "$REQUIRE_MARKER" = true ]; then
    touch "$STORE_DIR/.store-ok"
    chown "$APP:$APP" "$STORE_DIR/.store-ok"
    echo "  wrote mount marker $STORE_DIR/.store-ok"
  fi
  echo "  store ready at $STORE_DIR"
fi

# ---------------------------------------------------------------- secret
say "Session secret"
ENV_FILE="/etc/$APP.env"
if [ -f "$ENV_FILE" ] && grep -q '^SESSION_SECRET=.\+' "$ENV_FILE"; then
  echo "  keeping the existing secret in $ENV_FILE"
else
  printf 'SESSION_SECRET=%s\n' "$(openssl rand -base64 48)" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  generated a new secret in $ENV_FILE"
  warn "Changing this file later signs everyone out."
fi

# ---------------------------------------------------------------- unit
say "systemd service"
UNIT="/etc/systemd/system/$APP.service"
{
  cat <<UNIT_HEAD
[Unit]
Description=contactsheet image host
After=network.target
UNIT_HEAD

  if [ "$REQUIRE_MARKER" = true ]; then
    echo "RequiresMountsFor=$MOUNT_ROOT"
  fi

  cat <<UNIT_BODY

[Service]
Type=simple
User=$APP
Group=$APP
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) src/server.js
Restart=on-failure
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=BIND_HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
Environment=SITE_NAME=$SITE_NAME
UNIT_BODY

  [ -n "$ORIGIN" ]    && echo "Environment=PUBLIC_ORIGIN=$ORIGIN"
  [ -n "$STORE_DIR" ] && echo "Environment=STORE_DIR=$STORE_DIR"
  [ "$REQUIRE_MARKER" = true ] && echo "Environment=REQUIRE_STORE_MARKER=true"

  cat <<'UNIT_TAIL'
EnvironmentFile=/etc/contactsheet.env

# Hardening: the service can only write to its own directories.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

# Modest limits suit small machines; raise them if you have the headroom.
MemoryHigh=160M
MemoryMax=224M
CPUWeight=40
UNIT_TAIL

  if [ -n "$STORE_DIR" ]; then
    echo "ReadWritePaths=$DATA_DIR $STORE_DIR"
  else
    echo "ReadWritePaths=$DATA_DIR"
  fi

  cat <<'UNIT_END'

[Install]
WantedBy=multi-user.target
UNIT_END
} > "$UNIT"

systemctl daemon-reload
systemctl enable "$APP" >/dev/null
systemctl restart "$APP"
sleep 2

if systemctl is-active --quiet "$APP"; then
  echo "  $APP is running on 127.0.0.1:$PORT"
else
  echo "  service failed to start:" >&2
  journalctl -u "$APP" -n 20 --no-pager >&2
  exit 1
fi

# ---------------------------------------------------------------- account
say "Create your login"
echo "  Run this now, then sign in:"
echo
echo "    cd $INSTALL_DIR && sudo -u $APP node scripts/adduser.js YOURNAME"

# ---------------------------------------------------------------- next
say "Remaining steps"
cat <<NEXT
  1. Reverse proxy — route /images* to 127.0.0.1:$PORT.
     Put it ABOVE any catch-all route. See README.md for Caddy and nginx.

  2. fail2ban — copy the filters and jail:

       sudo cp $INSTALL_DIR/deploy/filter-contactsheet.conf       /etc/fail2ban/filter.d/contactsheet.conf
       sudo cp $INSTALL_DIR/deploy/filter-contactsheet-probe.conf /etc/fail2ban/filter.d/contactsheet-probe.conf
       sudo cp $INSTALL_DIR/deploy/jail.d-contactsheet.local      /etc/fail2ban/jail.d/contactsheet.local

     Then EDIT /etc/fail2ban/jail.d/contactsheet.local:
       - add your own IP to ignoreip, or you can lock yourself out
       - behind Cloudflare Tunnel, set banaction = cloudflare-zone
         (iptables bans hit the tunnel, not the visitor)

  3. Log rotation:

       sudo cp $INSTALL_DIR/deploy/logrotate-contactsheet /etc/logrotate.d/contactsheet

  Auth log for fail2ban:  $DATA_DIR/log/auth.log
  Health check:           curl -s localhost:$PORT/healthz
NEXT

if [ -n "$STORE_DIR" ] && [ "$REQUIRE_MARKER" = true ]; then
  DEV="$(findmnt -no SOURCE "$MOUNT_ROOT" 2>/dev/null || true)"
  if [ -n "$DEV" ] && ! grep -qs "$(blkid -o value -s UUID "$DEV" 2>/dev/null || echo __none__)" /etc/fstab; then
    echo
    warn "$MOUNT_ROOT is not in /etc/fstab — it will not remount after a reboot,"
    warn "and the service will then refuse to start. Add it with the 'nofail' option."
  fi
fi

echo
