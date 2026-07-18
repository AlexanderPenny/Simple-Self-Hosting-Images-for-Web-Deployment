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

import { formatBytes } from './images.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
`;

const BASE_CSS = `
:root{
  --ink:#14171a;
  --tray:#dce0d8;
  --paper:#f6f7f3;
  --graphite:#6c7269;
  --safelight:#c0442a;
  --rule:rgba(20,23,26,.14);
  --frame-gap:14px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--tray);
  color:var(--ink);
  font:400 15px/1.55 "IBM Plex Sans",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
  min-height:100vh;
}
a{color:var(--ink)}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
.eyebrow{
  font:600 11px/1 "IBM Plex Mono",monospace;
  letter-spacing:.18em;text-transform:uppercase;color:var(--graphite);
}
button,input{font:inherit}
:focus-visible{outline:2px solid var(--safelight);outline-offset:2px}
@media (prefers-reduced-motion:reduce){
  *{animation-duration:.01ms!important;transition-duration:.01ms!important}
}
`;

/* The sprocket strip: a repeating-linear-gradient of rounded notches down
   the page edge. It is the one ornamental flourish, and it is doing the
   work of saying "this is a roll of film" without a single image asset. */
const SPROCKET_CSS = `
.sprocket{
  position:fixed;top:0;bottom:0;width:26px;background:var(--ink);
  display:flex;flex-direction:column;align-items:center;
  gap:12px;padding:14px 0;overflow:hidden;z-index:5;
}
.sprocket--left{left:0}
.sprocket i{display:block;width:12px;height:16px;border-radius:2.5px;background:var(--tray);flex:0 0 auto}
@media (max-width:720px){.sprocket{display:none}}
`;

export function loginPage({ error = '', csrf = '', username = '', siteName = 'Image store' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Sign in &middot; ${escapeHtml(siteName)}</title>
${FONTS}
<style>
${BASE_CSS}
.stage{min-height:100vh;display:grid;place-items:center;padding:32px 20px}
.negative{
  width:100%;max-width:390px;background:var(--ink);color:var(--paper);
  padding:10px;border-radius:3px;
  box-shadow:0 24px 60px -28px rgba(20,23,26,.6);
}
.negative__inner{border:1px solid rgba(246,247,243,.16);padding:34px 28px 30px}
.negative .eyebrow{color:rgba(246,247,243,.5)}
h1{
  font:700 30px/1.05 "IBM Plex Sans Condensed",sans-serif;
  letter-spacing:-.01em;margin:12px 0 6px;
}
.sub{color:rgba(246,247,243,.55);font-size:13.5px;margin:0 0 26px}
label{display:block;margin-bottom:16px}
.label-text{
  font:600 10.5px/1 "IBM Plex Mono",monospace;letter-spacing:.16em;
  text-transform:uppercase;color:rgba(246,247,243,.5);
  display:block;margin-bottom:7px;
}
input[type=text],input[type=password]{
  width:100%;padding:11px 12px;background:transparent;color:var(--paper);
  border:1px solid rgba(246,247,243,.22);border-radius:2px;
  font-family:"IBM Plex Mono",monospace;font-size:14px;
}
input:focus{border-color:var(--safelight)}
.submit{
  width:100%;margin-top:8px;padding:12px;cursor:pointer;
  background:var(--paper);color:var(--ink);border:0;border-radius:2px;
  font:600 12px/1 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;
}
.submit:hover{background:var(--safelight);color:var(--paper)}
.alert{
  border-left:2px solid var(--safelight);padding:9px 12px;margin-bottom:22px;
  background:rgba(192,68,42,.12);font-size:13.5px;color:#f0c9c0;
}
.foot{
  margin-top:24px;padding-top:16px;border-top:1px solid rgba(246,247,243,.14);
  font:400 11.5px/1.5 "IBM Plex Mono",monospace;color:rgba(246,247,243,.4);
}
</style>
</head>
<body>
<main class="stage">
  <div class="negative">
    <div class="negative__inner">
      <span class="eyebrow">${escapeHtml(siteName)}</span>
      <h1>Image store</h1>
      <p class="sub">Sign in to upload and manage hosted images.</p>
      ${error ? `<div class="alert" role="alert">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/images/login" autocomplete="on">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <label>
          <span class="label-text">Username</span>
          <input type="text" name="username" value="${escapeHtml(username)}"
                 autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
        </label>
        <label>
          <span class="label-text">Password</span>
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button class="submit" type="submit">Sign in</button>
      </form>
      <p class="foot">Repeated failed sign-ins will get your IP address banned at the firewall.</p>
    </div>
  </div>
