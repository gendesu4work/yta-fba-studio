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
function renderCreate() {
  const s = S.settings, left = Math.max(0, S.maxPerDay - S.usedToday), cap = Math.min(5, left);
  const nicheCards = S.niches.map((n) => `<button class="niche ${s.niche === n.id ? 'sel' : ''}" data-niche="${n.id}"><b>${n.name}</b><span>${esc(n.blurb)}</span></button>`).join('');
  const ideas = S.ideas.map((i) => {
    const on = S.selected.includes(i.id), off = !on && S.selected.length >= cap;
    return `<div class="idea ${on ? 'sel' : ''} ${off ? 'off' : ''}" data-idea="${i.id}"><div class="ck">${on ? '✓' : ''}</div><div><b>${esc(i.title)}</b> <span class="tag">${esc(i.hookType)}</span><div class="hook">“${esc(i.hook)}”</div><div>${esc(i.premise)}</div><div class="muted">Takeaway: ${esc(i.takeaway)}</div></div></div>`;
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
  const vids = s.mediaMode === 'videos' ? s.sceneCount : s.mediaMode === 'images' ? 0 : Math.max(1, s.videoCount);
  $('#view-create').innerHTML = `
  <h1>Create</h1><p class="sub">Pick a niche, get today's ideas, choose up to 5, and let Claude do the rest.</p>
  <div class="card"><div class="row"><div class="grow"><b>AI model</b><div class="muted">Currently using <b style="color:var(--text)">Claude ${s.model === 'opus' ? 'Opus' : 'Sonnet'}</b>. ${s.model === 'opus' ? 'Strongest reasoning and writing; slower and uses more of your Claude usage.' : 'Fast, strong writing and uses fewer tokens.'}</div></div>
    <div class="seg" id="model"><button data-model="sonnet" class="${s.model !== 'opus' ? 'on' : ''}">Sonnet</button><button data-model="opus" class="${s.model === 'opus' ? 'on' : ''}">Opus</button></div></div></div>
  <div class="card"><div class="row"><div class="grow"><b>Learned style</b><div class="muted">${S.refs.reduce((n, r) => n + (r.on !== false ? (r.lessons || []).filter((l) => l.on).length : 0), 0)} active lessons from your reference videos are applied to new scripts and visuals. Manage them in Builder.</div></div><button class="ghost" id="goBuilder">Open Builder</button></div></div>
  <h2 style="margin-top:0">1 · Choose your niche</h2><div class="grid">${nicheCards}</div>
  ${s.niche === 'custom' ? `<label class="f">Describe your niche</label><input type="text" id="customNiche" value="${esc(s.customNiche)}" placeholder="e.g. cozy cat stories, space facts for kids…">` : ''}
  <h2>2 · Create the idea for the day</h2>
  <div class="card"><div class="row"><div class="grow"><b>Today's ideas for ${esc((S.niches.find((n) => n.id === s.niche) || {}).name)}</b><div class="muted">Claude writes 10 fresh ideas. Choose 1 to ${cap} (max 5 a day to keep your content original). ${S.usedToday}/${S.maxPerDay} made today.</div></div>
  <button class="btn" id="mkIdeas" ${S.progress.active || left <= 0 ? 'disabled' : ''}>${S.ideas.length ? 'Create new ideas' : 'Create'}</button></div></div>
  ${ideas ? `<div class="row" style="margin:8px 0"><b>${S.selected.length} of ${cap} selected</b></div>${ideas}<button class="btn" id="mkScripts" ${!S.selected.length || S.progress.active ? 'disabled' : ''}>Write scripts for ${S.selected.length || ''} selected</button>` : ''}
  <h2>3 · Scripts &amp; visuals</h2>
  <div class="card"><div class="row"><div><b>What to generate</b><div class="muted tiny">${s.mediaMode === 'auto' ? 'The AI decides how many pictures and videos each short needs.' : `Flow video clips cost more credits than pictures. About ${vids * 24} Flow credits per video (24 per clip).`}</div></div>
    <div class="seg" id="mode"><button data-m="auto" class="${s.mediaMode === 'auto' ? 'on' : ''}">Automatic</button><button data-m="mixed" class="${s.mediaMode === 'mixed' ? 'on' : ''}">Mixed</button><button data-m="images" class="${s.mediaMode === 'images' ? 'on' : ''}">Pictures only</button><button data-m="videos" class="${s.mediaMode === 'videos' ? 'on' : ''}">Videos only</button></div></div>
    ${s.mediaMode === 'auto' ? '<div class="muted" style="margin-top:12px">Every sentence of the voiceover gets its own new picture or video. The first shot is always a moving video to hook viewers, and the AI picks video or picture for each following sentence by what keeps it entertaining (capped at 6 videos and 14 scenes per short to protect your credits).</div>' : ''}
    <div class="row" style="margin-top:12px">${s.mediaMode !== 'auto' ? `<label>Scenes per video: <b>${s.sceneCount}</b> <input type="range" id="sceneCount" min="4" max="10" value="${s.sceneCount}"></label>` : ''}
    ${s.mediaMode === 'mixed' ? `<label>Video clips per video: <b>${Math.max(1, s.videoCount)}</b> <input type="range" id="videoCount" min="1" max="${s.sceneCount}" value="${Math.max(1, s.videoCount)}"></label>` : ''}</div>
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
  const scn = $('#sceneCount'); if (scn) scn.onchange = (e) => call('settings', { sceneCount: +e.target.value });
  const vc = $('#videoCount'); if (vc) vc.onchange = (e) => call('settings', { videoCount: +e.target.value });
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
          <div class="muted tiny">${p.upload && Object.values(p.upload).some((u) => u.status === 'scheduled') ? 'Approving replaces the video in your queued uploads: the old scheduled posts are removed and the fixed video is scheduled instead.' : 'Approving makes this the video that gets uploaded.'}</div>
          <div class="row" style="margin-top:10px"><button class="btn" data-apfix="${slug}" ${busy ? 'disabled' : ''}>Approve fix</button><button class="ghost" data-dsfix="${slug}">Discard</button></div></div></div></div>`;
    const plat = p.accepted ? Object.entries(p.upload || {}).map(([pl, u]) => {
      const retry = ['failed', 'queued', 'stopped'].includes(u.status) && pl !== 'instagram';
      const igRetry = pl === 'instagram' && ['failed', 'stopped'].includes(u.status);
      return `<div class="plat"><span class="badge ${u.status}">${u.status}</span><b>${PL[pl]}</b>${u.when ? `<span class="muted">${fmtWhen(u.when)}</span>` : ''}<span class="muted grow" style="min-width:0">${esc((u.detail || '').slice(0, 140))}</span>${retry || igRetry ? `<button class="ghost small" data-retryup="${slug}|${pl}" ${busy ? 'disabled' : ''}>Retry upload</button>` : ''}</div>`;
    }).join('') : '';
    const anyRetry = p.accepted && Object.entries(p.upload || {}).some(([pl, u]) => pl !== 'instagram' && ['failed', 'queued', 'stopped'].includes(u.status));
    return `<div class="card"><div class="row" style="align-items:flex-start;gap:16px"><video controls preload="metadata" src="${fileUrl(p.files.final)}"></video>
      <div class="grow"><b>${esc(p.post.title)}</b><div class="muted">${Math.round(p.files.seconds)}s · ${esc(p.post.short_caption)}</div>${p.music ? `<div class="muted tiny">Music: ${p.music.file ? esc(p.music.file.replace(/\.[^.]+$/, '')) : 'none'} · ${esc(p.music.reason || '')}</div>` : ''}
      <div class="row" style="margin:10px 0 4px"><button class="ghost" data-review="${slug}" ${busy ? 'disabled' : ''}>Review</button><button class="ghost" data-fix="${slug}" ${busy || (fx && fx.status === 'working') ? 'disabled' : ''}>Fix</button>
        ${p.accepted ? '' : `<button class="btn" data-acc="${slug}" ${busy ? 'disabled' : ''}>Accept &amp; schedule</button><button class="danger" data-rej="${slug}">Reject</button>`}</div>
      ${reportHtml(p.review)}
      ${p.accepted ? `<div style="margin:10px 0 6px"><b>Posting time:</b> ${fmtWhen(p.slot)} <span class="muted">(US prime time, checked against the clock before each upload)</span></div>${plat}${anyRetry ? `<div style="margin-top:8px"><button class="btn small" data-retryall="${slug}" ${busy ? 'disabled' : ''}>Retry all unfinished uploads</button></div>` : ''}`
        : '<div class="muted" style="margin:8px 0">Review the video. When you accept, it is scheduled on YouTube, TikTok and Facebook for the next US prime-time slot, and posted to Instagram at that time.</div>'}
      </div></div>${fixBlock}</div>`;
  }).join('');
  const failed = recs.filter(([, p]) => p.status === 'failed').map(([slug, p]) => `<div class="card"><div class="row"><b class="grow">${esc(p.post.title)}</b><span class="badge failed">failed</span><button class="btn small" data-retryprod="${slug}" ${busy ? 'disabled' : ''}>Retry</button></div><div class="muted">${esc(p.error || '')}</div></div>`).join('');
  const jobs = S.jobs.filter((j) => j.status !== 'done').map((j) => `<div class="plat"><span class="badge ${j.status}">${j.status}</span>${j.kind === 'post' ? 'Instagram post' : j.platform + ' comment'} · ${esc((S.posts[j.slug] || { post: { title: j.slug } }).post.title)} · ${new Date(j.runAt).toLocaleString()} ${j.status === 'failed' ? `<button class="ghost small" data-retry="${esc(j.id)}" ${busy ? 'disabled' : ''}>Retry</button><span class="muted">${esc((j.detail || '').slice(0, 120))}</span>` : ''}</div>`).join('');
  $('#view-upload').innerHTML = `<h1>Upload &amp; Schedule</h1><p class="sub">Times are chosen for US audiences (8:00, 12:00, 3:30, 6:30 and 9:00 PM Eastern), spaced hours apart, and re-checked against the clock right before each upload. ${S.settings.autoApprove ? '<b>Auto approve is on</b>, so finished videos schedule themselves.' : ''}</p>
  <div class="card"><b>Next open slots</b><div class="muted">${S.slotsPreview.slice(0, 3).map((x) => `${x.local} (${x.et})`).join(' · ')}</div></div>
  ${cards || '<p class="muted">No finished videos yet. Make some on the Create tab.</p>'}${failed}
  ${jobs ? `<h2>Timed tasks (the app and Chrome must be open)</h2><div class="card">${jobs}</div>` : ''}`;
  document.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => call('accept', b.dataset.acc)));
  document.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => call('reject', b.dataset.rej)));
  document.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = () => call('retryJob', b.dataset.retry)));
  document.querySelectorAll('[data-review]').forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Checking…'; await call('review', b.dataset.review); }));
  document.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => call('fix', b.dataset.fix)));
  document.querySelectorAll('[data-apfix]').forEach((b) => (b.onclick = () => call('approveFix', b.dataset.apfix)));
  document.querySelectorAll('[data-dsfix]').forEach((b) => (b.onclick = () => call('discardFix', b.dataset.dsfix)));
  document.querySelectorAll('[data-retryup]').forEach((b) => (b.onclick = () => { const [s, pl] = b.dataset.retryup.split('|'); call('retryUpload', s, pl); }));
  document.querySelectorAll('[data-retryall]').forEach((b) => (b.onclick = () => call('retryUpload', b.dataset.retryall, null)));
  document.querySelectorAll('[data-retryprod]').forEach((b) => (b.onclick = () => call('retryProduce', b.dataset.retryprod)));
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
  $('#view-builder').innerHTML = `<h1>Builder</h1><p class="sub">Add animations you like. The app studies how each one is made (especially the art style) and applies it to your next videos. Turn any lesson on or off at any time.</p>
  <div class="card"><div class="row"><button class="btn" id="addFiles">Add video files</button><span class="muted">or paste a link</span><input type="text" id="refUrl" placeholder="https://www.tiktok.com/@…/video/… or YouTube Shorts link" style="flex:1;min-width:240px"><button class="ghost" id="addUrl">Learn from link</button></div>
  <div class="muted tiny">Files are analyzed from sampled frames and cut pacing. Links are watched in your Chrome. The app learns technique only and writes new, original videos; it never copies characters, text or scenes.</div></div>
  ${refs || '<p class="muted">No reference videos yet.</p>'}`;
  $('#addFiles').onclick = () => call('refFiles');
  $('#addUrl').onclick = async () => { const u = $('#refUrl').value.trim(); if (u && await call('refUrl', u)) $('#refUrl').value = ''; };
  document.querySelectorAll('[data-refon]').forEach((c) => (c.onchange = () => call('toggleLesson', c.dataset.refon, null, c.checked)));
  document.querySelectorAll('[data-les]').forEach((c) => (c.onchange = () => { const [r, l] = c.dataset.les.split('|'); call('toggleLesson', r, l, c.checked); }));
  document.querySelectorAll('[data-refdel]').forEach((b) => (b.onclick = () => call('removeRef', b.dataset.refdel)));
}

