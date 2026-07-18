import path from 'node:path';
import fs from 'node:fs';

const env = process.env;

function required(name, fallback) {
  const v = env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  // 3000 is Gitea's default, so this stays clear of it.
  port: parseInt(env.PORT || '3021', 10),
  bindHost: env.BIND_HOST || '127.0.0.1',

  // Public origin used to build the copyable image addresses, e.g.
  // https://example.com. Leave unset and it is derived from the incoming
  // request, which is fine for a simple setup but explicit is better behind
  // a proxy that rewrites the Host header.
  publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),

  // Where everything persistent lives.
  dataDir: env.DATA_DIR || '/var/lib/contactsheet',

  // Secret used to sign session cookies. MUST be set in production.
  sessionSecret: required('SESSION_SECRET', env.NODE_ENV === 'production' ? undefined : 'dev-only-insecure-secret'),

  // Session lifetime.
  sessionMaxAgeMs: parseInt(env.SESSION_MAX_AGE_MS || String(1000 * 60 * 60 * 12), 10),

  // Upload limits. Files stream to a temp file rather than being buffered
  // in memory, so these are disk limits, not RAM limits.
  maxUploadBytes: parseInt(env.MAX_UPLOAD_BYTES || String(12 * 1024 * 1024), 10),
  maxFilesPerUpload: parseInt(env.MAX_FILES_PER_UPLOAD || '10', 10),

  // Length of the generated public image ID.
  idLength: parseInt(env.ID_LENGTH || '10', 10),

  // Set true when running behind Caddy/nginx so req.ip uses X-Forwarded-For.
  trustProxy: (env.TRUST_PROXY || 'true') !== 'false',

  // Number of proxies between the client and this app. Caddy alone is 1;
  // Cloudflare Tunnel -> cloudflared -> Caddy is 2.
  proxyHops: parseInt(env.PROXY_HOPS || '2', 10),

  // When traffic arrives via Cloudflare, CF-Connecting-IP is the single
  // authoritative client address. Cloudflare overwrites it at the edge, so
  // it cannot be forged by a client -- PROVIDED the origin is only ever
  // reachable through the tunnel. If you also expose ports 80/443 directly,
  // set TRUST_CLOUDFLARE=false, because then anyone could set the header.
  trustCloudflare: (env.TRUST_CLOUDFLARE || 'true') !== 'false',

  // In-process throttle, a cheap first line of defence before fail2ban.
  loginWindowMs: parseInt(env.LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10),
  loginMaxAttempts: parseInt(env.LOGIN_MAX_ATTEMPTS || '10', 10),

  // Shown in the page title and above the login form.
  siteName: env.SITE_NAME || 'Image store',

  isProduction: env.NODE_ENV === 'production',
};

// Image files can live on a different disk from the database. On a Pi the
// SD card is the wear-sensitive part, and images are almost all of the write
// volume, so pointing STORE_DIR at a USB drive is the right split: bulk data
// on USB, small database and logs on the SD card.
config.storeDir = env.STORE_DIR || path.join(config.dataDir, 'store');

// The upload staging directory MUST sit on the same filesystem as the store,
// otherwise the final rename() is a cross-device move and fails with EXDEV.
config.tmpDir = path.join(config.storeDir, '.incoming');
config.dbPath = path.join(config.dataDir, 'images.db');
config.logDir = env.LOG_DIR || path.join(config.dataDir, 'log');
config.authLogPath = path.join(config.logDir, 'auth.log');

for (const dir of [config.dataDir, config.storeDir, config.tmpDir, config.logDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------------------------------------------ *
 * Mount guard.
 *
 * If STORE_DIR is a USB mountpoint and the drive is not mounted, the path
 * still exists -- as an empty directory on the SD card underneath. Without
 * this check the service would start happily, write images to the wrong
 * disk, and then appear to "lose" them the moment the drive came back.
 *
 * The marker file lives on the USB filesystem itself, so it is only visible
 * when the real drive is mounted.
 * ------------------------------------------------------------------ */

const markerPath = path.join(config.storeDir, '.store-ok');
config.storeMarker = markerPath;

if (env.REQUIRE_STORE_MARKER === 'true') {
  if (!fs.existsSync(markerPath)) {
    throw new Error(
      `Store marker missing: ${markerPath}\n` +
      'The image store does not look mounted. Refusing to start so that images '
      + 'are not written to the wrong disk.\n'
      + `If the drive really is mounted and this is a first run, create it with:\n`
      + `  sudo -u contactsheet touch ${markerPath}`
    );
  }
}

if (config.isProduction && config.sessionSecret === 'dev-only-insecure-secret') {
  throw new Error('Refusing to start in production with the default SESSION_SECRET.');
}