</main>
</body>
</html>`;
}

export function dashboardPage({ user, images, stats, csrf, origin, page, hasNext, search = '', siteName = '' }) {
  const frames = images.map((img, i) => {
    const n = String((page * 60) + i + 1).padStart(3, '0');
    const url = `${origin}/images/${img.id}`;
    const dims = img.width && img.height ? `${img.width}&times;${img.height}` : '&mdash;';
    const priv = img.visibility === 'private';
    return `
    <figure class="frame ${priv ? 'is-private' : ''}" data-id="${escapeHtml(img.id)}">
      <div class="frame__no mono">
        <span>${n}</span>
        <span class="tag ${priv ? 'tag--private' : 'tag--public'}">${priv ? 'Private' : 'Public'}</span>
      </div>
      <a class="frame__img" href="/images/${escapeHtml(img.id)}" target="_blank" rel="noopener">
        <img src="/images/${escapeHtml(img.id)}" alt="${escapeHtml(img.title || img.original_name || img.id)}" loading="lazy">
      </a>
      <figcaption>
        <input class="frame__title" value="${escapeHtml(img.title || '')}"
               placeholder="Untitled" maxlength="120"
               data-id="${escapeHtml(img.id)}"
               data-original="${escapeHtml(img.title || '')}"
               aria-label="Image title">
        <input class="frame__url mono" value="${escapeHtml(url)}" readonly aria-label="Image address">
        <div class="frame__meta mono">
          <span>${escapeHtml(img.ext)}</span><span>${dims}</span><span>${formatBytes(img.bytes)}</span><span>${img.views} views</span>
        </div>
        <div class="frame__actions">
          <button class="btn btn--copy" data-url="${escapeHtml(url)}">Copy address</button>
          <button class="btn btn--vis" data-id="${escapeHtml(img.id)}"
                  data-next="${priv ? 'public' : 'private'}"
                  title="${priv ? 'Anyone with the link will be able to view this' : 'Only signed-in users will be able to view this'}">
            ${priv ? 'Make public' : 'Make private'}
          </button>
          <button class="btn btn--del" data-id="${escapeHtml(img.id)}">Delete</button>
        </div>
      </figcaption>
    </figure>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Contact sheet &middot; ${escapeHtml(siteName)}</title>
${FONTS}
<style>
${BASE_CSS}
${SPROCKET_CSS}
.wrap{max-width:1180px;margin:0 auto;padding:30px 24px 90px}
@media (min-width:721px){.wrap{padding-left:52px}}

header.top{
  display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;
  justify-content:space-between;padding-bottom:18px;
  border-bottom:2px solid var(--ink);margin-bottom:26px;
}
h1{font:700 32px/1 "IBM Plex Sans Condensed",sans-serif;margin:8px 0 0;letter-spacing:-.01em}
.top__meta{display:flex;gap:22px;align-items:baseline}
.stat{font:500 12px/1.3 "IBM Plex Mono",monospace;color:var(--graphite);text-align:right}
.stat b{display:block;font:600 19px/1.1 "IBM Plex Mono",monospace;color:var(--ink)}
.signout{
  font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;
  color:var(--graphite);text-decoration:none;border-bottom:1px solid var(--rule);padding-bottom:3px;
}
.signout:hover{color:var(--safelight);border-color:var(--safelight)}

