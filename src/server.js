import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { q } from './db.js';
import {
  requireAuth, currentUser, createSession, destroySession, clientIp,
  verifyPassword, dummyVerify, authEvents,
  tooManyAttempts, recordAttempt, clearAttempts,
  csrfToken, checkCsrf,
} from './auth.js';
import {
  detectType, generateUniqueId, isValidId,
} from './images.js';
import { loginPage, dashboardPage } from './views.js';


/* ------------------------------------------------------------------ *
 * Disk helpers. Both avoid loading a whole file into memory.
 * ------------------------------------------------------------------ */

async function readHead(filePath, maxBytes) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const size = Math.min(maxBytes, stat.size);
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to);
    await fsp.unlink(from).catch(() => {});
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

const app = express();
const PER_PAGE = 60;
const MAX_TITLE = 120;

// Titles are display text, never used to build a path or a URL. Strip control
// characters, collapse whitespace and cap the length; HTML escaping happens at
// render time in views.js.
function cleanTitle(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

// Escape LIKE wildcards so a search for "100%" does not match everything.
function likePattern(term) {
  return '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

// Caddy sits in front, so the real client IP arrives in X-Forwarded-For.
// Trusting exactly one hop means a client cannot forge the header and get
// an innocent third party banned by fail2ban.
app.set('trust proxy', config.trustProxy ? config.proxyHops : false);
app.disable('x-powered-by');

app.use(cookieParser());
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Files stream to disk rather than into memory. On a 1 GB Raspberry Pi,
// buffering ten 12 MB uploads at once would be a real risk of an OOM kill.
// Staging lives inside the store so that rename() stays on one filesystem.
const tmpDir = config.tmpDir;
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir }),
  limits: { fileSize: config.maxUploadBytes, files: config.maxFilesPerUpload },
});

// Clear anything a crashed request left behind.
for (const stale of fs.readdirSync(tmpDir)) {
  try { fs.unlinkSync(path.join(tmpDir, stale)); } catch { /* ignore */ }
}

/* ================================================================== *
 * Admin: login
 * ================================================================== */

app.get('/images', (req, res, next) => {
  const user = currentUser(req);
  if (!user) {
    res.setHeader('Cache-Control', 'no-store');
    return res.send(loginPage({ csrf: csrfToken(req), siteName: config.siteName }));
  }
  req.user = user;
  next();
}, (req, res) => {
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const search = String(req.query.q || '').trim().slice(0, 100);

  const rows = search
    ? q.searchImages.all({
        like: likePattern(search),
        limit: PER_PAGE + 1,
        offset: page * PER_PAGE,
      })
    : q.listImages.all(PER_PAGE + 1, page * PER_PAGE);

  const hasNext = rows.length > PER_PAGE;

  res.setHeader('Cache-Control', 'no-store');
  res.send(dashboardPage({
    user: req.user,
    images: rows.slice(0, PER_PAGE),
    stats: q.countImages.get(),
    csrf: csrfToken(req),
    origin: config.publicOrigin || `${req.protocol}://${req.get('host')}`,
    page,
    hasNext,
    search,
    siteName: config.siteName,
  }));
});

app.post('/images/login', (req, res) => {
  const ip = clientIp(req);
  const username = String(req.body.username || '').trim().slice(0, 64);
  const password = String(req.body.password || '');

  res.setHeader('Cache-Control', 'no-store');

  const fail = (message, keep = true) => res.status(401).send(loginPage({
    error: message, csrf: csrfToken(req), username: keep ? username : '',
    siteName: config.siteName,
  }));

  if (!checkCsrf(req)) {
    return fail('That form expired. Please try again.');
  }

  if (tooManyAttempts(ip)) {
    authEvents.throttled(ip, username);
    return res.status(429).send(loginPage({
      error: 'Too many attempts. Wait a few minutes before trying again.',
      csrf: csrfToken(req), siteName: config.siteName,
    }));
  }

  if (!username || !password) {
    recordAttempt(ip);
    authEvents.failed(ip, username, 'missing_credentials');
    return fail('Enter both a username and a password.');
  }

  const user = q.userByName.get(username);
  if (!user) {
    // Spend the same time as a real hash check so timing reveals nothing.
    dummyVerify(password);
    recordAttempt(ip);
    authEvents.failed(ip, username, 'no_such_user');
    return fail('That username and password do not match.');
  }

  if (!verifyPassword(password, user.password_hash)) {
    recordAttempt(ip);
    authEvents.failed(ip, username, 'bad_password');
    return fail('That username and password do not match.');
  }

  clearAttempts(ip);
  authEvents.success(ip, user.username);
  createSession(res, user, req);
  res.redirect('/images');
});