// ---------- music ----------
function renderMusic() {
  const rows = S.tracks.map((t) => `<div class="track"><div class="grow"><b>${esc(t.file.replace(/\.[^.]+$/, ''))}</b>
    <div class="muted">${t.vibe ? `${esc(t.vibe)} · ${esc(t.energy || '')} energy${t.genre ? ' · ' + esc(t.genre) : ''}${t.artist ? ' · ' + esc(t.artist) : ''}` : 'Vibe not researched yet'}</div>
    ${t.mood ? `<div class="muted tiny">${esc(t.mood)}${t.confidence === 'low' ? ' (low confidence, inferred from the title)' : ''}</div>` : ''}</div>
    <audio controls preload="none" src="${fileUrl(t.path)}"></audio><button class="ghost small" data-research="${esc(t.file)}" ${S.progress.active ? 'disabled' : ''}>${t.vibe ? 'Re-research' : 'Research'}</button><button class="danger small" data-rm="${esc(t.file)}">Remove</button></div>`).join('');
  $('#view-music').innerHTML = `<h1>Music</h1><p class="sub">Your background tracks. When you add one, the app researches its title online to learn its vibe, so Automatic mode can match the right track to each video.</p>
  <div class="card"><div class="row"><button class="btn" id="addMusic">Add music</button><span class="muted">MP3, WAV or M4A. Only use music you have the rights to use.</span></div></div>
  <div class="card">${rows || '<span class="muted">No tracks yet.</span>'}</div>`;
  $('#addMusic').onclick = () => call('musicFiles');
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
  <div class="card"><div class="kv"><b>Version</b><span>${esc(appInfo.version || '')}</span></div><div class="kv"><b>Status</b><span><span class="badge ${/^Up to date/.test(s.updateStatus || '') ? 'done' : /fail|Could not/.test(s.updateStatus || '') ? 'failed' : /Download|Install|Checking/.test(s.updateStatus || '') ? 'waiting' : ''}">${esc(s.updateStatus || 'Not checked yet')}</span></span></div><div class="kv"><b>Last checked</b><span>${s.lastUpdateCheck ? new Date(s.lastUpdateCheck).toLocaleString() : 'never'}</span></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="upd" ${/Checking|Downloading|Installing/.test(s.updateStatus || '') ? 'disabled' : ''}>Check for updates</button><span class="muted tiny" style="margin:0">The app checks GitHub every 7 days and installs new versions automatically when it is idle.</span></div></div>
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
  if (m.dataset.id === a.id && !m.hidden) { $('#aMore').textContent = S.alerts.length > 1 ? `+${S.alerts.length - 1} more problem${S.alerts.length > 2 ? 's' : ''} after this one` : ''; return; }
  m.dataset.id = a.id; m.hidden = false;
  m.innerHTML = `<div class="dlg"><h3>Process failed</h3><div class="muted" style="margin-bottom:6px">${esc(a.title)}</div><div class="errbox">${esc(a.detail || '')}</div>
    <p>The app already retried this several times. Please open the site in Chrome and check it (a frozen or crashed tab, a logged-out account, a captcha, a full storage or credits limit), fix it, then press <b>Retry</b> to try again.</p>
    <div class="muted tiny" id="aMore">${S.alerts.length > 1 ? `+${S.alerts.length - 1} more problem${S.alerts.length > 2 ? 's' : ''} after this one` : ''}</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="ghost" id="aDis">Dismiss</button><button class="btn" id="aRetry" ${S.progress.active ? 'disabled' : ''}>Retry</button></div></div>`;
  $('#aDis').onclick = () => call('alertDismiss', a.id);
  $('#aRetry').onclick = () => call('alertRetry', a.id);
}

// ---------- render loop ----------
function render() {
  if (!S) return;
  applyTheme(); renderAlert();
  const used = S.usedToday; $('#dailyFill').style.width = (used / S.maxPerDay * 100) + '%'; $('#dailyTxt').textContent = `${used} / ${S.maxPerDay}`;
  const el = document.activeElement;
  if (el && ['TEXTAREA', 'INPUT'].includes(el.tagName) && el.type !== 'range' && $('#view-' + view).contains(el)) return; // don't clobber typing
  ({ setup: renderSetup, create: renderCreate, builder: renderBuilder, music: renderMusic, upload: renderUpload, settings: renderSettings })[view]();
}
window.api.on('state', (s) => { S = s; render(); renderMeter(S.progress); });
window.api.on('progress', (p) => { if (S) S.progress = p; renderMeter(p); });
// when typing ends, refresh once
document.addEventListener('focusout', () => setTimeout(render, 150));
(async () => { const r = await window.api.state(); S = r.data; if (S.setup.checkedAt) view = 'create'; applyTheme(); show(); renderMeter(S.progress); loadAccount(); })();