.drop{
  border:1.5px dashed rgba(20,23,26,.32);background:var(--paper);
  padding:34px 22px;text-align:center;margin-bottom:34px;border-radius:3px;
  transition:background .15s,border-color .15s;
}
.drop.is-hot{border-color:var(--safelight);background:#fff}
.drop h2{font:700 19px/1.2 "IBM Plex Sans Condensed",sans-serif;margin:0 0 6px}
.drop p{margin:0 0 16px;color:var(--graphite);font-size:13.5px}
.drop input[type=file]{display:none}
.btn{
  cursor:pointer;border:1px solid var(--ink);background:var(--ink);color:var(--paper);
  padding:9px 16px;border-radius:2px;
  font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.13em;text-transform:uppercase;
}
.btn:hover{background:var(--safelight);border-color:var(--safelight)}
.btn--ghost{background:transparent;color:var(--ink)}
.btn--ghost:hover{color:var(--paper)}

#status{min-height:20px;margin-bottom:20px;font:500 13px/1.4 "IBM Plex Mono",monospace}
#status.ok{color:#2f6b3f}
#status.err{color:var(--safelight)}

.sheet{
  display:grid;gap:var(--frame-gap);
  grid-template-columns:repeat(auto-fill,minmax(228px,1fr));
}
.frame{
  margin:0;background:var(--paper);border:1px solid var(--rule);
  border-radius:2px;overflow:hidden;display:flex;flex-direction:column;
}
.frame__no{
  font-size:10.5px;letter-spacing:.14em;color:var(--graphite);
  padding:7px 10px 5px;border-bottom:1px solid var(--rule);
}
.frame__img{display:block;background:#e6e9e2;aspect-ratio:4/3;overflow:hidden}
.frame__img img{width:100%;height:100%;object-fit:contain;display:block}
figcaption{padding:10px;display:flex;flex-direction:column;gap:8px}
.frame__url{
  width:100%;padding:6px 7px;font-size:11.5px;border:1px solid var(--rule);
  border-radius:2px;background:#fff;color:var(--ink);
}
.frame__meta{
  display:flex;flex-wrap:wrap;gap:9px;font-size:10.5px;color:var(--graphite);
}
.frame__actions{display:flex;gap:6px}
.frame__actions .btn{flex:1;padding:7px 8px;font-size:10px;letter-spacing:.1em}
.btn--del{background:transparent;color:var(--graphite);border-color:var(--rule)}
.btn--del:hover{background:var(--safelight);border-color:var(--safelight);color:var(--paper)}

.frame__title{
  width:100%;padding:6px 7px;border:1px solid transparent;border-radius:2px;
  background:transparent;color:var(--ink);
  font:500 13.5px/1.3 "IBM Plex Sans",sans-serif;
}
.frame__title:hover{border-color:var(--rule)}
.frame__title:focus{border-color:var(--safelight);background:#fff;outline:none}
.frame__title::placeholder{color:var(--graphite);font-style:italic}
.frame__title.is-saved{border-color:#2f6b3f}

.frame__no{display:flex;justify-content:space-between;align-items:center;gap:8px}
.tag{
  font:600 9.5px/1 "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;
  padding:3px 6px;border-radius:2px;border:1px solid;
}
.tag--public{color:var(--graphite);border-color:var(--rule)}
.tag--private{color:var(--safelight);border-color:rgba(192,68,42,.45);background:rgba(192,68,42,.08)}
.frame.is-private{border-color:rgba(192,68,42,.4)}
.frame.is-private .frame__img{background:#efe4e1}
.btn--vis{background:transparent;color:var(--graphite);border-color:var(--rule)}
.btn--vis:hover{background:var(--ink);border-color:var(--ink);color:var(--paper)}

.drop__controls{display:flex;gap:20px;align-items:center;justify-content:center;flex-wrap:wrap}
.vis-pick{border:0;margin:0;padding:0;display:flex;gap:14px;align-items:center}
.vis-pick legend{
  float:left;margin-right:12px;padding:0;
  font:600 10.5px/1 "IBM Plex Mono",monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--graphite);
}
.vis-pick label{
  display:flex;align-items:center;gap:5px;cursor:pointer;
  font:500 12.5px/1 "IBM Plex Mono",monospace;
}

.frame__title{
  width:100%;padding:6px 7px;border:1px solid transparent;border-radius:2px;
  background:transparent;color:var(--ink);
  font:600 13px/1.3 "IBM Plex Sans Condensed",sans-serif;
}
.frame__title:hover{border-color:var(--rule);background:#fff}
.frame__title:focus{border-color:var(--safelight);background:#fff;outline:none}
.frame__title::placeholder{color:var(--graphite);font-weight:400;font-style:italic}
.frame__title.is-saving{border-color:var(--graphite)}
.frame__title.is-saved{border-color:#2f6b3f}

.drop__title{
  display:block;width:100%;max-width:420px;margin:0 auto 14px;padding:9px 11px;
  border:1px solid var(--rule);border-radius:2px;background:#fff;color:var(--ink);
  font:400 13.5px/1 "IBM Plex Sans",sans-serif;text-align:center;
}
.drop__title:focus{border-color:var(--safelight);outline:none}

.finder{display:flex;gap:8px;margin-bottom:18px}
.finder__input{
  flex:1;padding:9px 11px;border:1px solid var(--rule);border-radius:2px;
  background:var(--paper);color:var(--ink);font-size:13px;
}
.finder__input:focus{border-color:var(--safelight);outline:none}

.empty{
  border:1px solid var(--rule);background:var(--paper);
  padding:56px 24px;text-align:center;color:var(--graphite);
}
.empty h2{font:700 21px/1.2 "IBM Plex Sans Condensed",sans-serif;color:var(--ink);margin:0 0 8px}
.pager{display:flex;gap:10px;justify-content:center;margin-top:34px}
</style>
</head>
<body>
<div class="sprocket sprocket--left" aria-hidden="true" id="sprocket"></div>
<div class="wrap">

  <header class="top">
    <div>
      <span class="eyebrow">Contact sheet &middot; ${escapeHtml(user.username)}</span>
      <h1>Hosted images</h1>
    </div>
    <div class="top__meta">
      <div class="stat"><b>${stats.n}</b>frames</div>
      <div class="stat"><b>${formatBytes(stats.b)}</b>on disk</div>
      <div class="stat"><b>${stats.private_n || 0}</b>private</div>
      <form method="post" action="/images/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <button class="signout" type="submit" style="background:none;border:0;cursor:pointer">Sign out</button>
      </form>
    </div>
  </header>

  <section class="drop" id="drop">
    <h2>Add images</h2>
    <p>Drop files here, paste from the clipboard, or choose them manually. PNG, JPEG, GIF, WebP and AVIF.</p>
    <input type="file" id="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif">
    <input class="drop__title" id="uptitle" type="text" maxlength="120"
           placeholder="Title (optional &mdash; defaults to the filename)" aria-label="Title for new uploads">
    <div class="drop__controls">
      <button class="btn btn--ghost" id="pick" type="button">Choose files</button>
      <fieldset class="vis-pick">
        <legend>New uploads are</legend>
        <label><input type="radio" name="vis" value="public" checked> Public</label>
        <label><input type="radio" name="vis" value="private"> Private</label>
      </fieldset>
    </div>
  </section>

  <form class="finder" method="get" action="/images">
    <input class="finder__input mono" type="search" name="q" value="${escapeHtml(search)}"
           placeholder="Search titles, filenames or IDs" aria-label="Search images">
    <button class="btn btn--ghost" type="submit">Search</button>
    ${search ? '<a class="btn btn--ghost" href="/images">Clear</a>' : ''}
  </form>

  <div id="status" role="status" aria-live="polite"></div>

  ${images.length ? `<div class="sheet">${frames}</div>` : `
  <div class="empty">
    <h2>${search ? 'No matches' : 'The sheet is blank'}</h2>
    <p>${search
      ? 'Nothing matched that search. Try a different term, or clear it to see everything.'
      : 'Upload your first image and its address will appear here, ready to copy.'}</p>
  </div>`}

  ${(page > 0 || hasNext) ? `<nav class="pager">
    ${page > 0 ? `<a class="btn btn--ghost" href="/images?page=${page - 1}${search ? '&q=' + encodeURIComponent(search) : ''}">Newer</a>` : ''}
    ${hasNext ? `<a class="btn btn--ghost" href="/images?page=${page + 1}${search ? '&q=' + encodeURIComponent(search) : ''}">Older</a>` : ''}
  </nav>` : ''}

</div>

<script>
(function(){
  var CSRF = ${JSON.stringify(csrf)};
  var status = document.getElementById('status');
  var drop = document.getElementById('drop');
  var input = document.getElementById('file');

  // Fill the sprocket strip to whatever the viewport height is.
  var strip = document.getElementById('sprocket');
  if (strip) {
    var count = Math.ceil(window.innerHeight / 28) + 2;
    for (var i = 0; i < count; i++) strip.appendChild(document.createElement('i'));
  }

  function say(msg, kind){ status.textContent = msg; status.className = kind || ''; }

  function upload(files){
    files = Array.prototype.slice.call(files).filter(function(f){ return f.type.indexOf('image/') === 0; });
    if (!files.length) { say('Those files are not images.', 'err'); return; }
    var fd = new FormData();
    var picked = document.querySelector('input[name=vis]:checked');
    fd.append('visibility', picked ? picked.value : 'public');
    var t = document.getElementById('uptitle');
    if (t && t.value.trim()) fd.append('title', t.value.trim());
    files.forEach(function(f){ fd.append('images', f); });
    say('Uploading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');
    fetch('/images/upload', { method:'POST', body:fd, headers:{ 'X-CSRF-Token': CSRF } })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, body:j }; }); })
      .then(function(res){
        if (!res.ok) { say(res.body.error || 'Upload failed.', 'err'); return; }
        say('Uploaded ' + res.body.uploaded.length + '. Reloading…', 'ok');
        setTimeout(function(){ location.href = '/images'; }, 550);
      })
      .catch(function(){ say('Upload failed. Check your connection and try again.', 'err'); });
  }

  document.getElementById('pick').addEventListener('click', function(){ input.click(); });
  input.addEventListener('change', function(){ if (input.files.length) upload(input.files); });

  ['dragenter','dragover'].forEach(function(e){
    drop.addEventListener(e, function(ev){ ev.preventDefault(); drop.classList.add('is-hot'); });
  });
  ['dragleave','drop'].forEach(function(e){
    drop.addEventListener(e, function(ev){ ev.preventDefault(); drop.classList.remove('is-hot'); });
  });
  drop.addEventListener('drop', function(ev){ if (ev.dataTransfer.files.length) upload(ev.dataTransfer.files); });

  window.addEventListener('paste', function(ev){
    var items = (ev.clipboardData || {}).files;
    if (items && items.length) upload(items);
  });

  document.addEventListener('click', function(ev){
    var copy = ev.target.closest('.btn--copy');
    if (copy) {
      navigator.clipboard.writeText(copy.dataset.url).then(function(){
        var old = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(function(){ copy.textContent = old; }, 1200);
      });
      return;
    }
    var vis = ev.target.closest('.btn--vis');
    if (vis) {
      var next = vis.dataset.next;
      if (next === 'public' && !confirm('Make this image public? Anyone with the address will be able to view it.')) return;
      vis.disabled = true;
      fetch('/images/' + encodeURIComponent(vis.dataset.id), {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': CSRF },
        body: JSON.stringify({ visibility: next })
      }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, body:j }; }); })
        .then(function(res){
          vis.disabled = false;
          if (!res.ok) { say(res.body.error || 'Could not change visibility.', 'err'); return; }
          var isPriv = res.body.visibility === 'private';
          var frame = vis.closest('.frame');
          frame.classList.toggle('is-private', isPriv);
          var tag = frame.querySelector('.tag');
          tag.textContent = isPriv ? 'Private' : 'Public';
          tag.className = 'tag ' + (isPriv ? 'tag--private' : 'tag--public');
          vis.textContent = isPriv ? 'Make public' : 'Make private';
          vis.dataset.next = isPriv ? 'public' : 'private';
          say(isPriv
            ? 'Now private. Note that any copy already cached by Cloudflare may persist briefly.'
            : 'Now public. Anyone with the address can view it.', 'ok');
        })
        .catch(function(){ vis.disabled = false; say('Could not change visibility.', 'err'); });
      return;
    }

    var del = ev.target.closest('.btn--del');
    if (del) {
      if (!confirm('Delete this image? Any page using its address will show a broken image.')) return;
      fetch('/images/' + encodeURIComponent(del.dataset.id), {
        method:'DELETE', headers:{ 'X-CSRF-Token': CSRF }
      }).then(function(r){
        if (!r.ok) { say('Could not delete that image.', 'err'); return; }
        var frame = del.closest('.frame');
        if (frame) frame.remove();
        say('Deleted.', 'ok');
      });
    }
  });

  function saveTitle(input){
    var value = input.value.trim();
    if (value === input.dataset.original) return;
    input.classList.add('is-saving');
    fetch('/images/' + encodeURIComponent(input.dataset.id), {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ title: value })
    }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, body:j }; }); })
      .then(function(res){
        input.classList.remove('is-saving');
        if (!res.ok) { say(res.body.error || 'Could not save the title.', 'err'); return; }
        input.value = res.body.title;
        input.dataset.original = res.body.title;
        input.classList.add('is-saved');
        setTimeout(function(){ input.classList.remove('is-saved'); }, 1200);
      })
      .catch(function(){ input.classList.remove('is-saving'); say('Could not save the title.', 'err'); });
  }

  document.addEventListener('blur', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__title')) saveTitle(ev.target);
  }, true);

  document.addEventListener('keydown', function(ev){
    if (!ev.target.classList || !ev.target.classList.contains('frame__title')) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
    if (ev.key === 'Escape') { ev.target.value = ev.target.dataset.original; ev.target.blur(); }
  });

  function saveTitle(input){
    var value = input.value.trim();
    if (value === input.dataset.last) return;
    input.dataset.last = value;
    fetch('/images/' + encodeURIComponent(input.dataset.id), {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ title: value })
    }).then(function(r){
      if (!r.ok) { say('Could not save that title.', 'err'); return; }
      input.classList.add('is-saved');
      setTimeout(function(){ input.classList.remove('is-saved'); }, 900);
    }).catch(function(){ say('Could not save that title.', 'err'); });
  }

  document.addEventListener('focusout', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__title')) saveTitle(ev.target);
  });
  document.addEventListener('keydown', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__title')) {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
      if (ev.key === 'Escape') { ev.target.value = ev.target.dataset.last || ''; ev.target.blur(); }
    }
  });

  document.addEventListener('focusin', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__url')) ev.target.select();
    if (ev.target.classList && ev.target.classList.contains('frame__title')) {
      ev.target.dataset.last = ev.target.value.trim();
    }
  });
})();
</script>
</body>
</html>`;
}
