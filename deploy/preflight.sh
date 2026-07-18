#!/usr/bin/env bash
# Run on the Pi BEFORE installing:  sudo bash preflight.sh
echo "=== 1. Free port? (3021 must be empty; 3000 is likely Gitea) ==="
ss -tlnp | grep -E ':(3000|3021)\b' || echo "  3000 and 3021 both free"

echo; echo "=== 2. Caddy access log format ==="
tail -n 1 /var/log/caddy/access.log 2>/dev/null | head -c 500 || echo "  no log at /var/log/caddy/access.log"

echo; echo "=== 3. Does Caddy log Cf-Connecting-Ip? ==="
tail -n 50 /var/log/caddy/access.log 2>/dev/null | grep -o 'Cf-Connecting-Ip' | head -1 || echo "  NOT FOUND -> probe jail needs the remote_ip fallback line"

echo; echo "=== 4. cloudflare-zone action credentials present? ==="
grep -qE '^\s*cftoken\s*=\s*\S' /etc/fail2ban/action.d/cloudflare-zone.conf 2>/dev/null \
  && echo "  cloudflare-zone appears configured" \
  || echo "  CHECK: cloudflare-zone token may live elsewhere (jail.local or action.d)"

echo; echo "=== 5. Is the origin reachable WITHOUT Cloudflare? ==="
ss -tlnp | grep -E '(0\.0\.0\.0|\[::\]|\*):(80|443)([^0-9]|$)' \
  && echo "  WARNING: ports 80/443 listen publicly. If reachable from the internet," \
  && echo "           CF-Connecting-IP can be forged -> set TRUST_CLOUDFLARE=false" \
  || echo "  Good: no public 80/443 listener, tunnel-only origin."

echo; echo "=== 6. Node version (need >= 20) ==="
node --version 2>/dev/null || echo "  node not installed"
echo "  arch: $(uname -m)"

echo; echo "=== 8. USB drive for the image store ==="
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT | grep -vE '^loop'
echo "  -> pick the USB mountpoint above and use it as STORE_DIR"

echo; echo "=== 7. Memory and disk ==="
free -h | head -2
df -h / | tail -1
echo "  NOTE: if / is an SD card, heavy image hosting will wear it out."
