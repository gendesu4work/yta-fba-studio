let S = null;
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => 'file:///' + encodeURI(p.replace(/\\/g, '/'));
let view = 'setup';

async function call(name, ...a) {
  const r = await window.api[name](...a);
  if (!r.ok) { alert(r.error); return null; }
  return r.data;
}

// ---------- stable rendering: never replace buttons under the mouse ----------
// 1) A view's HTML is only replaced when it actually changed (state updates arrive constantly while a task runs).
//    Unchanged content keeps its elements, so a click that is in progress is never lost; handlers are simply re-bound.
document.querySelectorAll('main .view').forEach((v) => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'); let last = null;
  Object.defineProperty(v, 'innerHTML', { configurable: true, get() { return d.get.call(this); }, set(h) { if (h === last && this.childElementCount) return; last = h; d.set.call(this, h); } });
});
// 2) While a mouse button is held down, redraws wait; they catch up right after the click has been delivered.
let ptrDown = false;
document.addEventListener('pointerdown', () => { ptrDown = true; }, true);
const ptrUp = () => { if (!ptrDown) return; ptrDown = false; setTimeout(() => render(), 120); };
document.addEventListener('pointerup', ptrUp, true);
document.addEventListener('pointercancel', ptrUp, true);
window.addEventListener('blur', () => { ptrDown = false; });

// ---------- navigation ----------
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; show(); }));
$('#openFolder').onclick = () => call('openFolder', '');
$('#mStop').onclick = () => call('cancel');
function show() {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  render();
}

// ---------- progress meter ----------
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
function renderMeter(p) {
  const m = $('#meter');
  m.classList.toggle('idle', !p.active && !p.steps.length);
  $('#mTitle').textContent = p.steps.length ? p.title : 'Idle';
  const tk = p.tokens && (p.tokens.fresh || p.tokens.cached) ? ` · ≈ ${fmtTok(p.tokens.fresh)} tokens` : '';
  $('#mPct').textContent = p.steps.length ? p.pct + '%' + tk : '';
  $('#mFill').style.width = p.pct + '%';
  $('#mStop').hidden = !p.active;
  $('#mSteps').innerHTML = p.steps.map((s) => `<span class="chip ${s.status}">${s.status === 'done' ? '✓ ' : s.status === 'error' ? '✗ ' : ''}${esc(s.label)}</span>`).join('');
  const last = p.feed.slice(-2).map((f) => esc(f.msg)).join('<br>');
  $('#mFeed').innerHTML = last || (p.steps.length ? 'Working…' : 'Nothing running.');
}