app.post('/images/logout', (req, res) => {
  if (checkCsrf(req)) destroySession(req, res);
  res.redirect('/images');
});

/* ================================================================== *
 * Admin: upload
 * ================================================================== */

app.post('/images/upload', requireAuth, (req, res) => {
  if (!checkCsrf(req)) {
    return res.status(403).json({ error: 'Session expired. Reload the page and try again.' });
  }

  upload.array('images', config.maxFilesPerUpload)(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Each file must be under ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`
        : 'That upload could not be read.';
      return res.status(400).json({ error: message });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files were attached.' });

    // The uploader chooses the default for this batch; anything unrecognised
    // falls back to private, so a typo can never over-share.
    // A single title applies to the batch; with one file that is just "the
    // title". Left blank, the original filename (minus extension) is used, so
    // images are never nameless.
    const batchTitle = cleanTitle(req.body?.title);

    const requested = String(req.body?.visibility || 'public');
    const batchVisibility = requested === 'public' ? 'public' : 'private';

    const origin = config.publicOrigin || `${req.protocol}://${req.get('host')}`;

    const uploaded = [];
    const rejected = [];

    for (const file of files) {
      const tmpPath = file.path;
      try {
        // Read only the head of the file: enough for the magic bytes and for
        // the JPEG SOF marker that carries the dimensions.
        const head = await readHead(tmpPath, 128 * 1024);
        const type = detectType(head);
        if (!type) {
          rejected.push({ name: file.originalname, reason: 'not a supported image format' });
          continue;
        }

        const id = generateUniqueId();
        const filename = `${id}.${type.ext}`;
        const target = path.join(config.storeDir, filename);
        const dims = type.size(head) || {};
        const digest = await hashFile(tmpPath);

        // rename() is atomic within a filesystem, so a reader never sees a
        // half-written image at a published address. If the staging area ever
        // ends up on a different device, fall back to copy-then-delete.
        await moveFile(tmpPath, target);

        q.insertImage.run({
          id,
          filename,
          original_name: String(file.originalname || '').slice(0, 255),
          mime: type.mime,
          ext: type.ext,
          bytes: file.size,
          sha256: digest,
          width: dims.width ?? null,
          height: dims.height ?? null,
          uploaded_by: req.user.id,
          created_at: Date.now(),
          visibility: batchVisibility,
          // "holiday_beach_photo.png" -> "holiday beach photo"
          title: batchTitle || cleanTitle(
            String(file.originalname || '')
              .replace(/\.[^.]+$/, '')
              .replace(/[_-]+/g, ' ')
          ),
        });

        uploaded.push({
          id,
          url: `${origin}/images/${id}`,
          bytes: file.size,
          visibility: batchVisibility,
        });
      } catch {
        rejected.push({ name: file.originalname, reason: 'could not be saved' });
      } finally {
        // Only removes the temp file if the rename did not already consume it.
        await fsp.unlink(tmpPath).catch(() => {});
      }
    }

    if (!uploaded.length) {
      return res.status(400).json({ error: 'None of those files were valid images.', rejected });
    }
    res.json({ uploaded, rejected });
  });
});


/* ================================================================== *
 * Admin: change visibility
 * ================================================================== */

