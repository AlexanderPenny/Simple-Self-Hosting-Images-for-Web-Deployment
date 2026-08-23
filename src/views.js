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

import { formatBytes, VIDEO_EXTS } from './images.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind:wght@400;500;600&family=Montserrat:wght@600;700&display=swap" rel="stylesheet">
`;

/* Design tokens for a light, minimal aesthetic: light ground, square
   corners, hairline grey borders, one cyan accent, Montserrat for headings
   and Hind for body text. */
const TOKENS = `
:root{
  --primary-color:     #0AA1D6;
  --secondary-color:   #0B306E;
  --black-color:       #1A2A36;
  --dark-color:        #9B9B9B;
  --gray-color:        #777F81;
  --primary-color-200: #E8F0F1;
  --bs-gray-300:       #DCDCDC;
  --light-color:       #fdfdfd;
  --heading-font: "Montserrat", sans-serif;
  --body-font:    "Hind", sans-serif;
  /* Addresses and IDs only: a copyable string benefits from unambiguous
     characters, which neither theme face provides. */
  --mono-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--light-color);
  color:var(--gray-color);
  font-family:var(--body-font);
  font-size:16px;
  line-height:164%;
  letter-spacing:.32px;
  -webkit-font-smoothing:antialiased;
  min-height:100vh;
}
.eyebrow{
  font-family:var(--heading-font);
  font-size:12px;font-weight:600;letter-spacing:.1rem;
  text-transform:uppercase;color:var(--primary-color);
  margin:0 0 12px;display:block;
}
h1{
  font-family:var(--heading-font);
  font-size:clamp(26px,5vw,36px);font-weight:700;
  color:var(--black-color);line-height:1.2;margin:0;
}
button,input{font-family:inherit;font-size:inherit}
a{color:var(--primary-color)}
:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}

/* Square corners, hairline border, cyan on hover: the row treatment reused
   for every interactive surface here. */