// ---------- setup ----------
const SITES = [
  ['elevenlabs', 'ElevenLabs', 'https://elevenlabs.io/app/sign-in', 'Voiceovers'],
  ['flow', 'Google Flow', 'https://labs.google/fx/tools/flow', 'Images and video clips (needs a Google account with Flow access)'],
  ['facebook', 'Facebook / Meta Business Suite', 'https://business.facebook.com/', 'Reels on your Page'],
  ['youtube', 'YouTube Studio', 'https://studio.youtube.com/', 'Shorts'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/login', 'TikTok videos'],
  ['instagram', 'Instagram', 'https://www.instagram.com/accounts/login/', 'Reels'],
];
function renderSetup() {
  const st = S.setup, lg = st.logins || {};
  const dot = (ok, unknown) => `<span class="dot ${unknown ? '' : ok ? 'ok' : 'bad'}">${unknown ? '·' : ok ? '✓' : '✗'}</span>`;
  const ready = S.ready;
  $('#view-setup').innerHTML = `
  <h1>Setup</h1><p class="sub">Do these once. Then press <b>Check my setup</b> and the app verifies everything before you create anything.</p>
  ${ready ? '<div class="banner ok">✓ Everything is connected. You are ready to create and post.</div>' : '<div class="banner warn">Not ready yet. Follow the steps below, then run the check.</div>'}
  <div class="card"><h2 style="margin-top:0">Step 1 · Claude account</h2>
    <ol class="how"><li>Install <b>Claude Code</b> from <a href="#" data-url="https://claude.com/product/claude-code" style="color:var(--accent2)">claude.com/product/claude-code</a>.</li>
    <li>Open a terminal once, run <b>claude</b> and sign in with your Claude account.</li></ol>
    <div class="chk">${dot(st.claude && st.claude.ok, !st.claude)}<div>Claude Code + account<div class="muted">${esc(st.claude ? st.claude.note : 'Not checked yet')}${S.claudePath ? '' : ' · not found on this PC'}</div></div></div></div>
  <div class="card"><h2 style="margin-top:0">Step 2 · Claude in Chrome</h2>
    <ol class="how"><li>In Chrome, install the <b>Claude in Chrome</b> extension from the Chrome Web Store and sign in to it with the same Claude account.</li><li>Keep Chrome open while the app works.</li></ol>
    <div class="chk">${dot(st.chrome && st.chrome.ok, !st.chrome)}<div>Claude can control Chrome<div class="muted">${esc(st.chrome ? st.chrome.note : 'Not checked yet')}</div></div></div></div>
  <div class="card"><h2 style="margin-top:0">Step 3 · Log in to these sites in Chrome</h2>
    <p class="muted" style="margin-top:0">Use the accounts you want videos posted to. Claude never switches accounts. You do the logins yourself; the app never sees your passwords.</p>
    ${SITES.map(([id, name, url, why]) => { const x = lg[id]; return `<div class="chk">${dot(x && x.loggedIn, !x)}<div class="grow"><b>${name}</b> <span class="muted">· ${why}</span>${x ? `<div class="muted">${x.loggedIn ? 'Logged in' : 'Not logged in'}${x.note ? ' · ' + esc(x.note) : ''}${id === 'elevenlabs' && x && x.loggedIn ? (x.voiceFound ? ' · voice found' : ' · voice NOT found') : ''}${id === 'facebook' && x && x.loggedIn ? (x.pageFound ? ' · Page found' : ' · Page NOT found') : ''}</div>` : ''}</div><button class="ghost small" data-url="${url}">Open</button></div>`; }).join('')}
  </div>
  <div class="card"><h2 style="margin-top:0">Your details</h2>
    <label class="f">ElevenLabs voice name to use for every video</label><input type="text" id="voice" value="${esc(S.settings.voice)}">
    <label class="f">Facebook Page name (Reels are posted to this Page, never to your personal profile)</label><input type="text" id="fbPage" value="${esc(S.settings.fbPage)}" placeholder="e.g. My Channel Page"></div>
  <button class="btn" id="check" ${S.progress.active ? 'disabled' : ''}>Check my setup</button>
  <span class="muted"> ${st.checkedAt ? 'Last checked ' + new Date(st.checkedAt).toLocaleString() : ''}</span>`;
  $('#voice').onchange = (e) => call('settings', { voice: e.target.value.trim() });
  $('#fbPage').onchange = (e) => call('settings', { fbPage: e.target.value.trim() });
  $('#check').onclick = () => { const ago = Date.now() - (S.setup.checkedAt || 0); if (S.ready && ago < 12 * 3600e3 && !confirm(`Everything was verified ${Math.round(ago / 60000)} minutes ago. Re-checking uses Claude tokens (it opens all six sites). Check again anyway?`)) return; call('check'); };
  document.querySelectorAll('[data-url]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); call('openUrl', a.dataset.url); }));
}

// ---------- create ----------
const viralColor = (n) => (n >= 75 ? '#16a34a' : n >= 55 ? '#f59e0b' : '#ef4444');
function viralHtml(v) {
  if (!v) return '';
  const sub = [['Hook', v.hook], ['Retention', v.retention], ['Shares', v.shares], ['Trend', v.trend], ['Relatable', v.relatable]];
  return `<div class="viral"><div class="vtop"><b style="color:${viralColor(v.score)}">${v.score}% viral potential</b><div class="vbar"><span style="width:${v.score}%;background:${viralColor(v.score)}"></span></div></div>
    <div class="vsubs">${sub.map(([l, n]) => `<span title="${l}: ${n}/100"><i>${l}</i> ${n}</span>`).join('')}</div>
    ${v.why ? `<div class="muted tiny">${esc(v.why)}</div>` : ''}<div class="muted tiny">AI estimate, not a guarantee.</div></div>`;
}
function renderCreate() {
  const s = S.settings, left = Math.max(0, S.maxPerDay - S.usedToday), cap = Math.min(5, left);
  const nicheCards = S.niches.map((n) => `<button class="niche ${s.niche === n.id ? 'sel' : ''}" data-niche="${n.id}"><b>${n.name}</b><span>${esc(n.blurb)}</span></button>`).join('');
  const ideas = S.ideas.map((i) => {
    const on = S.selected.includes(i.id), off = !on && S.selected.length >= cap;
    return `<div class="idea ${on ? 'sel' : ''} ${off ? 'off' : ''}" data-idea="${i.id}"><div class="ck">${on ? '✓' : ''}</div><div><b>${esc(i.title)}</b> <span class="tag">${esc(i.hookType)}</span><div class="hook">“${esc(i.hook)}”</div><div>${esc(i.premise)}</div><div class="muted">Takeaway: ${esc(i.takeaway)}</div>${viralHtml(i.virality)}</div></div>`;
  }).join('');
  const scripts = Object.entries(S.posts).filter(([, p]) => p.status === 'script').map(([slug, p]) => `
    <div class="card" data-slug="${slug}"><div class="row"><b class="grow">${esc(p.post.title)}</b><span class="badge ${p.approved ? 'done' : 'waiting'}">${p.approved ? 'Approved' : 'Needs approval'}</span></div>
    <label class="f">Title</label><input type="text" data-f="title" value="${esc(p.post.title)}">
    <label class="f">Voiceover (ElevenLabs v4 tags in [brackets])</label><textarea data-f="voiceover">${esc(p.post.voiceover)}</textarea>
    <div class="muted tiny">${p.post.voiceover.length} characters</div>
    <details><summary class="muted">${p.post.scenes.length} scenes</summary>${p.post.scenes.map((sc, i) => `<div class="scene"><b>${i + 1}. ${sc.type === 'video' ? 'Video' : 'Picture'} · ${sc.seconds}s</b> ${esc(sc.prompt)}</div>`).join('')}</details>
    <div class="row" style="margin-top:10px"><button class="ghost small" data-act="approve">${p.approved ? 'Un-approve' : 'Approve script'}</button><button class="danger small" data-act="discard">Discard</button></div></div>`).join('');
  const approved = Object.values(S.posts).filter((p) => p.status === 'script' && p.approved).length;
  const total = Object.values(S.posts).filter((p) => p.status === 'script').length;
  const vids = Math.max(1, s.videoCount || 1);
  const modeNote = { auto: 'The AI decides which phrases become videos (up to 6 per short).', mixed: `About ${vids * 3} Flow credits per short for ${vids} video${vids > 1 ? 's' : ''} (3-second Omni 1.2 Flash clips, about 3 credits each).`, images: 'No video clips, so no video credits.', videos: 'Every phrase is a 3-second Omni 1.2 Flash clip: about 3 Flow credits per phrase.' }[s.mediaMode] || '';
  $('#view-create').innerHTML = `
  <h1>Create</h1><p class="sub">Pick a niche, get today's ideas, choose up to 5, and let Claude do the rest.</p>
  <div class="card"><div class="row"><div class="grow"><b>AI model</b><div class="muted">Currently using <b style="color:var(--text)">Claude ${s.model === 'opus' ? 'Opus' : 'Sonnet'}</b>. ${s.model === 'opus' ? 'Strongest reasoning and writing; slower and uses more of your Claude usage.' : 'Fast, strong writing and uses fewer tokens.'}</div></div>
    <div class="seg" id="model"><button data-model="sonnet" class="${s.model !== 'opus' ? 'on' : ''}">Sonnet</button><button data-model="opus" class="${s.model === 'opus' ? 'on' : ''}">Opus</button></div></div></div>
  <div class="card"><div class="row"><div class="grow"><b>Learned style</b><div class="muted">${S.refs.reduce((n, r) => n + (r.on !== false ? (r.lessons || []).filter((l) => l.on).length : 0), 0)} active lessons from your reference videos are applied to new scripts and visuals. Manage them in Builder.</div></div><button class="ghost" id="goBuilder">Open Builder</button></div></div>
  <h2 style="margin-top:0">1 · Choose your niche</h2><div class="grid">${nicheCards}</div>
  ${s.niche === 'custom' ? `<label class="f">Describe your niche</label><input type="text" id="customNiche" value="${esc(s.customNiche)}" placeholder="e.g. cozy cat stories, space facts for kids…">` : ''}
  <h2>2 · Create the idea for the day</h2>
  <div class="card"><div class="row"><div class="grow"><b>Today's ideas for ${esc((S.niches.find((n) => n.id === s.niche) || {}).name)}</b><div class="muted">Claude writes 10 fresh ideas, each with an estimated viral potential. Choose 1 to ${cap} (max 5 a day to keep your content original). ${S.usedToday}/${S.maxPerDay} made today.</div></div>
  <button class="btn" id="mkIdeas" ${S.progress.active || left <= 0 ? 'disabled' : ''}>${S.ideas.length ? 'Create new ideas' : 'Create'}</button></div></div>
  ${ideas ? `<div class="row" style="margin:8px 0"><b>${S.selected.length} of ${cap} selected</b></div>${ideas}<button class="btn" id="mkScripts" ${!S.selected.length || S.progress.active ? 'disabled' : ''}>Write scripts for ${S.selected.length || ''} selected</button>` : ''}
  <h2>3 · Scripts &amp; visuals</h2>
  <div class="card"><div class="row"><div><b>What to generate</b><div class="muted tiny">Every phrase of the voiceover (each comma, pause and sentence end, about every 2-3 seconds) gets its own new scene, so the number of pictures always follows the script. ${modeNote}</div></div>
    <div class="seg" id="mode"><button data-m="auto" class="${s.mediaMode === 'auto' ? 'on' : ''}">Automatic</button><button data-m="mixed" class="${s.mediaMode === 'mixed' ? 'on' : ''}">Mixed</button><button data-m="images" class="${s.mediaMode === 'images' ? 'on' : ''}">Pictures only</button><button data-m="videos" class="${s.mediaMode === 'videos' ? 'on' : ''}">Videos only</button></div></div>
    ${s.mediaMode === 'auto' ? '<div class="muted" style="margin-top:12px">The first shot is always a moving video to hook viewers, and the AI picks video or picture for each following phrase by what keeps it entertaining (up to 6 videos per short to protect your Flow credits; pictures are unlimited).</div>' : ''}
    ${s.mediaMode === 'mixed' ? `<div class="row" style="margin-top:12px"><label>Videos per short: <b id="vcNum">${vids}</b> <input type="range" id="videoCount" min="1" max="15" value="${vids}"></label><span class="muted tiny grow">The first scene is always a video and the others are spread across the story. Every other phrase is a picture.</span></div>` : ''}
    ${s.mediaMode === 'images' ? '<div class="muted tiny" style="margin-top:8px">Heads up: videos that open with a generated video clip tend to hold viewers better. Pictures-only uses slow camera moves instead.</div>' : ''}
  </div>
  <div class="card"><div class="row"><div class="grow"><b>Background music</b><div class="muted">Automatic researches each track's vibe, then picks the best match for every video.</div></div>
    <select id="musicSel" style="width:260px"><option value="auto" ${s.music === 'auto' ? 'selected' : ''}>Automatic (best match)</option><option value="none" ${s.music === 'none' ? 'selected' : ''}>No music</option>${S.tracks.map((t) => `<option value="${esc(t.file)}" ${s.music === t.file ? 'selected' : ''}>${esc(t.file.replace(/\.[^.]+$/, ''))}</option>`).join('')}</select></div>
    ${!S.tracks.length ? '<div class="muted tiny">No tracks yet. Add some in the Music tab.</div>' : ''}</div>
  <div class="card"><div class="row"><label class="switch"><input type="checkbox" id="auto" ${s.autoApprove ? 'checked' : ''}><span class="tr"></span><b>Auto approve</b></label><span class="muted grow">When on, scripts are approved automatically and Claude goes straight to Google Flow, then schedules the posts. When off, you review each script and each finished video.</span></div></div>
  ${scripts}
  ${total ? `<div class="row"><button class="ghost" id="approveAll">Approve all</button><button class="btn" id="make" ${!approved || S.progress.active ? 'disabled' : ''}>Make ${approved} video${approved === 1 ? '' : 's'} in Google Flow</button></div>` : '<p class="muted">Scripts will appear here after you pick ideas.</p>'}`;
  document.querySelectorAll('#model button').forEach((b) => (b.onclick = () => call('settings', { model: b.dataset.model })));
  $('#goBuilder').onclick = () => { view = 'builder'; show(); };
  $('#musicSel').onchange = (e) => call('settings', { music: e.target.value });
  document.querySelectorAll('[data-niche]').forEach((b) => (b.onclick = () => call('settings', { niche: b.dataset.niche })));
  const cn = $('#customNiche'); if (cn) cn.onchange = (e) => call('settings', { customNiche: e.target.value });
  $('#mkIdeas').onclick = () => call('ideas');
  document.querySelectorAll('[data-idea]').forEach((d) => (d.onclick = async () => {
    const id = d.dataset.idea; let sel = [...S.selected];
    if (sel.includes(id)) sel = sel.filter((x) => x !== id); else if (sel.length < cap) sel.push(id); else return;
    S.selected = sel; render(); await call('select', sel);
  }));
  const mk = $('#mkScripts'); if (mk) mk.onclick = () => call('scripts');
  document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => call('settings', { mediaMode: b.dataset.m })));
  const vc = $('#videoCount'); if (vc) { vc.oninput = (e) => { $('#vcNum').textContent = e.target.value; }; vc.onchange = (e) => call('settings', { videoCount: +e.target.value }); }
  $('#auto').onchange = (e) => call('settings', { autoApprove: e.target.checked });
  document.querySelectorAll('[data-slug]').forEach((c) => {
    const slug = c.dataset.slug;
    c.querySelectorAll('[data-f]').forEach((f) => (f.onchange = () => call('updatePost', slug, { [f.dataset.f]: f.value })));
    c.querySelector('[data-act=approve]').onclick = () => call('approveScript', slug, !S.posts[slug].approved);
    c.querySelector('[data-act=discard]').onclick = () => call('discard', slug);
  });
  const aa = $('#approveAll'); if (aa) aa.onclick = async () => { for (const [slug, p] of Object.entries(S.posts)) if (p.status === 'script') await call('approveScript', slug, true); };
  const make = $('#make'); if (make) make.onclick = () => call('produce');
}