app.patch('/images/:id', requireAuth, express.json({ limit: '1kb' }), (req, res) => {
  if (!checkCsrf(req)) return res.status(403).json({ error: 'Session expired.' });

  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Not a valid image ID.' });

  const image = q.imageById.get(id);
  if (!image) return res.status(404).json({ error: 'No image with that ID.' });

  const changes = {};

  if (req.body?.visibility !== undefined) {
    const visibility = String(req.body.visibility);
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'Visibility must be "public" or "private".' });
    }
    q.setVisibility.run(visibility, id);
    changes.visibility = visibility;
  }

  if (req.body?.title !== undefined) {
    const title = cleanTitle(req.body.title);
    q.setTitle.run(title, id);
    changes.title = title;
  }

  if (!Object.keys(changes).length) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  res.json({ id, ...changes });
});

/* ================================================================== *
 * Admin: delete
 * ================================================================== */

app.delete('/images/:id', requireAuth, async (req, res) => {
  if (!checkCsrf(req)) return res.status(403).json({ error: 'Session expired.' });

  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Not a valid image ID.' });

  const image = q.imageById.get(id);
  if (!image) return res.status(404).json({ error: 'No image with that ID.' });

  q.deleteImage.run(id);
  try {
    await fsp.unlink(path.join(config.storeDir, image.filename));
  } catch { /* row is gone; a missing file is not worth failing the request */ }

  res.json({ deleted: id });
});

/* ================================================================== *
 * Public: serve an image. No authentication, by design.
 * ================================================================== */

app.get('/images/:id', (req, res) => {
  const raw = req.params.id;

  // Accept both /images/<id> and /images/<id>.png so links keep working
  // if someone pastes the address with an extension attached.
  const id = raw.includes('.') ? raw.slice(0, raw.indexOf('.')) : raw;

  const notFound = () => res.status(404).type('txt').send('Not found');

  if (!isValidId(id)) return notFound();

  const image = q.imageById.get(id);
  if (!image) return notFound();

  // Private images require a signed-in session. The response for "private and
  // not signed in" is byte-identical to "no such image", so an outsider cannot
  // use this endpoint to discover which IDs exist.
  const isPrivate = image.visibility === 'private';
  if (isPrivate && !currentUser(req)) return notFound();

  const filePath = path.join(config.storeDir, image.filename);
  // Defence in depth: the ID pattern already excludes traversal characters,
  // but confirm the resolved path really is inside the store.
  if (!filePath.startsWith(config.storeDir + path.sep)) return notFound();
  if (!fs.existsSync(filePath)) return notFound();

  const etag = `"${image.sha256.slice(0, 32)}"`;

  res.setHeader('Content-Type', image.mime);
  res.setHeader('ETag', etag);
  // Give browsers a sensible filename on "save image as", derived from the
  // title. ASCII-only and quote-stripped so the header cannot be broken.
  const safeName = (image.title || image.id)
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 80) || image.id;
  res.setHeader('Content-Disposition', `inline; filename="${safeName}.${image.ext}"`);

  if (isPrivate) {
    // Must never be stored by Cloudflare, a corporate proxy or the browser
    // cache, or the image would outlive the session that was allowed to see it.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Robots-Tag', 'noindex, noimageindex, noarchive, nosnippet');
    // Do not let a private image be embedded on someone else's page.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  } else {
    // Content at a given ID never changes, so it is safe to cache hard.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Robots-Tag', 'noindex, noimageindex, noarchive');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  if (req.get('if-none-match') === etag) return res.status(304).end();

  try { q.bumpViews.run(id); } catch { /* counter only */ }
  res.sendFile(filePath);
});

/* ================================================================== *
 * Fallbacks
 * ================================================================== */

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).type('txt').send('Not found'));

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).type('txt').send('Something went wrong.');
});

app.listen(config.port, config.bindHost, () => {
  console.log(`contactsheet listening on ${config.bindHost}:${config.port}`);
  console.log(`  store:    ${config.storeDir}`);
  console.log(`  auth log: ${config.authLogPath}`);
});