.btn{
  cursor:pointer;
  font-family:var(--heading-font);
  font-size:12px;font-weight:600;letter-spacing:.05rem;text-transform:uppercase;
  padding:10px 16px;border-radius:0;
  border:1px solid var(--bs-gray-300);
  background:#fff;color:var(--black-color);
  transition:all .4s ease-in-out;
}
.btn:hover,.btn:focus-visible{
  background:var(--primary-color);border-color:var(--primary-color);color:#fff;
}
.btn--solid{background:var(--black-color);border-color:var(--black-color);color:#fff}
.btn--solid:hover{background:var(--primary-color);border-color:var(--primary-color)}

@media (prefers-reduced-motion:reduce){*{transition:none!important}}
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
${TOKENS}
.stage{min-height:100vh;display:grid;place-items:center;padding:56px 20px}
.card{
  width:100%;max-width:420px;background:#fff;
  border:1px solid var(--bs-gray-300);border-radius:0;padding:38px 34px 32px;
}
.tagline{color:var(--dark-color);margin:10px 0 28px;font-size:15px}
label{display:block;margin-bottom:18px}
.label-text{
  font-family:var(--heading-font);
  font-size:12px;font-weight:600;letter-spacing:.05rem;text-transform:uppercase;
  color:var(--black-color);display:block;margin-bottom:8px;
}
input[type=text],input[type=password]{
  width:100%;padding:12px 13px;border-radius:0;
  border:1px solid var(--bs-gray-300);background:#fff;color:var(--black-color);
  transition:all .4s ease-in-out;
}
input[type=text]:focus,input[type=password]:focus{
  border-color:var(--primary-color);outline:none;background:var(--primary-color-200);
}
.submit{width:100%;margin-top:6px;padding:13px}
.alert{
  border:1px solid var(--primary-color);border-left-width:3px;
  background:var(--primary-color-200);color:var(--black-color);
  padding:11px 14px;margin-bottom:24px;font-size:14px;line-height:1.5;
}
.note{
  margin:26px 0 0;padding-top:18px;border-top:1px solid var(--bs-gray-300);
  color:var(--dark-color);font-size:13px;line-height:1.55;
}
</style>
</head>
<body>
<main class="stage">
  <div class="card">
    <span class="eyebrow">${escapeHtml(siteName)}</span>
    <h1>Image store</h1>
    <p class="tagline">Sign in to upload and manage hosted images.</p>
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
      <button class="btn btn--solid submit" type="submit">Sign in</button>
    </form>
    <p class="note">Repeated failed sign-ins will get your IP address banned at the firewall.</p>
  </div>
</main>
</body>
</html>`;
}

export function dashboardPage({
  user, images, stats, csrf, origin, page, hasNext, search = '', siteName = 'Image store',
}) {
  const frames = images.map((img) => {
    const priv = img.visibility === 'private';
    const isVideo = VIDEO_EXTS.includes(img.ext);
    // Link the extension on so a pasted/copied address plays or displays
    // correctly wherever it lands, rather than relying on the server's
    // fallback content sniffing.
    const url = `${origin}/images/${img.id}.${img.ext}`;
    const dims = img.width && img.height ? `${img.width}&times;${img.height}` : '&mdash;';
    const preview = isVideo
      ? `<video src="/images/${escapeHtml(img.id)}" muted playsinline preload="metadata"></video>`
      : `<img src="/images/${escapeHtml(img.id)}" alt="${escapeHtml(img.title || img.original_name || img.id)}" loading="lazy">`;
    return `
    <figure class="frame ${priv ? 'is-private' : ''}" data-id="${escapeHtml(img.id)}">
      <a class="frame__img" href="/images/${escapeHtml(img.id)}" target="_blank" rel="noopener">
        ${preview}
      </a>
      <figcaption class="frame__body">
        <input class="frame__title" value="${escapeHtml(img.title || '')}"
               placeholder="Untitled" maxlength="120"
               data-id="${escapeHtml(img.id)}"
               data-original="${escapeHtml(img.title || '')}"
               aria-label="Image title">
        <div class="frame__meta">
          <span class="tag ${priv ? 'tag--private' : 'tag--public'}">${priv ? 'Private' : 'Public'}</span>
          <span>${escapeHtml(img.ext)}</span><span>${dims}</span>
          <span>${formatBytes(img.bytes)}</span><span>${img.views} views</span>
        </div>
        <input class="frame__url" value="${escapeHtml(url)}" readonly aria-label="Image address">
        <div class="frame__actions">
          <button class="btn btn--copy" data-url="${escapeHtml(url)}">Copy</button>
          <button class="btn btn--vis" data-id="${escapeHtml(img.id)}"
                  data-next="${priv ? 'public' : 'private'}">${priv ? 'Publish' : 'Hide'}</button>
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
<title>Images &middot; ${escapeHtml(siteName)}</title>
${FONTS}
<style>
${TOKENS}
.page{max-width:1120px;margin:0 auto;padding:64px 20px 72px}

header.top{
  display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;
  justify-content:space-between;
  padding-bottom:22px;border-bottom:1px solid var(--bs-gray-300);margin-bottom:32px;
}
.stats{display:flex;gap:26px;align-items:baseline;flex-wrap:wrap}
.stat{font-size:13px;color:var(--dark-color);line-height:1.3}
.stat b{
  display:block;font-family:var(--heading-font);font-weight:700;
  font-size:20px;color:var(--black-color);
}
.signout{
  font-family:var(--heading-font);font-size:12px;font-weight:600;
  letter-spacing:.05rem;text-transform:uppercase;
  background:none;border:0;padding:0;cursor:pointer;
  color:var(--gray-color);border-bottom:1px solid var(--bs-gray-300);
  transition:all .4s ease-in-out;
}
.signout:hover{color:var(--primary-color);border-color:var(--primary-color)}

/* ---------- upload ---------- */
.drop{
  background:#fff;border:1px solid var(--bs-gray-300);
  padding:32px 24px;text-align:center;margin-bottom:26px;
  transition:all .4s ease-in-out;
}
.drop.is-hot{background:var(--primary-color-200);border-color:var(--primary-color)}
.drop h2{
  font-family:var(--heading-font);font-size:15px;font-weight:600;
  letter-spacing:.05rem;text-transform:uppercase;color:var(--black-color);
  margin:0 0 8px;
}
.drop p{margin:0 0 18px;color:var(--dark-color);font-size:14px;line-height:1.5}
.drop input[type=file]{display:none}
.drop__title{
  display:block;width:100%;max-width:430px;margin:0 auto 16px;
  padding:11px 13px;border:1px solid var(--bs-gray-300);border-radius:0;
  background:#fff;color:var(--black-color);text-align:center;
  transition:all .4s ease-in-out;
}
.drop__title:focus{border-color:var(--primary-color);outline:none;background:var(--primary-color-200)}
.drop__controls{display:flex;gap:20px;align-items:center;justify-content:center;flex-wrap:wrap}
.vis-pick{border:0;margin:0;padding:0;display:flex;gap:16px;align-items:center}
.vis-pick legend{
  float:left;margin-right:14px;padding:0;
  font-family:var(--heading-font);font-size:12px;font-weight:600;
  letter-spacing:.05rem;text-transform:uppercase;color:var(--black-color);
}
.vis-pick label{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px}
.vis-pick input{accent-color:var(--primary-color)}

/* ---------- search ---------- */
.finder{display:flex;gap:10px;margin-bottom:20px}
.finder__input{
  flex:1;padding:11px 13px;border:1px solid var(--bs-gray-300);border-radius:0;
  background:#fff;color:var(--black-color);transition:all .4s ease-in-out;
}
.finder__input:focus{border-color:var(--primary-color);outline:none;background:var(--primary-color-200)}
.finder .btn{display:grid;place-items:center;text-decoration:none}

#status{min-height:22px;margin-bottom:18px;font-size:14px}
#status.ok{color:var(--primary-color)}
#status.err{color:var(--secondary-color);font-weight:500}

/* ---------- sheet ---------- */
.sheet{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.frame{
  margin:0;background:#fff;border:1px solid var(--bs-gray-300);border-radius:0;
  display:flex;flex-direction:column;transition:all .4s ease-in-out;
}
.frame:hover{border-color:var(--primary-color)}
.frame.is-private{border-left:3px solid var(--secondary-color)}
.frame__img{display:block;background:var(--primary-color-200);aspect-ratio:4/3;overflow:hidden}
.frame__img img,.frame__img video{width:100%;height:100%;object-fit:contain;display:block}
.frame__body{padding:14px;display:flex;flex-direction:column;gap:10px}
.frame__title{
  width:100%;padding:6px 8px;border:1px solid transparent;border-radius:0;
  background:transparent;color:var(--black-color);
  font-family:var(--heading-font);font-size:14px;font-weight:600;letter-spacing:.03rem;
  transition:all .4s ease-in-out;
}
.frame__title:hover{border-color:var(--bs-gray-300)}
.frame__title:focus{border-color:var(--primary-color);background:var(--primary-color-200);outline:none}
.frame__title::placeholder{color:var(--dark-color);font-weight:400;font-style:italic}
.frame__title.is-saving{border-color:var(--dark-color)}
.frame__title.is-saved{border-color:var(--primary-color)}

.frame__meta{
  display:flex;flex-wrap:wrap;gap:8px;align-items:center;
  font-size:12px;color:var(--dark-color);line-height:1.4;
}
.tag{
  font-family:var(--heading-font);font-size:10px;font-weight:600;
  letter-spacing:.05rem;text-transform:uppercase;
  padding:3px 8px;border:1px solid;
}
.tag--public{color:var(--primary-color);border-color:var(--primary-color);background:var(--primary-color-200)}
.tag--private{color:#fff;border-color:var(--secondary-color);background:var(--secondary-color)}

.frame__url{
  width:100%;padding:7px 8px;border:1px solid var(--bs-gray-300);border-radius:0;
  background:var(--light-color);color:var(--gray-color);
  font-family:var(--mono-font);font-size:11.5px;
}
.frame__url:focus{border-color:var(--primary-color);outline:none}
.frame__actions{display:flex;gap:6px}
.frame__actions .btn{flex:1;padding:8px 6px;font-size:11px;letter-spacing:.03rem}
.btn--del:hover{background:var(--secondary-color);border-color:var(--secondary-color)}

.empty{
  background:#fff;border:1px solid var(--bs-gray-300);
  padding:64px 24px;text-align:center;color:var(--dark-color);
}
.empty h2{
  font-family:var(--heading-font);font-size:18px;font-weight:700;
  color:var(--black-color);margin:0 0 10px;
}
.empty p{margin:0;font-size:14px}
.pager{display:flex;gap:10px;justify-content:center;margin-top:36px}
.pager .btn{text-decoration:none}
</style>
</head>
<body>
<div class="page">

  <header class="top">
    <div>
      <span class="eyebrow">${escapeHtml(siteName)} &middot; ${escapeHtml(user.username)}</span>
      <h1>Hosted images</h1>
    </div>
    <div class="stats">
      <div class="stat"><b>${stats.n}</b>images</div>
      <div class="stat"><b>${formatBytes(stats.b)}</b>on disk</div>
      <div class="stat"><b>${stats.private_n || 0}</b>private</div>
      <form method="post" action="/images/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <button class="signout" type="submit">Sign out</button>
      </form>
    </div>
  </header>

  <section class="drop" id="drop">
    <h2>Add images</h2>
    <p>Drop files here, paste from the clipboard, or choose them manually.<br>PNG, JPEG, GIF, WebP, AVIF, MP4 and WebM.</p>
    <input class="drop__title" id="uptitle" type="text" maxlength="120"
           placeholder="Title (optional &mdash; defaults to the filename)" aria-label="Title for new uploads">
    <input type="file" id="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm">
    <div class="drop__controls">
      <button class="btn btn--solid" id="pick" type="button">Choose files</button>
      <fieldset class="vis-pick">
        <legend>New uploads are</legend>
        <label><input type="radio" name="vis" value="public" checked> Public</label>
        <label><input type="radio" name="vis" value="private"> Private</label>
      </fieldset>
    </div>
  </section>

  <form class="finder" method="get" action="/images">
    <input class="finder__input" type="search" name="q" value="${escapeHtml(search)}"
           placeholder="Search titles, filenames or IDs" aria-label="Search images">
    <button class="btn" type="submit">Search</button>
    ${search ? '<a class="btn" href="/images">Clear</a>' : ''}
  </form>

  <div id="status" role="status" aria-live="polite"></div>

  ${images.length ? `<div class="sheet">${frames}</div>` : `
  <div class="empty">
    <h2>${search ? 'No matches' : 'Nothing here yet'}</h2>
    <p>${search
      ? 'Nothing matched that search. Try a different term, or clear it to see everything.'
      : 'Upload your first image and its address will appear here, ready to copy.'}</p>
  </div>`}

  ${(page > 0 || hasNext) ? `<nav class="pager">
    ${page > 0 ? `<a class="btn" href="/images?page=${page - 1}${search ? '&q=' + encodeURIComponent(search) : ''}">Newer</a>` : ''}
    ${hasNext ? `<a class="btn" href="/images?page=${page + 1}${search ? '&q=' + encodeURIComponent(search) : ''}">Older</a>` : ''}
  </nav>` : ''}

</div>

<script>
(function(){
  var CSRF = ${JSON.stringify(csrf)};
  var status = document.getElementById('status');
  var drop = document.getElementById('drop');
  var input = document.getElementById('file');

  function say(msg, kind){ status.textContent = msg; status.className = kind || ''; }

  function upload(files){
    files = Array.prototype.slice.call(files).filter(function(f){
      return f.type.indexOf('image/') === 0 || f.type.indexOf('video/') === 0;
    });
    if (!files.length) { say('Those files are not images or videos.', 'err'); return; }
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

  function saveTitle(field){
    var value = field.value.trim();
    if (value === field.dataset.original) return;
    field.classList.add('is-saving');
    fetch('/images/' + encodeURIComponent(field.dataset.id), {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify({ title: value })
    }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, body:j }; }); })
      .then(function(res){
        field.classList.remove('is-saving');
        if (!res.ok) { say(res.body.error || 'Could not save the title.', 'err'); return; }
        field.value = res.body.title;
        field.dataset.original = res.body.title;
        field.classList.add('is-saved');
        setTimeout(function(){ field.classList.remove('is-saved'); }, 1200);
      })
      .catch(function(){ field.classList.remove('is-saving'); say('Could not save the title.', 'err'); });
  }

  document.addEventListener('blur', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__title')) saveTitle(ev.target);
  }, true);

  document.addEventListener('keydown', function(ev){
    if (!ev.target.classList || !ev.target.classList.contains('frame__title')) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); }
    if (ev.key === 'Escape') { ev.target.value = ev.target.dataset.original; ev.target.blur(); }
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
          vis.textContent = isPriv ? 'Publish' : 'Hide';
          vis.dataset.next = isPriv ? 'public' : 'private';
          say(isPriv
            ? 'Now private. Any copy already cached by a CDN may persist briefly.'
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

  document.addEventListener('focusin', function(ev){
    if (ev.target.classList && ev.target.classList.contains('frame__url')) ev.target.select();
  });
})();
</script>
</body>
</html>`;
}