// ---------- upload & schedule ----------
const PL = { youtube: 'YouTube Shorts', tiktok: 'TikTok', facebook: 'Facebook Reels', instagram: 'Instagram Reels' };
const fmtWhen = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const fixNotes = {};
const contBtn = (slug, busy) => {
  const f = (S.progressFiles || {})[slug]; if (!f || !f.clips) return '';
  return `<button class="ghost small" data-cont="${slug}" ${busy || !f.voice ? 'disabled' : ''} title="${f.voice ? 'Finish the video now with the voiceover, script and clips already made. Nothing new is generated.' : 'No voiceover yet: use Retry.'}">Continue (${f.clips}/${f.scenes} scenes)</button>`;
};
const retryUI = {}; // slug -> { open, what, videos } (kept across re-renders)
const retryPanel = (slug, p, busy) => {
  const r = retryUI[slug]; if (!r || !r.open) return '';
  const n = Math.max(1, (S.beatCounts && S.beatCounts[slug]) || p.post.scenes.length), cur = p.post.scenes.filter((x) => x.type === 'video').length;
  if (r.videos == null) r.videos = Math.max(1, cur);
  const scheduled = p.upload && Object.values(p.upload).some((u) => u.status === 'scheduled');
  const opt = (k, t, d) => `<label class="retryopt ${r.what === k ? 'on' : ''}"><input type="radio" name="retry-${slug}" data-retrywhat="${slug}|${k}" ${r.what === k ? 'checked' : ''}><div><b>${t}</b><div class="muted tiny">${d}</div></div></label>`;
  return `<div class="fixbox"><b>What do you want to retry?</b>
    <div class="retryopts">
      ${opt('script', 'Script', 'Write a new script on the same topic and replace this one. Then a new voiceover and all new pictures and videos are made.')}
      ${opt('voice', 'Voiceover', 'Record the voiceover again from the same script. The pictures and videos are kept.')}
      ${opt('visuals', 'All scenes', `Make every picture and video again, one scene per phrase (${n} scenes${p.post.scenes.length !== n ? `; this video has only ${p.post.scenes.length} now, so the scenes are rebuilt first` : ''}).`)}
    </div>
    ${r.what === 'visuals' ? `<div class="row" style="margin-top:10px"><label>Videos in this short: <b data-retryvn="${slug}">${r.videos}</b> <input type="range" min="1" max="${n}" value="${r.videos}" data-retryvids="${slug}"></label>
      <span class="muted tiny grow" data-retryvinfo="${slug}">${r.videos} video${r.videos > 1 ? 's' : ''} + ${n - r.videos} picture${n - r.videos === 1 ? '' : 's'} · about ${r.videos * 3} Flow credits for the videos (3-second clips). The first scene is always a video.</span></div>` : ''}
    ${scheduled ? '<div class="muted tiny" style="margin-top:8px">This video is already scheduled. The old scheduled posts are removed and replaced when you accept the new version.</div>' : ''}
    <div class="row" style="margin-top:10px"><button class="btn" data-retrygo="${slug}" ${busy || !r.what ? 'disabled' : ''}>Start retry</button><button class="ghost" data-retryx="${slug}">Cancel</button></div></div>`;
};
const toLocalInput = (t) => { if (!t) return ''; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const reportHtml = (r) => !r ? '' : r.ok
  ? `<div class="rep ok">Checked: no problems found. Audio ${r.info.audioSeconds}s of ${r.info.voiceSeconds}s voice, captions in sync.</div>`
  : `<div class="rep bad"><b>Problems found</b><ul>${r.issues.map((i) => `<li>${esc(i.text)}</li>`).join('')}</ul></div>`;
function renderUpload() {
  const recs = Object.entries(S.posts).filter(([, p]) => ['ready', 'making', 'failed'].includes(p.status));
  const ready = recs.filter(([, p]) => p.status === 'ready');
  const busy = S.progress.active;
  const cards = ready.map(([slug, p]) => {
    const fx = p.fix;
    const fixBlock = !fx ? '' : fx.status === 'working' ? '<div class="rep wait">Fixing the video: re-timing the captions and rebuilding the audio…</div>'
      : fx.status === 'failed' ? `<div class="rep bad">The fix failed: ${esc(fx.error || '')}</div>`
      : `<div class="fixbox"><b>Fixed version</b><div class="row" style="align-items:flex-start;gap:14px;margin-top:8px"><video controls preload="metadata" src="${fileUrl(fx.files.final)}"></video><div class="grow">${reportHtml(fx.report)}
          <div class="muted tiny">${p.upload && Object.values(p.upload).some((u) => u.status === 'scheduled') ? 'Approving replaces the old video with this one. It is NOT posted yet: press Accept &amp; schedule again, and the old scheduled posts are replaced then.' : 'Approving replaces the old video with this one. It is NOT scheduled yet: press Accept &amp; schedule afterwards.'}</div>
          <div class="row" style="margin-top:10px"><button class="btn" data-apfix="${slug}" ${busy ? 'disabled' : ''}>Approve fix</button><button class="ghost" data-dsfix="${slug}">Discard</button></div></div></div></div>`;
    const plat = p.accepted ? Object.entries(p.upload || {}).map(([pl, u]) => {
      const retry = ['failed', 'queued', 'stopped'].includes(u.status) && pl !== 'instagram';
      const igRetry = pl === 'instagram' && ['failed', 'stopped'].includes(u.status);
      return `<div class="plat"><span class="badge ${u.status}">${u.status}</span><b>${PL[pl]}</b>${u.when ? `<span class="muted">${fmtWhen(u.when)}</span>` : ''}<span class="muted grow" style="min-width:0">${esc((u.detail || '').slice(0, 140))}</span>${retry || igRetry ? `<button class="ghost small" data-retryup="${slug}|${pl}" ${busy ? 'disabled' : ''}>Retry upload</button>` : ''}</div>`;
    }).join('') : '';
    const anyRetry = p.accepted && Object.entries(p.upload || {}).some(([pl, u]) => pl !== 'instagram' && ['failed', 'queued', 'stopped'].includes(u.status));
    return `<div class="card"><div class="row" style="align-items:flex-start;gap:16px"><video controls preload="metadata" src="${fileUrl(p.files.final)}"></video>
      <div class="grow"><b>${esc(p.post.title)}</b><div class="muted">${Math.round(p.files.seconds)}s · ${esc(p.post.short_caption)}</div>${p.music ? `<div class="muted tiny">Music: ${p.music.file ? esc(p.music.file.replace(/\.[^.]+$/, '')) : 'none'} · ${esc(p.music.reason || '')}</div>` : ''}
      <div class="row" style="margin:10px 0 4px"><button class="ghost" data-retryopen="${slug}" ${busy ? 'disabled' : ''}>Retry</button><input type="text" class="fixnote" data-fixnote="${slug}" value="${esc(fixNotes[slug] || '')}" placeholder="What needs fixing? e.g. visuals change too early" style="flex:1;min-width:200px"><button class="ghost" data-fix="${slug}" ${busy || (fx && fx.status === 'working') ? 'disabled' : ''}>Fix</button>
        ${p.accepted ? '' : `<button class="btn" data-acc="${slug}" ${busy ? 'disabled' : ''}>Accept &amp; schedule</button><button class="danger" data-rej="${slug}">Reject</button>`}</div>
      ${reportHtml(p.review)}
      ${p.accepted ? `<div style="margin:10px 0 6px"><b>Posting time:</b> ${fmtWhen(p.slot)} <span class="muted">(US prime time, checked against the clock before each upload)</span></div>${plat}${anyRetry ? `<div style="margin-top:8px"><button class="btn small" data-retryall="${slug}" ${busy ? 'disabled' : ''}>Retry all unfinished uploads</button></div>` : ''}`
        : `<div class="row" style="margin:8px 0"><label class="muted">Post at (optional, your local time):</label><input type="datetime-local" data-slotin="${slug}" value="${toLocalInput(p.customSlot)}" style="width:210px"><button class="ghost small" data-slotclr="${slug}" ${p.customSlot ? '' : 'hidden'}>Use automatic time</button></div>
        <div class="muted" style="margin:0 0 8px">${p.customSlot ? 'It will be scheduled for the time you chose.' : 'Leave it empty and it is scheduled for the next US prime-time slot (at a slightly different minute each time, like 12:17 or 7:42 PM ET), and posted to Instagram at that time.'}</div>`}
      </div></div>${retryPanel(slug, p, busy)}${fixBlock}</div>`;
  }).join('');
  const failed = recs.filter(([, p]) => p.status === 'failed').map(([slug, p]) => `<div class="card"><div class="row"><b class="grow">${esc(p.post.title)}</b><span class="badge failed">failed</span>${contBtn(slug, busy)}<button class="btn small" data-retryprod="${slug}" ${busy ? 'disabled' : ''}>Retry</button></div><div class="muted">${esc(p.error || '')}</div></div>`).join('');
  const jobs = S.jobs.filter((j) => j.status !== 'done').map((j) => `<div class="plat"><span class="badge ${j.status}">${j.status}</span>${j.kind === 'post' ? 'Instagram post' : j.platform + ' comment'} · ${esc((S.posts[j.slug] || { post: { title: j.slug } }).post.title)} · ${new Date(j.runAt).toLocaleString()} ${j.status === 'failed' ? `<button class="ghost small" data-retry="${esc(j.id)}" ${busy ? 'disabled' : ''}>Retry</button><span class="muted">${esc((j.detail || '').slice(0, 120))}</span>` : ''}</div>`).join('');
  $('#view-upload').innerHTML = `<h1>Upload &amp; Schedule</h1><p class="sub">Times are chosen for US audiences across the day (morning to late evening Eastern), spaced hours apart, and re-checked against the clock right before each upload. ${S.settings.autoApprove ? '<b>Auto approve is on</b>, so finished videos schedule themselves.' : ''}</p>
  <div class="card"><div class="row"><label class="switch"><input type="checkbox" id="jitter" ${S.settings.slotJitter !== false ? 'checked' : ''}><span class="tr"></span><b>Vary the minutes</b></label><span class="muted grow">Posts go out at natural-looking times (like 12:17 or 7:42 PM ET) instead of exactly on the hour. Or pick your own time on each video.</span></div></div>
  <div class="card"><div class="row"><label class="switch"><input type="checkbox" id="parup" ${S.settings.parallelUploads !== false ? 'checked' : ''}><span class="tr"></span><b>Upload to all platforms at once</b></label><span class="muted grow">YouTube, TikTok and Facebook are filled in at the same time in separate Chrome tabs. Turn it off if Chrome gets confused (they then go one after another).</span></div></div>
  <div class="card"><b>Next open slots</b><div class="muted">${S.slotsPreview.slice(0, 3).map((x) => `${x.local} (${x.et})`).join(' · ')}</div></div>
  ${cards || '<p class="muted">No finished videos yet. Make some on the Create tab.</p>'}${failed}
  ${jobs ? `<h2>Timed tasks (the app and Chrome must be open)</h2><div class="card">${jobs}</div>` : ''}`;
  document.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => call('accept', b.dataset.acc)));
  document.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => call('reject', b.dataset.rej)));
  document.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = () => call('retryJob', b.dataset.retry)));
  document.querySelectorAll('[data-retryopen]').forEach((b) => (b.onclick = () => { const k = b.dataset.retryopen; retryUI[k] = retryUI[k] && retryUI[k].open ? { open: false } : { open: true, what: null }; renderUpload(); }));
  document.querySelectorAll('[data-retryx]').forEach((b) => (b.onclick = () => { retryUI[b.dataset.retryx] = { open: false }; renderUpload(); }));
  document.querySelectorAll('[data-retrywhat]').forEach((i) => (i.onchange = () => { const [k, w] = i.dataset.retrywhat.split('|'); retryUI[k].what = w; renderUpload(); }));
  document.querySelectorAll('[data-retryvids]').forEach((i) => (i.oninput = () => {
    const k = i.dataset.retryvids, v = +i.value, n = +i.max; retryUI[k].videos = v;
    document.querySelector(`[data-retryvn="${k}"]`).textContent = v;
    document.querySelector(`[data-retryvinfo="${k}"]`).textContent = `${v} video${v > 1 ? 's' : ''} + ${n - v} picture${n - v === 1 ? '' : 's'} · about ${v * 3} Flow credits for the videos (3-second clips). The first scene is always a video.`;
  }));
  document.querySelectorAll('[data-retrygo]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.retrygo, r = retryUI[k]; if (!r || !r.what) return;
    b.disabled = true; retryUI[k] = { open: false };
    await call('redo', k, r.what, r.videos);
  }));
  document.querySelectorAll('[data-fixnote]').forEach((i) => { i.oninput = () => { fixNotes[i.dataset.fixnote] = i.value; }; i.onkeydown = (e) => { if (e.key === 'Enter') { const b = document.querySelector(`[data-fix="${i.dataset.fixnote}"]`); if (b && !b.disabled) b.click(); } }; });
  document.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => { const n = fixNotes[b.dataset.fix] || ''; delete fixNotes[b.dataset.fix]; call('fix', b.dataset.fix, n); }));
  document.querySelectorAll('[data-slotin]').forEach((i) => (i.onchange = () => call('customSlot', i.dataset.slotin, i.value ? new Date(i.value).getTime() : null)));
  document.querySelectorAll('[data-slotclr]').forEach((b) => (b.onclick = () => call('customSlot', b.dataset.slotclr, null)));
  const pu = $('#parup'); if (pu) pu.onchange = (e) => call('settings', { parallelUploads: e.target.checked });
  const jt = $('#jitter'); if (jt) jt.onchange = (e) => call('settings', { slotJitter: e.target.checked });
  document.querySelectorAll('[data-apfix]').forEach((b) => (b.onclick = () => call('approveFix', b.dataset.apfix)));
  document.querySelectorAll('[data-dsfix]').forEach((b) => (b.onclick = () => call('discardFix', b.dataset.dsfix)));
  document.querySelectorAll('[data-retryup]').forEach((b) => (b.onclick = () => { const [s, pl] = b.dataset.retryup.split('|'); call('retryUpload', s, pl); }));
  document.querySelectorAll('[data-retryall]').forEach((b) => (b.onclick = () => call('retryUpload', b.dataset.retryall, null)));
  document.querySelectorAll('[data-cont]').forEach((b) => (b.onclick = () => { b.disabled = true; call('continueVideo', b.dataset.cont); }));
  document.querySelectorAll('[data-retryprod]').forEach((b) => (b.onclick = () => call('retryProduce', b.dataset.retryprod)));
}

// ---------- poster (Facebook / Instagram picture posts) ----------
const PFONTS = [['Rounded', 'Rounded bold'], ['Impact', 'Impact'], ['Arial Black', 'Arial Black'], ['Bahnschrift', 'Bahnschrift'], ['Segoe UI', 'Segoe UI Bold'], ['Georgia', 'Georgia Bold']];
const PW = 1080, PH = 1080; // always square 1:1 with one hook caption (user's standing rule)
const pImgs = {}; // "id|file" -> Image (or 'loading')
const pNotes = {};
function posterImg(id, file) {
  const k = id + '|' + file, v = pImgs[k];
  if (v && v !== 'loading') return v;
  if (!v) {
    pImgs[k] = 'loading';
    window.api.posterImage(id, file).then((r) => {
      if (!r.ok) { delete pImgs[k]; return; }
      const im = new Image(); im.onload = () => { pImgs[k] = im; drawPosters(); }; im.src = r.data;
    });
  }
  return null;
}
// "*word*" marks accent-coloured words
function pTokens(text) {
  const out = [];
  String(text).split(/(\*[^*]+\*)/).forEach((part) => {
    const hi = /^\*[^*]+\*$/.test(part);
    (hi ? part.slice(1, -1) : part).split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, hi }));
  });
  return out;
}
function pWrap(x, toks, maxW) {
  const sp = x.measureText(' ').width, lines = []; let cur = [], w = 0;
  for (const t of toks) {
    t.width = x.measureText(t.w).width;
    const add = (cur.length ? sp : 0) + t.width;
    if (cur.length && w + add > maxW) { lines.push({ toks: cur, w }); cur = [t]; w = t.width; } else { cur.push(t); w += add; }
  }
  if (cur.length) lines.push({ toks: cur, w });
  return lines;
}
function drawPoster(cv, img, t) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, k = W / PW;
  x.clearRect(0, 0, W, H); x.fillStyle = '#1b1f27'; x.fillRect(0, 0, W, H);
  if (img) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  // always: darken the picture and add a vignette, so the hook caption in front pops (user's standing rule)
  const dk = t && t.dark != null ? t.dark : 0.75;
  x.fillStyle = `rgba(0,0,0,${(0.12 + 0.38 * dk).toFixed(3)})`; x.fillRect(0, 0, W, H);
  const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.hypot(W, H) / 2);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${(0.45 + 0.5 * dk).toFixed(3)})`);
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  if (!t) return;
  const fam = t.font || 'Rounded', weight = fam === 'Impact' ? '400' : '800', maxW = W * 0.84;
  const famCss = (fam === 'Rounded' ? '"Arial Rounded MT Bold", "Segoe UI Black"' : `"${fam}"`) + ', "Segoe UI Emoji", sans-serif';
  let scale = (t.size || 1);
  const build = () => [t.headline].map((txt, i) => {
    if (!txt) return null;
    const px = Math.round(W * 0.075 * scale), font = `${weight} ${px}px ${famCss}`;
    x.font = font;
    return { px, font, lh: px * 1.14, lines: pWrap(x, pTokens(t.upper ? txt.toUpperCase() : txt), maxW) };
  }).filter(Boolean);
  let blocks = build();
  const hOf = (g) => g.reduce((a, b, i) => a + b.lines.length * b.lh + (i ? b.px * 0.45 : 0), 0);
  for (let n = 0; n < 8 && hOf(blocks) > H * 0.42; n++) { scale *= 0.9; blocks = build(); }
  const foot = t.footer ? Math.round(W * 0.026) : 0, padY = H * 0.055, bottomEdge = H - padY - (foot ? foot * 1.8 : 0);
  const groups = [{ g: blocks, pos: ['top', 'center', 'bottom'].includes(t.position) ? t.position : 'top' }];
  for (const G of groups) {
    const gh = hOf(G.g);
    G.y = G.pos === 'top' ? padY : G.pos === 'bottom' ? bottomEdge - gh : (H - gh) / 2;
    G.h = gh;
    if (t.band === 'shade') {
      if (G.pos === 'center') { x.fillStyle = 'rgba(0,0,0,.38)'; x.fillRect(0, 0, W, H); }
      else {
        const top = G.pos === 'top', y0 = top ? 0 : G.y - H * 0.1, y1 = top ? G.y + gh + H * 0.1 : H;
        const gr = x.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(top ? 0 : 1, 'rgba(0,0,0,.78)'); gr.addColorStop(top ? 1 : 0, 'rgba(0,0,0,0)');
        x.fillStyle = gr; x.fillRect(0, y0, W, y1 - y0);
      }
    } else if (t.band === 'box') {
      const bw = Math.max(...G.g.flatMap((b) => b.lines.map((l) => l.w))) + W * 0.07, bx = (W - bw) / 2, by = G.y - H * 0.022, bh = gh + H * 0.044, r = 18 * k;
      x.fillStyle = 'rgba(0,0,0,.62)'; x.beginPath(); x.roundRect(bx, by, bw, bh, r); x.fill();
    }
  }
  x.textBaseline = 'top'; x.lineJoin = 'round';
  for (const G of groups) {
    let y = G.y;
    G.g.forEach((b, i) => {
      if (i) y += b.px * 0.45;
      x.font = b.font; const sp = x.measureText(' ').width;
      for (const ln of b.lines) {
        let cx = (W - ln.w) / 2;
        for (const tk of ln.toks) {
          if (t.stroke) { x.lineWidth = Math.max(2, b.px * 0.14); x.strokeStyle = '#000'; x.strokeText(tk.w, cx, y + (b.lh - b.px) / 2); }
          else { x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = b.px * 0.18; x.shadowOffsetY = b.px * 0.04; }
          x.fillStyle = tk.hi ? (t.accent || '#ffd400') : (t.color || '#fff');
          x.fillText(tk.w, cx, y + (b.lh - b.px) / 2);
          x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
          cx += tk.width + sp;
        }
        y += b.lh;
      }
    });
  }
  if (foot) { x.font = `600 ${foot}px "Segoe UI"`; x.fillStyle = 'rgba(255,255,255,.85)'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = foot * 0.4; const fw = x.measureText(t.footer).width; x.fillText(t.footer, (W - fw) / 2, H - padY * 0.55 - foot); x.shadowColor = 'transparent'; x.shadowBlur = 0; }
}
function drawPosters() {
  if (!S || !S.poster) return;
  document.querySelectorAll('canvas[data-pcv]').forEach((cv) => { const it = S.poster.items[cv.dataset.pcv]; if (it && it.variant) drawPoster(cv, posterImg(it.id, it.variant), it.text); });
  document.querySelectorAll('canvas[data-pth]').forEach((cv) => { const [id, f] = cv.dataset.pth.split('|'); drawPoster(cv, posterImg(id, f), null); });
}
const PST = { queued: ['Waiting', 'waiting'], generating: ['Making the picture', 'running'], editing: ['Ready to edit', ''], failed: ['Picture failed', 'failed'], publishing: ['Posting…', 'running'], scheduled: ['Scheduled', 'scheduled'], posted: ['Posted', 'posted'], attention: ['Needs attention', 'failed'] };
function renderPoster() {
  const P0 = S.poster, busy = S.progress.active, slot = S.posterSlot;
  const niches = S.posterNiches.map((n) => `<button class="niche ${P0.niche === n.id ? 'sel' : ''}" data-pniche="${n.id}"><b>${esc(n.name)}</b><span>${esc(n.blurb)}</span></button>`).join('');
  const ideas = P0.ideas.map((i) => `<div class="idea ${P0.pick === i.id ? 'sel' : ''}" data-pidea="${i.id}"><div class="ck pradio">${P0.pick === i.id ? '✓' : ''}</div><div class="grow">
      <b>${esc(i.text.headline.replace(/\*/g, ''))}</b>${i.angle ? `<span class="tag">${esc(i.angle)}</span>` : ''}${i.realistic ? '<span class="tag">realistic photo · AI label on</span>' : ''}
      <div class="muted tiny">Picture: ${esc(i.imagePrompt)}</div>
      <div class="muted tiny">Caption: ${esc(i.caption)}</div>
      ${i.source ? `<div class="muted tiny">Source: ${esc(i.source)}</div>` : ''}${i.why ? `<div class="muted tiny">Why it works: ${esc(i.why)}</div>` : ''}</div></div>`).join('');
  const items = Object.values(P0.items).sort((a, b) => b.created - a.created);
  const cards = items.map((it) => {
    const [stLabel, stCls] = PST[it.status] || [it.status, ''];
    const t = it.text, locked = !!it.upload && it.status !== 'editing';
    const head = `<div class="row"><b class="grow">${esc(t.headline.replace(/\*/g, '') || it.title)}</b><span class="muted tiny" style="margin:0">${esc(it.niche)}</span><span class="badge ${stCls}">${stLabel}</span><button class="ghost small" data-pfold="${it.id}">Folder</button>${locked && Object.values(it.upload).some((u) => u.status === 'scheduled') ? '' : `<button class="danger small" data-pdel="${it.id}" ${it.status === 'publishing' || it.status === 'generating' ? 'disabled' : ''}>Remove</button>`}</div>`;
    if (!it.variants.length) {
      return `<div class="card">${head}${it.status === 'generating' || it.status === 'queued' ? '<div class="rep wait">Claude is making the picture in Google Flow (Chrome). You can watch the progress at the bottom.</div>' : `<div class="rep bad">${esc(it.error || 'No picture yet.')}</div><button class="btn small" data-pregen="${it.id}" ${busy ? 'disabled' : ''}>Try again</button>`}</div>`;
    }
    const thumbs = it.variants.length > 1 ? `<div class="pvars">${it.variants.map((f) => `<canvas width="108" height="108" class="${f === it.variant ? 'on' : ''}" data-pth="${it.id}|${f}" data-pvar="${it.id}|${f}" title="Use this picture"></canvas>`).join('')}</div>` : '';
    const seg = (key, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-pseg="${it.id}|${key}|${v}" class="${String(cur) === String(v) ? 'on' : ''}" ${locked ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    const up = it.upload ? Object.entries(it.upload).map(([pl, u]) => `<div class="plat"><span class="badge ${u.status}">${u.status}</span><b>${pl === 'facebook' ? 'Facebook Page' : 'Instagram'}</b>${u.when ? `<span class="muted">${fmtWhen(u.when)}</span>` : ''}<span class="muted grow" style="min-width:0">${esc((u.detail || '').slice(0, 140))}</span>${['failed', 'stopped'].includes(u.status) ? `<button class="ghost small" data-pretry="${it.id}|${pl}" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`).join('') : '';
    const pj = (P0.jobs || []).filter((j) => j.item === it.id && j.kind === 'comment').map((j) => `<div class="plat"><span class="badge ${j.status === 'done' ? 'posted' : j.status}">${j.status === 'done' ? 'commented' : j.status}</span><span class="muted">${j.platform === 'facebook' ? 'Facebook' : 'Instagram'} comment · ${new Date(j.runAt).toLocaleString()}</span>${j.status === 'failed' ? `<button class="ghost small" data-pjob="${esc(j.id)}" ${busy ? 'disabled' : ''}>Retry</button>` : ''}</div>`).join('');
    const pub = locked ? `<div class="fixbox"><b>${it.mode === 'now' ? 'Posted now' : `Scheduled for ${it.slot ? fmtWhen(it.slot) : '…'}`}</b>${it.slot ? `<span class="muted"> · US prime time</span>` : ''}${up}${pj}</div>`
      : `<div class="fixbox"><b>Approve &amp; post</b>
        <div class="row" style="margin-top:8px"><label class="row" style="gap:8px"><input type="checkbox" data-pplat="${it.id}|facebook" ${it.platforms.facebook ? 'checked' : ''}><span>Facebook Page <span class="muted">(${esc(S.settings.fbPage || 'set the Page name in Setup')})</span></span></label>
          <label class="row" style="gap:8px"><input type="checkbox" data-pplat="${it.id}|instagram" ${it.platforms.instagram ? 'checked' : ''}><span>Also post the same picture on Instagram</span></label></div>
        <div class="row" style="margin-top:10px">${seg('mode', it.mode, [['now', 'Post now'], ['schedule', 'Schedule for best US time']])}
          <span class="muted grow">${it.mode === 'now' ? 'Goes live as soon as you approve.' : slot ? `Next US prime-time slot: <b style="color:var(--text)">${esc(slot.local)}</b> (${esc(slot.et)}). The app posts it at that time, so keep the app and Chrome open.` : ''}</span></div>
        <div class="muted tiny">After it goes live, the app adds your engagement question as a comment from the same account.</div>
        <div class="row" style="margin-top:10px"><button class="btn" data-ppub="${it.id}" ${busy || it.status === 'generating' ? 'disabled' : ''}>${it.mode === 'now' ? 'Approve &amp; post now' : 'Approve &amp; schedule'}</button></div></div>`;
    return `<div class="card">${head}
      <div class="pedit"><div class="pleft"><canvas width="${PW}" height="${PH}" data-pcv="${it.id}" class="pcanvas"></canvas>${thumbs}
        ${locked ? '' : `<button class="ghost small" data-pregen="${it.id}" ${busy ? 'disabled' : ''} style="margin-top:8px;width:100%">${it.status === 'generating' ? 'Making new pictures…' : 'Make new pictures in Flow'}</button>`}</div>
      <div class="pright">
        <label class="f">Hook caption on the picture <span class="muted">(wrap words in *stars* for the accent colour)</span></label><input type="text" data-pt="${it.id}|headline" value="${esc(t.headline)}" ${locked ? 'disabled' : ''}>
        <div class="pgrid">
          <div><label class="f">Text position</label>${seg('position', t.position, [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']])}</div>
          <div><label class="f">Background behind text</label>${seg('band', t.band, [['none', 'None'], ['shade', 'Shade'], ['box', 'Box']])}</div>
          <div><label class="f">Font</label><select data-pt="${it.id}|font" ${locked ? 'disabled' : ''}>${PFONTS.map(([v, l]) => `<option value="${v}" ${t.font === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="f">Dark &amp; vignette</label><input type="range" min="0" max="1" step="0.05" value="${t.dark != null ? t.dark : 0.75}" data-pt="${it.id}|dark" ${locked ? 'disabled' : ''} style="width:100%"></div>
          <div><label class="f">Text size</label><input type="range" min="0.5" max="1.6" step="0.05" value="${t.size}" data-pt="${it.id}|size" ${locked ? 'disabled' : ''} style="width:100%"></div>
          <div><label class="f">Colours (text · accent)</label><div class="row" style="gap:8px"><input type="color" data-pt="${it.id}|color" value="${esc(t.color)}" ${locked ? 'disabled' : ''}><input type="color" data-pt="${it.id}|accent" value="${esc(t.accent)}" ${locked ? 'disabled' : ''}></div></div>
          <div><label class="f">Style</label><div class="row" style="gap:16px"><label class="switch"><input type="checkbox" data-pck="${it.id}|stroke" ${t.stroke ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="tr"></span>Outline</label><label class="switch"><input type="checkbox" data-pck="${it.id}|upper" ${t.upper ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="tr"></span>ALL CAPS</label></div></div>
        </div>
        ${locked ? '' : `<label class="f">Ask Claude to change the text</label><div class="row"><input type="text" class="grow" data-pnote="${it.id}" value="${esc(pNotes[it.id] || '')}" placeholder="e.g. make it funnier, shorter, more urgent, move it to the bottom"><button class="ghost" data-prev="${it.id}" ${busy ? 'disabled' : ''}>Edit with Claude</button></div>`}
        <label class="f">Caption (short line + a few hashtags)</label><input type="text" data-pc="${it.id}|caption" value="${esc(it.caption)}" ${locked ? 'disabled' : ''}>
        <label class="f">Engagement comment (posted from the same account after it goes live)</label><input type="text" data-pc="${it.id}|comment" value="${esc(it.comment)}" ${locked ? 'disabled' : ''}>
        ${it.idea.source ? `<div class="muted tiny">Source: ${esc(it.idea.source)}</div>` : ''}
        <div class="row" style="margin-top:12px"><label class="switch"><input type="checkbox" data-preal="${it.id}" ${it.realistic ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="tr"></span><b>AI label on</b></label><span class="muted grow tiny" style="margin:0">On when the picture looks like a real photograph (Meta's toggle says realistic AI photos need the label). Off for illustrations and clearly stylized art.</span></div>
        ${pub}
      </div></div></div>`;
  }).join('');
  $('#view-poster').innerHTML = `<h1>Poster</h1><p class="sub">Picture posts for your Facebook Page (and Instagram if you want). Claude Opus writes the ideas, Google Flow makes a square picture, the app darkens it with a vignette and Claude writes a hook caption in front, then you approve and post now or schedule it.</p>
  <h2 style="margin-top:0">1 · Choose your niche</h2><div class="grid">${niches}</div>
  ${P0.niche === 'custom' ? `<label class="f">Describe your niche</label><input type="text" id="pCustom" value="${esc(P0.custom)}" placeholder="e.g. dog memes, real estate tips, cozy gaming…">` : ''}
  <h2>2 · Ideas</h2>
  <div class="card"><div class="row"><div class="grow"><b>5 fresh ${esc((S.posterNiches.find((n) => n.id === P0.niche) || {}).name || '')} ideas</b><div class="muted">Claude Opus writes 5 new ideas every time you press Create, different from everything it made before.${(S.posterNiches.find((n) => n.id === P0.niche) || {}).web ? ' It checks the latest news online first.' : ''}</div></div>
    <button class="btn" id="pIdeas" ${busy ? 'disabled' : ''}>Create</button></div></div>
  ${ideas ? `${ideas}<div class="row"><button class="btn" id="pMake" ${!P0.pick || busy ? 'disabled' : ''}>Make this picture in Google Flow</button><span class="muted">Claude opens Flow in Chrome, makes the picture, downloads the project and adds it below.</span></div>` : ''}
  <h2>3 · Edit, approve &amp; post</h2>
  ${cards || '<p class="muted">Your posters appear here after you pick an idea.</p>'}`;

  document.querySelectorAll('[data-pniche]').forEach((b) => (b.onclick = () => call('posterSettings', { niche: b.dataset.pniche })));
  const pc = $('#pCustom'); if (pc) pc.onchange = (e) => call('posterSettings', { custom: e.target.value });
  $('#pIdeas').onclick = () => call('posterIdeas');
  document.querySelectorAll('[data-pidea]').forEach((d) => (d.onclick = () => { const id = P0.pick === d.dataset.pidea ? null : d.dataset.pidea; S.poster.pick = id; render(); call('posterSettings', { pick: id }); }));
  const mk = $('#pMake'); if (mk) mk.onclick = async () => { mk.disabled = true; await call('posterCreate', P0.pick); };
  const item = (id) => S.poster.items[id];
  const redraw = (id) => { const cv = document.querySelector(`canvas[data-pcv="${id}"]`), it = item(id); if (cv && it) drawPoster(cv, posterImg(id, it.variant), it.text); };
  document.querySelectorAll('[data-pt]').forEach((i) => {
    const [id, f] = i.dataset.pt.split('|');
    const val = () => (f === 'size' || f === 'dark' ? +i.value : i.value);
    i.oninput = () => { item(id).text[f] = val(); redraw(id); };
    i.onchange = () => call('posterUpdate', id, { text: { [f]: val() } });
  });
  document.querySelectorAll('[data-pck]').forEach((i) => (i.onchange = () => { const [id, f] = i.dataset.pck.split('|'); item(id).text[f] = i.checked; redraw(id); call('posterUpdate', id, { text: { [f]: i.checked } }); }));
  document.querySelectorAll('[data-pseg]').forEach((b) => (b.onclick = () => {
    const [id, key, v] = b.dataset.pseg.split('|');
    if (key === 'mode') { item(id).mode = v; render(); return call('posterUpdate', id, { mode: v }); }
    item(id).text[key] = v; redraw(id); call('posterUpdate', id, { text: { [key]: v } });
  }));
  document.querySelectorAll('[data-pc]').forEach((i) => (i.onchange = () => { const [id, f] = i.dataset.pc.split('|'); call('posterUpdate', id, { [f]: i.value }); }));
  document.querySelectorAll('[data-preal]').forEach((i) => (i.onchange = () => call('posterUpdate', i.dataset.preal, { realistic: i.checked })));
  document.querySelectorAll('[data-pvar]').forEach((c) => (c.onclick = () => { const [id, f] = c.dataset.pvar.split('|'); item(id).variant = f; render(); call('posterUpdate', id, { variant: f }); }));
  document.querySelectorAll('[data-pplat]').forEach((i) => (i.onchange = () => { const [id, pl] = i.dataset.pplat.split('|'); const p = { ...item(id).platforms, [pl]: i.checked }; item(id).platforms = p; call('posterUpdate', id, { platforms: p }); }));
  document.querySelectorAll('[data-pnote]').forEach((i) => { i.oninput = () => { pNotes[i.dataset.pnote] = i.value; }; i.onkeydown = (e) => { if (e.key === 'Enter') { const b = document.querySelector(`[data-prev="${i.dataset.pnote}"]`); if (b && !b.disabled) b.click(); } }; });
  document.querySelectorAll('[data-prev]').forEach((b) => (b.onclick = () => { const id = b.dataset.prev, n = pNotes[id] || ''; delete pNotes[id]; call('posterRevise', id, n); }));
  document.querySelectorAll('[data-pregen]').forEach((b) => (b.onclick = () => { b.disabled = true; call('posterRegen', b.dataset.pregen); }));
  document.querySelectorAll('[data-pfold]').forEach((b) => (b.onclick = () => call('posterFolder', b.dataset.pfold)));
  document.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = () => { if (confirm('Remove this poster and its pictures from the app?')) call('posterDiscard', b.dataset.pdel); }));
  document.querySelectorAll('[data-pretry]').forEach((b) => (b.onclick = () => { const [id, pl] = b.dataset.pretry.split('|'); call('posterRetry', id, pl); }));
  document.querySelectorAll('[data-pjob]').forEach((b) => (b.onclick = () => call('posterRetryJob', b.dataset.pjob)));
  document.querySelectorAll('[data-ppub]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.ppub, it = item(id), img = posterImg(id, it.variant);
    const where = ['facebook', 'instagram'].filter((p) => it.platforms[p]).map((p) => (p === 'facebook' ? `Facebook Page "${S.settings.fbPage}"` : 'Instagram'));
    if (!where.length) return alert('Choose Facebook, Instagram or both.');
    if (!img) return alert('The picture is still loading. Try again in a second.');
    if (!confirm(`${it.mode === 'now' ? 'Post this picture NOW' : `Schedule this picture for ${S.posterSlot ? S.posterSlot.local : 'the next US prime-time slot'}`} on ${where.join(' and ')}?`)) return;
    b.disabled = true;
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; drawPoster(cv, img, it.text);
    if (await call('posterSave', id, cv.toDataURL('image/jpeg', 0.92))) await call('posterPublish', id);
  }));
  drawPosters();
}

// ---------- builder ----------
const CAT = { 'art-style': 'Art style', palette: 'Colour palette', camera: 'Camera', pacing: 'Pacing', hook: 'Hook', narrative: 'Storytelling', captions: 'Captions', audio: 'Audio', other: 'Other' };
function renderBuilder() {
  const refs = S.refs.map((r) => `
    <div class="card" data-ref="${r.id}"><div class="row" style="align-items:flex-start;gap:14px">
      ${r.thumb ? `<img class="thumb" src="${fileUrl(r.thumb)}">` : '<div class="thumb"></div>'}
      <div class="grow"><div class="row"><b class="grow" style="word-break:break-all">${esc(r.name)}</b><span class="badge ${r.status}">${r.status}</span></div>
        <div class="muted">${esc(r.summary || (r.status === 'analyzing' ? 'Analyzing how this video is made…' : r.error || ''))}${r.meta ? ` · ${r.meta.seconds}s · ${r.meta.cuts} cuts` : ''}</div></div>
      <div class="row"><label class="switch" title="Use this video's lessons"><input type="checkbox" data-refon="${r.id}" ${r.on !== false ? 'checked' : ''}><span class="tr"></span></label><button class="danger small" data-refdel="${r.id}">Remove</button></div></div>
    ${r.on !== false ? (r.lessons || []).map((l) => `<div class="lesson ${l.on ? '' : 'off'}"><label class="switch"><input type="checkbox" data-les="${r.id}|${l.id}" ${l.on ? 'checked' : ''}><span class="tr"></span></label><div class="t"><div class="cat">${CAT[l.cat] || l.cat}</div>${esc(l.text)}</div></div>`).join('') : ''}</div>`).join('');
  const mem = (S.memory || []).map((m) => `<div class="lesson ${m.on ? '' : 'off'}"><label class="switch"><input type="checkbox" data-memon="${m.id}" ${m.on ? 'checked' : ''}><span class="tr"></span></label><div class="t">${esc(m.text)}</div><button class="danger small" data-memdel="${m.id}">Remove</button></div>`).join('');
  $('#view-builder').innerHTML = `<h1>Builder</h1><p class="sub">Add animations you like. The app studies how each one is made (especially the art style) and applies it to your next videos. Turn any lesson on or off at any time.</p>
  <div class="card"><h2 style="margin-top:0">Memory</h2><div class="muted" style="margin-bottom:8px">Tell the app what you want (or don't want) in your videos. Every item below is remembered and applied to every new idea and script until you turn it off or remove it. Examples: "No whispering in the voiceovers", "Always end with a question", "Keep the stickman in a blue shirt".</div>
    <div class="row"><input type="text" id="memText" placeholder="e.g. No whispering in the voiceovers" style="flex:1;min-width:240px"><button class="btn" id="memAdd">Remember this</button></div>
    ${mem || '<div class="muted tiny" style="margin-top:8px">Nothing remembered yet.</div>'}
    ${mem ? '<div class="muted tiny" style="margin-top:8px">Applies to ideas and scripts made from now on. A script you already wrote keeps its text until you make a new one.</div>' : ''}</div>
  <div class="card"><div class="row"><button class="btn" id="addFiles">Add video files</button><span class="muted">or paste a link: the app downloads the video, then studies it</span><input type="text" id="refUrl" placeholder="TikTok, Instagram, Facebook or YouTube video link" style="flex:1;min-width:240px"><button class="ghost" id="addUrl">Learn from link</button></div>
  <div class="muted tiny">Files are analyzed from sampled frames and cut pacing. Links are downloaded to your PC (the file is kept with the reference) and analyzed the same way; private or login-only videos can not be downloaded, so add those as a file. The app learns technique only and writes new, original videos; it never copies characters, text or scenes.</div></div>
  ${refs || '<p class="muted">No reference videos yet.</p>'}`;
  const addMem = async () => { const t = $('#memText').value.trim(); if (t) { await call('addMemory', t); } };
  $('#memAdd').onclick = addMem; $('#memText').onkeydown = (e) => { if (e.key === 'Enter') addMem(); };
  document.querySelectorAll('[data-memon]').forEach((c) => (c.onchange = () => call('toggleMemory', c.dataset.memon, c.checked)));
  document.querySelectorAll('[data-memdel]').forEach((b) => (b.onclick = () => call('removeMemory', b.dataset.memdel)));
  $('#addFiles').onclick = () => call('refFiles');
  $('#addUrl').onclick = async () => { const u = $('#refUrl').value.trim(); if (u && await call('refUrl', u)) $('#refUrl').value = ''; };
  document.querySelectorAll('[data-refon]').forEach((c) => (c.onchange = () => call('toggleLesson', c.dataset.refon, null, c.checked)));
  document.querySelectorAll('[data-les]').forEach((c) => (c.onchange = () => { const [r, l] = c.dataset.les.split('|'); call('toggleLesson', r, l, c.checked); }));
  document.querySelectorAll('[data-refdel]').forEach((b) => (b.onclick = () => call('removeRef', b.dataset.refdel)));
}

// ---------- music ----------
function renderMusic() {
  const rows = S.tracks.map((t) => `<div class="track"><div class="grow"><b>${esc(t.file.replace(/\.[^.]+$/, ''))}</b>
    <div class="muted">${t.vibe ? `${esc(t.vibe)} · ${esc(t.energy || '')} energy${t.genre ? ' · ' + esc(t.genre) : ''}${t.artist ? ' · ' + esc(t.artist) : ''}` : 'Vibe not researched yet'}${t.source ? ' · from YouTube' : ''}</div>
    ${t.mood ? `<div class="muted tiny">${esc(t.mood)}${t.confidence === 'low' ? ' (low confidence, inferred from the title)' : ''}</div>` : ''}</div>
    <audio controls preload="none" src="${fileUrl(t.path)}"></audio><button class="ghost small" data-research="${esc(t.file)}" ${S.progress.active ? 'disabled' : ''}>${t.vibe ? 'Re-research' : 'Research'}</button><button class="danger small" data-rm="${esc(t.file)}">Remove</button></div>`).join('');
  $('#view-music').innerHTML = `<h1>Music</h1><p class="sub">Your background tracks. When you add one, the app researches its title online to learn its vibe, so Automatic mode can match the right track to each video.</p>
  <div class="card"><div class="row"><button class="btn" id="addMusic">Add music</button><span class="muted">MP3, WAV or M4A. Only use music you have the rights to use.</span></div></div>
  <div class="card"><b>Get MP3 from a YouTube link</b>
    <div class="row" style="margin-top:8px"><input type="text" id="ytUrl" placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…" style="flex:1;min-width:260px"><button class="btn" id="ytGo" ${S.progress.active ? 'disabled' : ''}>Download MP3</button></div>
    <label class="row" style="margin-top:8px;gap:8px;align-items:flex-start"><input type="checkbox" id="ytRights"><span class="muted">I own this track, or it is royalty-free / licensed for use in my videos (for example from YouTube's Audio Library or a Creative Commons track with credit).</span></label>
    <div class="muted tiny" style="margin-top:6px">Heads up: downloading from YouTube can go against YouTube's terms, and popular songs usually trigger copyright claims that block monetization. Safe choices are the YouTube Audio Library, tracks that say "no copyright" or "royalty free", or music you bought a license for. The first download also fetches the free open-source tool yt-dlp (about 18 MB) from its official GitHub page and checks its checksum.</div></div>
  <div class="card">${rows || '<span class="muted">No tracks yet.</span>'}</div>`;
  $('#addMusic').onclick = () => call('musicFiles');
  $('#ytGo').onclick = async () => { const u = $('#ytUrl').value.trim(); if (!u) return alert('Paste a YouTube link first.'); if (!$('#ytRights').checked) return alert('Tick the box to confirm you are allowed to use this track in your videos.'); if (await call('ytMusic', u, true)) $('#ytUrl').value = ''; };
  document.querySelectorAll('[data-research]').forEach((b) => (b.onclick = () => call('researchTrack', b.dataset.research)));
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { if (confirm('Remove this track from the app?')) call('removeMusic', b.dataset.rm); }));
}

// ---------- settings ----------
const ACCENTS = ['#00a2ff', '#7c5cff', '#16a34a', '#f59e0b', '#ec4899', '#64748b'];
function applyTheme() {
  const s = S.settings; const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', s.accent || '#00a2ff');
}
let account = null, appInfo = {};
async function loadAccount() { const ai = await window.api.appInfo(); if (ai.ok) appInfo = ai.data; const r = await window.api.authStatus(); account = r.ok ? r.data : { loggedIn: false }; if (view === 'settings') renderSettings(); }
function renderSettings() {
  const s = S.settings, u = S.usage[new Date().toLocaleDateString('en-CA')] || { fresh: 0, cached: 0, runs: 0 };
  const seg = (id, cur, opts) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#view-settings').innerHTML = `<h1>Settings</h1><p class="sub">Appearance, window and account.</p>
  <h2 style="margin-top:0">Appearance</h2>
  <div class="card"><div class="row"><div class="grow"><b>Theme</b><div class="muted">Light, dark, or follow Windows.</div></div>${seg('theme', s.theme, [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']])}</div>
    <div class="row" style="margin-top:14px"><div class="grow"><b>Accent colour</b></div><div class="swatches">${ACCENTS.map((c) => `<div class="sw ${s.accent === c ? 'on' : ''}" data-ac="${c}" style="background:${c}"></div>`).join('')}</div></div></div>
  <h2>Window</h2>
  <div class="card"><div class="row"><div class="grow"><b>Window mode</b><div class="muted">Windowed, full screen (F11 or Esc to leave), or borderless (no title bar, fills the screen).</div></div>${seg('winmode', s.windowMode || 'window', [['window', 'Windowed'], ['fullscreen', 'Full screen'], ['borderless', 'Borderless']])}</div></div>
  <h2>Claude account</h2>
  <div class="card">${account ? `<div class="kv"><b>Status</b><span>${account.loggedIn ? 'Signed in' + (account.email ? ' as ' + esc(account.email) : '') : 'Signed out'}</span></div>` : '<div class="muted">Checking…</div>'}
    <div class="row" style="margin-top:12px">${account && account.loggedIn ? '<button class="danger" id="logout">Log out</button>' : '<button class="btn" id="login">Log in with Claude</button>'}<span class="muted tiny" style="margin:0">Log out to switch to a different Claude account. After logging in, run the Setup check again.</span></div></div>
  <h2>Updates</h2>
  <div class="card"><div class="kv"><b>Version</b><span>${esc(appInfo.version || '')}</span></div><div class="kv"><b>Status</b><span><span class="badge ${/^Up to date/.test(s.updateStatus || '') ? 'done' : /fail|Could not/.test(s.updateStatus || '') ? 'failed' : /Download|Install|Checking|available/.test(s.updateStatus || '') ? 'waiting' : ''}">${esc(s.updateStatus || 'Not checked yet')}</span></span></div><div class="kv"><b>Last checked</b><span>${s.lastUpdateCheck ? new Date(s.lastUpdateCheck).toLocaleString() : 'never'}</span></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="upd" ${/Checking|Downloading|Installing/.test(s.updateStatus || '') ? 'disabled' : ''}>Check for updates</button>${s.updateAvailable && !/Downloading|Installing|downloaded/.test(s.updateStatus || '') ? `<button class="btn" id="updGo" style="background:#16a34a">Update app to ${esc(s.updateAvailable)}</button>` : ''}<span class="muted tiny" style="margin:0">The app checks GitHub every 7 days and installs new versions automatically when it is idle.</span></div></div>
  <h2>Your data</h2>
  <div class="card" id="dataCard"><span class="muted">Loading…</span></div>
  <h2>Usage today</h2>
  <div class="card"><div class="kv"><b>Claude runs</b><span>${u.runs}</span></div><div class="kv"><b>Tokens used</b><span>≈ ${fmtTok(u.fresh)} (plus ${fmtTok(u.cached)} cheap cached reads)</span></div><div class="muted tiny">Measured from each Claude run the app starts. Browser steps use the most; Sonnet uses far less than Opus.</div></div>`;
  document.querySelectorAll('#theme button').forEach((b) => (b.onclick = () => call('settings', { theme: b.dataset.v })));
  document.querySelectorAll('[data-ac]').forEach((b) => (b.onclick = () => call('settings', { accent: b.dataset.ac })));
  document.querySelectorAll('#winmode button').forEach((b) => (b.onclick = () => call('winMode', b.dataset.v)));
  window.api.dataInfo().then((r) => { const d = r.ok && r.data; const el = $('#dataCard'); if (!d || !el) return; const gb = d.bytes / 1e9, sz = gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(d.bytes / 1e6) + ' MB';
    el.innerHTML = `<div class="kv"><b>Folder</b><span style="word-break:break-all">${esc(d.folder)}</span></div><div class="kv"><b>Stored</b><span>${d.videos} finished videos · ${d.scripts} scripts · ${d.tracks} music tracks · ${d.references} references · ${sz}</span></div>
    <div class="kv"><b>Backups</b><span>${d.backups} automatic backups of your settings and queue (made on launch and before every update)</span></div><div class="kv"><b>Profile since</b><span>${new Date(d.since).toLocaleDateString()} · versions used: ${esc(d.versions.map((v) => v.v).join(', ') || 'this one')}</span></div>
    <div class="row" style="margin-top:12px"><button class="ghost" id="openData">Open folder</button><button class="ghost" id="bkNow">Back up now</button><span class="muted tiny" style="margin:0">Updates replace only the app. Your videos, audio, scripts, music, settings and schedule stay in this folder.</span></div>`;
    $('#openData').onclick = () => call('openFolder', ''); $('#bkNow').onclick = async () => { await call('backupNow'); renderSettings(); }; });
  const ug = $('#updGo'); if (ug) ug.onclick = async () => { if (!confirm('Install the update now? The app closes, updates in place (your videos, settings and schedule are kept) and reopens by itself. Anything running will finish first.')) return; ug.disabled = true; ug.textContent = 'Updating…'; await call('updateInstall'); };
  const ub = $('#upd'); if (ub) ub.onclick = async () => { ub.disabled = true; await call('updateCheck'); };
  const lo = $('#logout'); if (lo) lo.onclick = async () => { if (!confirm('Log out of this Claude account? Any running task will stop.')) return; lo.disabled = true; const r = await window.api.authLogout(); account = r.ok ? r.data : { loggedIn: false }; renderSettings(); };
  const li = $('#login'); if (li) li.onclick = async () => { li.disabled = true; li.textContent = 'Finish signing in in your browser…'; const r = await window.api.authLogin(); account = r.ok ? r.data : { loggedIn: false }; renderSettings(); };
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S && applyTheme());
$('#tmin').onclick = () => call('winCtl', 'min'); $('#tclose').onclick = () => call('winCtl', 'close');
window.api.on('winmode', (m) => document.body.classList.toggle('borderless', m === 'borderless'));

// ---------- failure pop-up ----------
function renderAlert() {
  const m = $('#modal'); const a = S.alerts && S.alerts[0];
  if (!a) { m.hidden = true; return; }
  const more = S.alerts.length > 1 ? `+${S.alerts.length - 1} more problem${S.alerts.length > 2 ? 's' : ''} after this one` : '';
  const advice = (a.diagnosis ? `<b>What went wrong:</b> ${esc(a.diagnosis)}` : '') + (a.fixDesc ? `<div style="margin-top:6px"><b>The fix:</b> ${esc(a.fixDesc)}</div>` : '') + (a.advice ? `<div style="margin-top:6px"><b>What to do:</b> ${esc(a.advice)}</div>` : '') + (a.fix ? `<div style="margin-top:6px">Press <b>Continue</b> to ${a.fix.action === 'user-action' ? 'retry' : 'apply this fix and retry'}.</div>` : '');
  const fixLabel = a.fixing ? 'Looking for a fix…' : a.fix ? 'Continue' : 'Find a fix';
  if (m.dataset.id === a.id && !m.hidden) {
    $('#aMore').textContent = more; $('#aAdvice').innerHTML = advice; $('#aAdvice').hidden = !advice;
    const fb = $('#aFix'); if (fb && !fb.dataset.clicked) { fb.disabled = !!a.fixing; fb.textContent = fixLabel; }
    return;
  }
  m.dataset.id = a.id; m.hidden = false;
  m.innerHTML = `<div class="dlg"><h3>Process failed</h3><div class="muted" style="margin-bottom:6px">${esc(a.title)}</div><div class="errbox">${esc(a.detail || '')}</div>
    <div class="errbox" id="aAdvice" style="background:rgba(22,163,74,.12);color:inherit" ${advice ? '' : 'hidden'}>${advice}</div>
    <p>Press <b>Find a fix</b> and the app works out the cause and shows the fix. Press <b>Continue</b> to apply it and retry. If it needs something from you (a sign-in, Chrome, credits), it tells you exactly what. <b>Retry</b> tries again unchanged.</p>
    <div class="muted tiny" id="aMore">${S.alerts.length > 1 ? `+${S.alerts.length - 1} more problem${S.alerts.length > 2 ? 's' : ''} after this one` : ''}</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="ghost" id="aDis">Dismiss</button><button class="ghost" id="aRetry">Retry</button><button class="btn" id="aFix" ${a.fixing ? 'disabled' : ''}>${fixLabel}</button></div></div>`;
  $('#aDis').onclick = () => call('alertDismiss', a.id);
  $('#aFix').onclick = async () => {
    const b = $('#aFix'), cur = (S.alerts || []).find((x) => x.id === a.id); b.dataset.clicked = '1'; b.disabled = true;
    if (cur && cur.fix) { b.textContent = S.progress.active ? 'Queued…' : 'Applying…'; await call('alertApply', a.id); }
    else { b.textContent = 'Looking for a fix…'; await call('alertFix', a.id); }
    delete b.dataset.clicked; renderAlert();
  };
  $('#aRetry').onclick = async () => { const b = $('#aRetry'); b.disabled = true; b.textContent = S.progress.active ? 'Queued…' : 'Retrying…'; await call('alertRetry', a.id); };
}

// ---------- render loop ----------
function render() {
  if (!S) return;
  applyTheme(); renderAlert();
  if (ptrDown) return; // never rebuild the page between mouse-down and the click
  const used = S.usedToday; $('#dailyFill').style.width = (used / S.maxPerDay * 100) + '%'; $('#dailyTxt').textContent = `${used} / ${S.maxPerDay}`;
  if ([...document.querySelectorAll('#view-' + view + ' video')].some((v) => !v.paused && !v.ended)) return; // rebuilding would restart the video
  const el = document.activeElement;
  if (el && ['TEXTAREA', 'INPUT'].includes(el.tagName) && el.type !== 'range' && $('#view-' + view).contains(el)) return; // don't clobber typing
  ({ setup: renderSetup, create: renderCreate, poster: renderPoster, builder: renderBuilder, music: renderMusic, upload: renderUpload, settings: renderSettings })[view]();
}
window.api.on('state', (s) => { S = s; render(); renderMeter(S.progress); });
window.api.on('progress', (p) => { if (S) S.progress = p; renderMeter(p); });
// when typing ends, refresh once
document.addEventListener('focusout', (e) => { if (e.target && e.target.tagName === 'VIDEO') return; setTimeout(render, 150); });
// when a video is paused or ends, catch up on anything that changed while it was playing
document.addEventListener('pause', () => setTimeout(render, 300), true);
(async () => { const r = await window.api.state(); S = r.data; if (S.setup.checkedAt) view = 'create'; applyTheme(); show(); renderMeter(S.progress); loadAccount(); })();
