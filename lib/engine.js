const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, findClaude, extractJson } = require('./claude');
const { spawn } = require('child_process');
const niches = require('./niches');
const P = require('./prompts');
const { assemble, reviewVideo, sampleVideo, FFMPEG } = require('./assemble');
const ytdl = require('./ytdl');
const sched = require('./schedule');
const posters = require('./posters');

const CREDITS_RE = /out of credits|insufficient credits|not enough credits|no (more )?credits|credit limit|quota/i;
const MAX_PER_DAY = 5;
const MINUTE_STEP = { tiktok: 5 }; // TikTok's time picker only offers 5-minute steps
const roundUp = (ts, step) => Math.ceil(ts / (step * 60000)) * step * 60000; // never earlier than the planned time
const UPLOAD_MODEL = 'sonnet'; // browser form-filling does not need the strongest (slowest) model
const PLATFORMS = ['youtube', 'tiktok', 'facebook', 'instagram'];
const today = () => new Date().toLocaleDateString('en-CA');

const DEFAULTS = {
  settings: { niche: 'motivation', customNiche: '', voice: 'Motivational Coach - Leader', fbPage: '', mediaMode: 'auto', videoCount: 1, sceneCount: 7, autoApprove: false, model: 'sonnet', music: 'auto', slotJitter: true, parallelUploads: true, theme: 'light', accent: '#00a2ff', windowMode: 'window' },
  setup: { claude: null, chrome: null, logins: null, checkedAt: null },
  schemaVersion: 2, profile: { createdAt: Date.now(), versions: [] }, alerts: [], refs: [], musicInfo: {}, usage: {}, ideas: [], memory: [], selected: [], posts: {}, jobs: [], usedTitles: [], daily: {},
};

class Engine {
  constructor(ws, emit) {
    this.ws = ws; this.emit = emit;
    this.downloads = path.join(os.homedir(), 'Downloads');
    for (const d of ['posts', 'clips', 'output', 'music', 'posters']) fs.mkdirSync(path.join(ws, d), { recursive: true });
    this.file = path.join(ws, 'state.json');
    fs.mkdirSync(path.join(ws, 'backups'), { recursive: true });
    const saved = this.loadSaved();
    this.state = { ...structuredClone(DEFAULTS), ...saved, settings: { ...DEFAULTS.settings, ...(saved.settings || {}) }, setup: { ...DEFAULTS.setup, ...(saved.setup || {}) } };
    this.state.schemaVersion = DEFAULTS.schemaVersion;
    if (!this.state.profile || !this.state.profile.createdAt) this.state.profile = { createdAt: Date.now(), versions: [] };
    // anything that was mid-flight when the app closed is not running any more
    for (const r of Object.values(this.state.posts)) {
      if (r.status === 'making') { r.status = 'failed'; r.error = 'The app was closed while this video was being made. Press Retry to continue where it stopped.'; }
      for (const u of Object.values(r.upload || {})) if (u.status === 'running') { u.status = 'stopped'; u.detail = 'The app was closed during this upload.'; }
      if (r.fix && r.fix.status === 'working') r.fix = null;
    }
    for (const j of this.state.jobs) if (j.status === 'running') { j.status = 'failed'; j.detail = 'The app was closed during this task.'; }
    this.posterInit();
    this.progress = { active: false, title: '', steps: [], pct: 0, feed: [] };
    this.queue = Promise.resolve();
    this.handle = { kill: null };
    this.kills = new Set(); // one kill handle per running Claude process (uploads can run side by side)
    this.cancelled = false;
    this.timer = setInterval(() => this.tick(), 30000);
  }

  loadSaved() {
    const tryRead = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    const cur = fs.existsSync(this.file) ? tryRead(this.file) : {};
    if (cur) return cur;
    const dir = path.join(this.ws, 'backups');
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort().reverse();
    for (const f of files) { const j = tryRead(path.join(dir, f)); if (j) return j; }
    return {};
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
    this.emit('state', this.publicState());
  }
  noteVersion(v) {
    const vs = this.state.profile.versions;
    if (!vs.length || vs[vs.length - 1].v !== v) { this.backup('before-' + v); vs.push({ v, at: Date.now() }); this.save(); }
    else if (!this.lastBackupAt()) this.backup('launch');
  }
  lastBackupAt() { try { const d = path.join(this.ws, 'backups'); const t = Math.max(0, ...fs.readdirSync(d).map((f) => fs.statSync(path.join(d, f)).mtimeMs)); return Date.now() - t < 3600e3; } catch { return false; } }
  backup(reason = 'manual') {
    try {
      if (!fs.existsSync(this.file)) return null;
      const dir = path.join(this.ws, 'backups');
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const out = path.join(dir, `state-${stamp}-${reason}.json`);
      fs.copyFileSync(this.file, out);
      const all = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 12))) fs.unlinkSync(path.join(dir, old));
      return out;
    } catch { return null; }
  }
  dataInfo() {
    const size = (d) => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); n += e.isDirectory() ? size(f) : fs.statSync(f).size; } } catch {} return n; };
    const posts = Object.values(this.state.posts);
    return { folder: this.ws, bytes: size(this.ws), videos: posts.filter((x) => x.files).length, scripts: posts.length, tracks: this.listTracks().length, references: this.state.refs.length,
      backups: fs.readdirSync(path.join(this.ws, 'backups')).filter((x) => x.endsWith('.json')).length, since: this.state.profile.createdAt, versions: this.state.profile.versions };
  }
  publicState() {
    return { ...this.state, ready: this.isReady(), tracks: this.listTracks(), niches, progress: this.progress, usedToday: this.state.daily[today()] || 0, maxPerDay: MAX_PER_DAY, workspace: this.ws, progressFiles: Object.fromEntries(Object.entries(this.state.posts).filter(([, p]) => p.status === 'failed').map(([k, p]) => [k, { clips: this.clipCount(k), scenes: (p.post.scenes || []).length, voice: fs.existsSync(path.join(this.ws, 'output', k, 'voice.mp3')) }])), beatCounts: Object.fromEntries(Object.entries(this.state.posts).map(([k, p]) => [k, this.beats(p.post && p.post.voiceover).length])),
      claudePath: findClaude(), ...this.posterPublic(), slotsPreview: sched.nextSlots(5, this.takenTimes(), Date.now(), this.state.settings.slotJitter !== false).map((t) => ({ ts: t, local: sched.fmtLocal(t), et: sched.fmtET(t) })) };
  }
  takenTimes(exceptSlug) { return Object.entries(this.state.posts).filter(([s]) => s !== exceptSlug).map(([, p]) => p.slot).filter(Boolean); }

  // ---------- progress meter ----------
  begin(title, steps) {
    this.cancelled = false;
    this.progress = { active: true, title, steps: steps.map((s) => ({ ...s, status: 'pending', sub: 0 })), pct: 0, feed: [], tokens: { fresh: 0, cached: 0 } };
    this.pushProgress();
  }
  step(i, status = 'active') { const s = this.progress.steps[i]; if (!s) return; s.status = status; if (status === 'done') s.sub = 1; this.pushProgress(); }
  sub(i, v) { const s = this.progress.steps[i]; if (s) { s.sub = Math.min(Math.max(v, 0), 0.97); this.pushProgress(); } }
  feed(msg) { this.progress.feed.push({ t: Date.now(), msg }); if (this.progress.feed.length > 60) this.progress.feed.shift(); this.pushProgress(); }
  finish(msg) { this.progress.active = false; this.progress.pct = 100; if (msg) this.feed(msg); this.pushProgress(); }
  pushProgress() {
    const st = this.progress.steps, total = st.reduce((a, s) => a + (s.w || 1), 0) || 1;
    this.progress.pct = Math.round(st.reduce((a, s) => a + (s.w || 1) * (s.status === 'done' ? 1 : s.status === 'active' ? s.sub : 0), 0) / total * 100);
    this.emit('progress', this.progress);
  }
  // Tool-call driven creep for steps with no measurable output
  creep(i) { let n = 0; return (msg) => { this.feed(msg); n++; this.sub(i, 1 - Math.exp(-n / 18)); }; }

  addUsage(u) {
    const t = (this.progress.tokens = this.progress.tokens || { fresh: 0, cached: 0 });
    t.fresh += u.fresh; t.cached += u.cached;
    const d = today(); const day = (this.state.usage[d] = this.state.usage[d] || { fresh: 0, cached: 0, runs: 0 });
    day.fresh += u.fresh; day.cached += u.cached; day.runs += 1;
    this.pushProgress(); this.save();
  }

  cancel() { this.cancelled = true; if (this.handle.kill) this.handle.kill(); for (const h of this.kills) if (h.kill) h.kill(); this.feed('Stopped by you.'); }

  enqueue(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  async claude(prompt, { chrome = false, tools = false, web = false, onStatus, model, maxTurns, effort } = {}) {
    if (this.cancelled) throw new Error('Cancelled');
    const h = { kill: null }; this.kills.add(h);
    // Set by the "pick-browser" fix (the user approved it by pressing Continue).
    if (chrome && this.state.settings.browserHint) prompt = 'BROWSER CHOICE (the user chose this): if more than one Chrome browser is connected, first call list_connected_browsers, then select_browser with the one marked onThisComputer (if none is, the one marked inUse, else the most recently connected). Do not stop to ask; then carry on with the task below.\n\n' + prompt;
    let r;
    try { r = await run({ prompt, cwd: this.ws, chrome, tools, web, onStatus, handle: h, model: model || this.state.settings.model, effort: effort || (chrome ? 'low' : undefined), maxTurns: maxTurns || (chrome ? 150 : undefined) }); }
    finally { this.kills.delete(h); }
    if (r.usage) this.addUsage(r.usage);
    if (this.cancelled) throw new Error('Cancelled');
    if (r.isError) throw new Error(r.text || 'Claude reported an error');
    return r.text;
  }

  // ---------- settings ----------
  setSettings(patch) {
    const s = { ...this.state.settings, ...patch };
    s.videoCount = Math.max(1, Math.min(Math.round(+s.videoCount || 1), 30)); // Mixed mode: videos per short (pictures follow the sentences)
    this.state.settings = s; this.save();
  }
  nicheInfo() {
    const n = niches.find((x) => x.id === this.state.settings.niche) || niches[0];
    const custom = n.id === 'custom' ? this.state.settings.customNiche.trim() : '';
    return { ...n, name: n.id === 'custom' ? (custom || 'General short animation') : n.name, note: n.id === 'custom' ? '' : n.blurb };
  }

  // ---------- builder: learn from reference videos ----------
  styleLine(base) {
    const art = this.lessons(['art-style', 'palette', 'camera']);
    return art.length ? `${base}. Learned reference style: ${art.join(' ')}` : base;
  }
  craftLessons() { return this.lessons(['pacing', 'hook', 'narrative', 'captions', 'audio']).map((t) => '- ' + t).join('\n'); }
  lessons(cats) {
    const out = [];
    for (const r of this.state.refs) if (r.on !== false) for (const l of r.lessons || []) if (l.on && cats.includes(l.cat)) out.push(l.text);
    return out;
  }
  async addRef(src, kind) {
    const id = Date.now().toString(36);
    const name = kind === 'file' ? path.basename(src) : src;
    const ref = { id, kind, src, name, status: 'analyzing', on: true, lessons: [], added: Date.now() };
    this.state.refs.unshift(ref); this.save();
    return this.enqueue(async () => {
      const isUrl = kind === 'url';
      this.begin(`Learning from "${name.slice(0, 50)}"`, isUrl
        ? [{ label: 'Downloading the video from the link', w: 2 }, { label: 'Sampling frames and pacing', w: 1 }, { label: 'Analyzing the art style and craft', w: 4 }]
        : [{ label: 'Sampling frames and pacing', w: 1 }, { label: 'Analyzing the art style and craft', w: 4 }]);
      let k = 0;
      try {
        const dir = path.join(this.ws, 'refs', id);
        let file = src, label = name;
        if (isUrl) {
          // a link is downloaded as a normal video file first (YouTube, TikTok, Instagram, Facebook), then analyzed like any file
          this.step(0);
          const r = await ytdl.downloadVideo(this.ws, src, FFMPEG, dir, (m) => this.feed(m), this.handle);
          file = r.file; ref.localFile = file; if (r.title) { ref.name = r.title; label = r.title; }
          this.step(0, 'done'); k = 1;
        }
        this.step(k);
        const meta = await sampleVideo(file, dir);
        ref.thumb = meta.frames[0]; ref.meta = { seconds: Math.round(meta.duration), cuts: meta.cuts, size: meta.size };
        this.step(k, 'done'); this.step(k + 1);
        const raw = await this.claude(P.analyzeFilePrompt({ name: label, frames: meta.frames, meta }), { tools: true, onStatus: this.creep(k + 1) });
        const j = extractJson(raw);
        ref.summary = j.summary || '';
        ref.lessons = (j.lessons || []).map((l, i) => ({ id: `${id}-${i}`, cat: l.cat || 'other', text: l.text, on: true }));
        ref.status = 'done'; this.step(k + 1, 'done'); this.finish(`Learned ${ref.lessons.length} things.`);
      } catch (e) {
        ref.status = 'failed'; ref.error = e.message.slice(0, 220);
        const i = this.progress.steps.findIndex((s) => s.status === 'active'); if (i >= 0) this.step(i, 'error');
        this.finish('Could not analyze: ' + ref.error);
      }
      this.save();
    });
  }
  toggleLesson(refId, lessonId, on) {
    const r = this.state.refs.find((x) => x.id === refId); if (!r) return;
    if (lessonId) { const l = r.lessons.find((x) => x.id === lessonId); if (l) l.on = on; } else r.on = on;
    this.save();
  }
  removeRef(id) { this.state.refs = this.state.refs.filter((r) => r.id !== id); try { fs.rmSync(path.join(this.ws, 'refs', id), { recursive: true, force: true }); } catch {} this.save(); }

  // ---------- memory: standing instructions applied to every new idea and script ----------
  memoryList() { return (this.state.memory || []).filter((m) => m.on !== false).map((m) => m.text); }
  addMemory(text) {
    text = String(text || '').trim().slice(0, 400); if (!text) return;
    this.state.memory = this.state.memory || [];
    if (this.state.memory.some((m) => m.text.toLowerCase() === text.toLowerCase())) return;
    this.state.memory.unshift({ id: Date.now().toString(36), text, on: true, added: Date.now() }); this.save();
  }
  toggleMemory(id, on) { const m = (this.state.memory || []).find((x) => x.id === id); if (m) { m.on = on; this.save(); } }
  removeMemory(id) { this.state.memory = (this.state.memory || []).filter((x) => x.id !== id); this.save(); }

  // ---------- music ----------
  listTracks() {
    const dir = path.join(this.ws, 'music');
    return fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)).map((f) => ({ file: f, path: path.join(dir, f), ...(this.state.musicInfo[f] || {}) }));
  }
  addMusic(files) {
    for (const f of files) fs.copyFileSync(f, path.join(this.ws, 'music', path.basename(f)));
    this.save();
    for (const f of files) this.researchTrack(path.basename(f)).catch(() => {});
  }
  // Music tab: YouTube link -> MP3 in the music folder, then researched like any other track.
  youtubeMusic(url, rights) {
    if (!rights) throw new Error('Tick the box to confirm you are allowed to use this track in your videos.');
    if (!ytdl.URL_OK.test(String(url || '').trim())) throw new Error('Paste a full YouTube link (youtube.com/watch…, youtu.be/… or a Shorts link).');
    return this.enqueue(async () => {
      this.begin('Getting music from YouTube', [{ label: 'Downloading the audio as MP3', w: 4 }, { label: 'Researching its vibe', w: 1 }]);
      this.step(0);
      try {
        const r = await ytdl.downloadMp3(this.ws, url, FFMPEG, (m) => this.feed(m), this.handle);
        this.step(0, 'done'); this.step(1);
        await this.researchTrackInline(r.file);
        this.state.musicInfo[r.file] = { ...(this.state.musicInfo[r.file] || {}), source: String(url).trim(), rightsConfirmed: true };
        this.step(1, 'done'); this.finish(`Added "${r.title.slice(0, 60)}" to your music.`);
      } catch (e) {
        const i = this.progress.steps.findIndex((s) => s.status === 'active'); if (i >= 0) this.step(i, 'error');
        this.finish('Could not get the music: ' + e.message.slice(0, 200));
      }
      this.save();
    });
  }
  removeMusic(file) {
    try { fs.unlinkSync(path.join(this.ws, 'music', file)); } catch {}
    delete this.state.musicInfo[file]; if (this.state.settings.music === file) this.state.settings.music = 'auto'; this.save();
  }
  researchTrack(file) {
    return this.enqueue(async () => {
      const title = file.replace(/\.[^.]+$/, '');
      this.begin(`Researching "${title.slice(0, 40)}"`, [{ label: 'Looking up the track and its vibe', w: 1 }]);
      this.step(0);
      try {
        const j = extractJson(await this.claude(P.musicResearchPrompt({ title }), { web: true, onStatus: this.creep(0) }));
        this.state.musicInfo[file] = { ...j, researched: Date.now() };
        this.step(0, 'done'); this.finish(`Vibe: ${j.vibe || 'unknown'}`);
      } catch (e) { this.step(0, 'error'); this.finish('Research failed: ' + e.message.slice(0, 120)); }
      this.save();
    });
  }
  async researchTrackInline(file) {
    this.feed(`Researching the vibe of "${file.slice(0, 40)}"`);
    try {
      const j = extractJson(await this.claude(P.musicResearchPrompt({ title: file.replace(/\.[^.]+$/, '') }), { web: true }));
      this.state.musicInfo[file] = { ...j, researched: Date.now() }; this.save();
    } catch {}
  }
  async chooseMusic(post) {
    const pref = this.state.settings.music, tracks = this.listTracks();
    if (pref === 'none' || !tracks.length) return { file: null, reason: 'No music' };
    if (pref !== 'auto') return tracks.some((t) => t.file === pref) ? { file: pref, reason: 'Chosen by you' } : { file: null, reason: 'Chosen track missing' };
    if (tracks.length === 1) return { file: tracks[0].file, reason: 'Your only track' };
    for (const t of tracks.filter((x) => !x.vibe)) await this.researchTrackInline(t.file);
    try {
      this.feed('Choosing the best music for this video');
      const r = extractJson(await this.claude(P.musicPickPrompt({ post, tracks: this.listTracks() }), {}));
      if (tracks.some((t) => t.file === r.file)) return { file: r.file, reason: r.reason };
    } catch {}
    const t = tracks[Math.floor(Math.random() * tracks.length)];
    return { file: t.file, reason: 'Random pick (auto-match unavailable)' };
  }


  // ---------- account ----------
  claudeExe() { const exe = findClaude(); if (!exe) throw new Error('Claude Code is not installed.'); return exe; }
  authCmd(args, ms = 15000) {
    return new Promise((resolve) => {
      const exe = this.claudeExe(); const isCmd = /\.(cmd|bat)$/i.test(exe);
      const c = spawn(exe, ['auth', ...args], { shell: isCmd, windowsHide: true });
      let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
      const t = setTimeout(() => { try { c.kill(); } catch {} }, ms);
      c.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
      c.on('error', () => { clearTimeout(t); resolve({ code: 1, out: '' }); });
    });
  }
  async authStatus() {
    try { const r = await this.authCmd(['status']); const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); return { loggedIn: !!j.loggedIn, email: j.email || j.account?.email || '', method: j.authMethod || '' }; }
    catch { return { loggedIn: false, email: '', method: '' }; }
  }
  async authLogout() {
    this.cancel();
    await this.authCmd(['logout']);
    this.state.setup = { claude: null, chrome: null, logins: null, checkedAt: null }; this.save();
    return this.authStatus();
  }
  async authLogin() {
    await this.authCmd(['login'], 300000); // opens the browser for sign-in
    this.state.setup = { ...this.state.setup, claude: null, checkedAt: null }; this.save();
    return this.authStatus();
  }

  // ---------- setup & readiness ----------
  async checkSetup() {
    return this.enqueue(async () => {
      this.begin('Checking your setup', [{ label: 'Claude Code installed', w: 1 }, { label: 'Claude account signed in', w: 1 }, { label: 'Chrome extension + site logins', w: 6 }]);
      const out = { claude: null, chrome: null, logins: null };
      try {
        this.step(0);
        const exe = findClaude();
        if (!exe) { out.claude = { ok: false, note: 'Claude Code is not installed.' }; throw new Error('Claude Code is not installed'); }
        this.step(0, 'done'); this.step(1);
        const txt = await this.claude('Reply with only the word OK.', {});
        out.claude = { ok: /ok/i.test(txt), note: /ok/i.test(txt) ? 'Signed in and working' : 'Unexpected reply' };
        this.step(1, out.claude.ok ? 'done' : 'error');
        if (!out.claude.ok) throw new Error('Claude account problem');
        this.step(2);
        const raw = await this.claude(P.checkPrompt({ voice: this.state.settings.voice, fbPage: this.state.settings.fbPage || '(any)' }), { chrome: true, tools: true, onStatus: this.creep(2) });
        const j = extractJson(raw);
        out.chrome = { ok: true, note: 'Claude can control Chrome' };
        out.logins = j;
        this.step(2, 'done');
        this.finish('Setup check finished.');
      } catch (e) {
        const i = this.progress.steps.findIndex((s) => s.status === 'active');
        if (i >= 0) this.step(i, 'error');
        if (out.claude && out.claude.ok && !out.chrome) out.chrome = { ok: false, note: 'Claude could not control Chrome. Install the "Claude in Chrome" extension, sign in to it, and keep Chrome open. (' + e.message.slice(0, 160) + ')' };
        this.finish('Setup check stopped: ' + e.message.slice(0, 160));
      }
      this.state.setup = { ...out, checkedAt: Date.now() };
      this.save();
      return this.state.setup;
    });
  }
  isReady() {
    const s = this.state.setup;
    const l = s.logins;
    return !!(s.claude && s.claude.ok && s.chrome && s.chrome.ok && l && Object.values(l).every((x) => x && x.loggedIn)
      && l.elevenlabs.voiceFound !== false && (!this.state.settings.fbPage || l.facebook.pageFound !== false));
  }

  // ---------- ideas ----------
  async generateIdeas() {
    return this.enqueue(async () => {
      const n = this.nicheInfo();
      this.begin('Creating today\'s ideas', [{ label: `Brainstorming 10 ${n.name} ideas`, w: 1 }]);
      this.step(0);
      try {
        const txt = await this.claude(P.ideasPrompt({ niche: n.name, nicheNote: n.note, used: this.state.usedTitles, memory: this.memoryList() }), { onStatus: (m) => this.feed(m) });
        const arr = extractJson(txt);
        const cl = (n) => Math.max(0, Math.min(100, Math.round(+n || 0)));
        this.state.ideas = arr.slice(0, 10).map((x, i) => {
          const v = x.virality || {};
          const parts = { hook: cl(v.hook), retention: cl(v.retention), shares: cl(v.shares), trend: cl(v.trend), relatable: cl(v.relatable) };
          const score = v.score != null ? cl(v.score) : Math.round(Object.values(parts).reduce((a, b) => a + b, 0) / 5);
          return { id: `${Date.now()}-${i}`, ...x, virality: { score, ...parts, why: String(v.why || '').slice(0, 160) } };
        });
        this.state.selected = [];
        this.step(0, 'done'); this.finish('10 ideas ready. Pick up to 5.');
      } catch (e) { this.step(0, 'error'); this.finish('Could not create ideas: ' + e.message.slice(0, 200)); }
      this.save();
    });
  }
  select(ids) {
    const left = MAX_PER_DAY - (this.state.daily[today()] || 0);
    if (ids.length > Math.min(5, left)) throw new Error(left <= 0 ? 'Daily limit reached (5 videos). Come back tomorrow.' : `You can pick at most ${Math.min(5, left)} today.`);
    this.state.selected = ids; this.save();
  }

  // ---------- scripts ----------
  // Voiceover split into PHRASES (one scene each, so the picture changes about every 2-3 s): a cut at every sentence end,
  // comma, colon, semicolon, dash, ellipsis and [pause]. Pieces under 3 words join the next one; pieces over 9 words are split evenly.
  beats(voiceover) {
    const text = String(voiceover || '').replace(/\[[^\]]*(pause|beat|breath)[^\]]*\]/gi, ' | ').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = text.split(/(?<=[,;:.!?\u2026]["\u201d')]?)\s+|\s*[\u2014\u2013]\s*|\s+-{1,2}\s+|\s*\|\s*/).map((x) => (x || '').trim()).filter((x) => /[a-z0-9]/i.test(x));
    const wc = (x) => x.split(/\s+/).length, merged = [];
    for (let i = 0; i < parts.length; i++) {
      let p = parts[i];
      // a short piece joins the next phrase, or the previous one when joining forward would make an over-long phrase
      if (wc(p) < 3 && merged.length && (i + 1 >= parts.length || wc(p) + wc(parts[i + 1]) > 9) && wc(merged[merged.length - 1]) + wc(p) <= 9) { merged[merged.length - 1] += ' ' + p; continue; }
      while (wc(p) < 3 && i + 1 < parts.length) p += ' ' + parts[++i];
      merged.push(p);
    }
    if (merged.length > 1 && wc(merged[merged.length - 1]) < 3) merged.splice(-2, 2, merged[merged.length - 2] + ' ' + merged[merged.length - 1]);
    const out = [];
    for (const p of merged) { const w = p.split(/\s+/), k = Math.ceil(w.length / 9); for (let j = 0; j < k; j++) out.push(w.slice(Math.round(j * w.length / k), Math.round((j + 1) * w.length / k)).join(' ')); }
    return out;
  }
  // True when a script really has one scene per phrase (Automatic mode also needs the AI's video/picture choice).
  autoScenesOk(post, needType = this.state.settings.mediaMode === 'auto') {
    const sc = post.scenes || [], want = this.beats(post.voiceover).length;
    return sc.length >= Math.max(2, Math.round(want * 0.85)) && sc.every((s) => s && s.line && s.prompt && (!needType || s.type === 'video' || s.type === 'image'));
  }
  // Scene length follows its phrase (voice-synced); without one, clips get 8 s and pictures 4-7 s.
  sceneSeconds(s, video) {
    const words = String(s.line || '').split(/\s+/).filter(Boolean).length;
    return words ? Math.max(2, Math.round(words / 2.6 * 10) / 10) : video ? 8 : Math.min(Math.max(s.seconds || 5, 4), 7);
  }
  // Every mode has one scene per phrase. The mode only decides which scenes are video clips.
  applyMedia(post) {
    const { mediaMode, videoCount } = this.state.settings;
    if (mediaMode === 'mixed') return this.pickVideos(post, post.videos || videoCount || 1);
    if (mediaMode === 'auto') {
      // Scene 1 is always a video hook. Follow the AI's video/image choice; if it gave none, use action-friendly beats (every third scene and the ending).
      const n = post.scenes.length, typed = post.scenes.slice(1).some((s) => s && (s.type === 'video' || s.type === 'image'));
      let vids = 0;
      post.scenes = post.scenes.map((s, i) => {
        let video = i === 0 || (typed ? s.type === 'video' : i === n - 1 || i % 3 === 0);
        if (video && i > 0 && vids >= (post.videos || 6)) video = false; // credit cap: 6 videos per short unless you chose a number on Retry
        if (video) vids++;
        return { ...s, type: video ? 'video' : 'image', seconds: this.sceneSeconds(s, video) };
      });
      return post;
    }
    const video = mediaMode === 'videos'; // 'images' = pictures only
    post.scenes = post.scenes.map((s) => ({ ...s, type: video ? 'video' : 'image', seconds: this.sceneSeconds(s, video) }));
    return post;
  }
  // Rebuild the scenes of any script that did not come back as one scene per phrase (every mode).
  async repairAutoScenes(raws, nicheStyle) {
    const bad = raws.filter((r) => !this.autoScenesOk(r, false) || !this.autoScenesOk(r));
    if (!bad.length) return;
    this.feed(`${bad.length} script${bad.length > 1 ? 's' : ''} did not get one scene per phrase. Rebuilding the scenes…`);
    try {
      const txt = await this.claude(P.autoScenesPrompt({ posts: bad.map((r) => ({ slug: r.slug || r.title, title: r.title, beats: this.beats(r.voiceover) })), nicheStyle, memory: this.memoryList() }));
      let arr = extractJson(txt); if (!Array.isArray(arr)) arr = [arr];
      bad.forEach((r, i) => {
        const fix = arr.find((x) => x && x.slug && x.slug === (r.slug || r.title)) || arr[i];
        if (fix && Array.isArray(fix.scenes) && this.autoScenesOk({ voiceover: r.voiceover, scenes: fix.scenes }, false)) r.scenes = fix.scenes;
        else this.feed(`Could not rebuild the scenes for "${r.title}". It keeps its own scenes, with a video opening.`);
      });
    } catch (e) { this.feed('Could not rebuild the scenes: ' + e.message.slice(0, 160) + '. Keeping the original scenes, with a video opening.'); }
  }
  async generateScripts() {
    return this.enqueue(async () => {
      const picks = this.state.ideas.filter((i) => this.state.selected.includes(i.id));
      if (!picks.length) throw new Error('Pick at least one idea first.');
      const n = this.nicheInfo();
      this.begin('Writing scripts', [{ label: `Writing ${picks.length} script${picks.length > 1 ? 's' : ''} in one go`, w: 1 }]);
      this.step(0);
      try {
        const txt = await this.claude(P.scriptPrompt({ ideas: picks, niche: n.name, nicheStyle: this.styleLine(n.style), learned: this.craftLessons(), memory: this.memoryList(), auto: this.state.settings.mediaMode === 'auto' }), { onStatus: this.creep(0) });
        let arr = extractJson(txt); if (!Array.isArray(arr)) arr = [arr];
        const raws = arr.slice(0, picks.length).filter((raw) => raw && raw.voiceover && Array.isArray(raw.scenes) && raw.scenes.length);
        await this.repairAutoScenes(raws, this.styleLine(n.style));
        for (const raw of raws) {
          const post = this.applyMedia(raw);
          post.slug = String(post.slug || post.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) + '-' + Date.now().toString(36).slice(-3);
          post.niche = n.id; post.style = this.styleLine(n.style);
          this.state.posts[post.slug] = { post, status: 'script', approved: false, created: Date.now() };
          fs.writeFileSync(path.join(this.ws, 'posts', post.slug + '.json'), JSON.stringify(post, null, 2));
          this.state.usedTitles.push(post.title);
        }
        this.step(0, 'done'); this.finish('Scripts ready for review.');
      } catch (e) { this.step(0, 'error'); this.finish('Could not write scripts: ' + e.message.slice(0, 200)); this.save(); return; }
      this.save();
      if (this.state.settings.autoApprove && !this.cancelled) {
        for (const p of Object.values(this.state.posts)) if (p.status === 'script') p.approved = true;
        this.save();
        setTimeout(() => this.produce().catch((e) => { this.feed('Could not continue automatically: ' + e.message.slice(0, 200)); this.finish(); }), 0);
      }
    });
  }
  updatePost(slug, post) {
    const p = this.state.posts[slug]; if (!p) return;
    p.post = this.applyMedia({ ...p.post, ...post, slug }); p.approved = false; this.save();
    fs.writeFileSync(path.join(this.ws, 'posts', slug + '.json'), JSON.stringify(p.post, null, 2));
  }
  approveScript(slug, v = true) { const p = this.state.posts[slug]; if (p) { p.approved = v; this.save(); } }
  discard(slug) { delete this.state.posts[slug]; this.save(); }

  hintFor(rec, key) { const h = rec && rec.hints && rec.hints[key]; return h ? `\n\nFIX FOUND AFTER A PREVIOUS FAILURE (follow it): ${h}` : ''; }

  // ---------- retry + alert helpers ----------
  // Runs one Chrome task, retrying when a site froze or the run crashed. Throws the last problem after all attempts.
  async chromeRun(makePrompt, { attempts = 3, onStatus, label = 'task', model, maxTurns, effort } = {}) {
    let last = '';
    for (let i = 1; i <= attempts; i++) {
      if (this.cancelled) throw new Error('Cancelled');
      try {
        if (i > 1) this.feed(`Retrying ${label} (attempt ${i} of ${attempts})…`);
        const txt = await this.claude(makePrompt(i > 1 ? P.retryNote(last, i) : '', i), { chrome: true, tools: true, onStatus, model, maxTurns, effort });
        const j = extractJson(txt);
        if (j.ok !== false) return j;
        last = j.detail || 'unknown problem';
        if (/not logged in|logged out|sign in|captcha|verif|quota|insufficient credits|out of credits|not connected|extension is not|extension not|no browser|browsers are connected|none is selected|max.?turns/i.test(last)) break; // not a freeze: retrying cannot help
      } catch (e) {
        if (this.cancelled) throw new Error('Cancelled');
        last = e.message || 'Claude stopped unexpectedly';
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error(last || 'The task did not finish.');
  }
  alert(a) {
    this.state.alerts = this.state.alerts.filter((x) => !(x.kind === a.kind && x.slug === a.slug && x.platform === a.platform && x.jobId === a.jobId));
    this.state.alerts.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), created: Date.now(), ...a });
    this.save();
  }
  dismissAlert(id) { this.state.alerts = this.state.alerts.filter((x) => x.id !== id); this.save(); }
  // Rules for problems we already know the cure for (no Claude call, no tokens).
  localDiagnose(a) {
    const t = String(a.detail || ''), rec = this.state.posts[a.slug];
    let m;
    if (/(two|multiple|more than one|\d+) chrome browsers|browsers are connected|none is selected|which browser to use/i.test(t)) return { auto: true, diagnosis: 'More than one Chrome browser is connected to Claude, so the task did not know which one to use.', action: 'pick-browser' };
    if (/not connected|extension (is )?not|no browser|extension not/i.test(t)) return { auto: false, diagnosis: 'Chrome is not connected to Claude.', userSteps: 'Open Chrome, click the Claude extension icon and make sure you are signed in, keep Chrome open, then press Retry.' };
    if (/(not )?logged out|not logged in|sign.?in|captcha|verif(y|ication)/i.test(t)) return { auto: false, diagnosis: 'The site is asking you to sign in or pass a check.', userSteps: 'Open the site in Chrome, sign in or finish the check yourself, then press Retry.' };
    if (/quota|out of credits|insufficient credits|storage (is )?full/i.test(t)) return { auto: false, diagnosis: 'The account is out of credits or storage.', userSteps: 'Free up space or add credits on that site, then press Retry.' };
    if ((m = t.match(/(\d+)[- ]minute (steps|increments|intervals)/i)) && a.platform) return { auto: true, diagnosis: `${a.platform} only lets you pick times in ${m[1]}-minute steps.`, action: 'round-minutes', minuteStep: Math.min(Math.max(+m[1], 5), 30) };
    if (/time picker|can'?t be set|cannot be set|only offers/i.test(t) && /minute|time/i.test(t) && a.platform) return { auto: true, diagnosis: `${a.platform} could not take that exact minute.`, action: 'round-minutes', minuteStep: 5 };
    if (/slot (has )?passed|slot may be gone|already (past|passed)|in the past/i.test(t)) return { auto: true, diagnosis: 'The planned posting time has passed.', action: 'new-slot' };
    if (/not allowed to read|only files this session|file_upload refused|file is missing|no such file|video file is missing/i.test(t)) return { auto: true, diagnosis: 'The video file could not be read or is missing.', action: 'rebuild-video' };
    return null;
  }
  // Plain-English description of what applying a fix will do (shown before the user presses Continue).
  fixText(d) {
    switch (d.action) {
      case 'pick-browser': return 'Use the Chrome browser on this computer whenever more than one is connected (for this and every later task), then retry.';
      case 'round-minutes': return `Round the posting time to a ${d.minuteStep || 5}-minute step, then retry.`;
      case 'new-slot': return 'Pick the next free posting time, then retry.';
      case 'rebuild-video': return 'Rebuild the video file, then retry.';
      case 'retry-with-hint': return 'Retry with this extra instruction: ' + (d.hint || '(none)');
      default: return 'Retry.';
    }
  }
  // Step 1: work out the cause and propose a fix. Nothing is changed until the user presses Continue (applyFix).
  async fixAlert(id) {
    const a = this.state.alerts.find((x) => x.id === id); if (!a || a.fixing) return;
    a.fixing = true; a.advice = ''; a.fix = null; a.fixDesc = ''; this.save();
    return this.enqueue(async () => {
      this.begin('Finding a fix', [{ label: 'Working out what went wrong', w: 1 }]); this.step(0);
      let d = this.localDiagnose(a);
      try {
        if (!d) {
          const rec = this.state.posts[a.slug];
          const raw = await this.claude(P.diagnosePrompt({ alert: a, post: rec && rec.post, slot: rec && rec.slot ? sched.fmtLocal(rec.slot) : '' }), { model: 'sonnet' });
          const j = extractJson(raw);
          d = { auto: j.action !== 'user-action', diagnosis: String(j.diagnosis || '').slice(0, 240), action: j.action, minuteStep: Math.min(Math.max(+j.minuteStep || 5, 5), 30), hint: String(j.hint || '').slice(0, 300), userSteps: String(j.userSteps || '').slice(0, 300) };
          if (!['retry-with-hint', 'round-minutes', 'new-slot', 'rebuild-video', 'user-action'].includes(d.action)) d = { auto: false, diagnosis: d.diagnosis || 'Not sure what went wrong.', userSteps: 'Open the site in Chrome and check it, then press Retry.' };
        }
      } catch (e) { d = { auto: false, diagnosis: 'Could not work out the cause automatically.', userSteps: 'Open the site in Chrome and check it, then press Retry. (' + e.message.slice(0, 100) + ')' }; }
      a.diagnosis = d.diagnosis; a.fixing = false;
      if (!d.auto) { a.advice = (d.userSteps || 'Open the site in Chrome and check it.').replace(/,? then press Retry\.?$/i, '.') + ' When that is done, press Continue.'; a.fix = { action: 'user-action' }; }
      else { a.fix = { action: d.action, minuteStep: d.minuteStep, hint: d.hint }; a.fixDesc = this.fixText(d); }
      this.step(0, 'done'); this.finish('Found the cause: ' + d.diagnosis + ' Press Continue to ' + (d.auto ? 'apply the fix.' : 'retry.')); this.save();
    });
  }
  // Step 2 (Continue): apply the proposed fix, then retry.
  applyFix(id) {
    const a = this.state.alerts.find((x) => x.id === id); if (!a || !a.fix) return;
    const d = a.fix;
    if (d.action !== 'user-action') {
      if (d.action === 'pick-browser') this.state.settings.browserHint = true;
      const rec = this.state.posts[a.slug] || (a.kind === 'poster' && this.state.poster.items[a.slug]);
      if (rec) {
        rec.hints = rec.hints || {};
        const key = a.kind === 'upload' || a.kind === 'poster' ? a.platform || 'produce' : a.kind === 'job' ? 'job:' + a.jobId : 'produce';
        if (d.action === 'round-minutes' && a.platform) { rec.minuteStep = { ...(rec.minuteStep || {}), [a.platform]: d.minuteStep || 5 }; }
        else if (d.action === 'new-slot') { rec.customSlot = null; rec.slot = null; }
        else if (d.action === 'rebuild-video') { for (const f of [rec.files && rec.files.final, rec.files && rec.files.upload]) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} } }
        else if (d.action === 'retry-with-hint' && d.hint) rec.hints[key] = d.hint;
      }
      this.feed('Fix applied: ' + (a.fixDesc || a.diagnosis));
    }
    this.save();
    this.retryAlert(id);
  }
  retryAlert(id) {
    const a = this.state.alerts.find((x) => x.id === id); if (!a) return;
    this.dismissAlert(id);
    if (a.kind === 'produce') this.retryProduce(a.slug);
    else if (a.kind === 'upload') this.retryUpload(a.slug, a.platform);
    else if (a.kind === 'job') this.retryJob(a.jobId);
    else if (a.kind === 'poster') { if (a.platform) this.posterRetry(a.slug, a.platform); else this.posterFlow(a.slug); }
  }

  // ---------- production (voice -> Flow -> assemble), resumable ----------
  pending() { return Object.entries(this.state.posts).filter(([, p]) => p.status === 'script' && p.approved); }
  retryProduce(slug) {
    const rec = this.state.posts[slug]; if (!rec) return;
    rec.status = 'script'; rec.approved = true; rec.error = null; this.save();
    this.produce({ skipReady: true }).catch((e) => {
      this.feed('Retry could not start: ' + e.message.slice(0, 200)); this.finish();
      rec.status = 'failed'; rec.error = e.message.slice(0, 300); this.save();
      this.alert({ kind: 'produce', slug, title: `"${rec.post.title}" could not be retried`, detail: e.message.slice(0, 400) });
    });
  }
  // Choose which scenes are videos: scene 1 always, then the AI's own picks, then evenly spread beats.
  pickVideos(post, n) {
    const len = post.scenes.length; n = Math.max(1, Math.min(Math.round(+n || 1), len));
    const prefer = post.scenes.map((s, i) => (i > 0 && s.type === 'video' ? i : -1)).filter((i) => i > 0);
    const chosen = new Set([0]);
    if (prefer.length >= n - 1) for (let k = 0; k < n - 1; k++) chosen.add(prefer[Math.floor(k * prefer.length / (n - 1))]);
    else {
      prefer.forEach((i) => chosen.add(i));
      for (let k = 1; chosen.size < n && k < n; k++) chosen.add(Math.round(k * (len - 1) / (n - 1)));
      for (let i = 1; chosen.size < n && i < len; i++) chosen.add(i);
    }
    post.videos = n;
    post.scenes = post.scenes.map((s, i) => {
      const video = chosen.has(i);
      return { ...s, type: video ? 'video' : 'image', seconds: this.sceneSeconds(s, video) };
    });
    return post;
  }
  // Retry one part of a finished video: 'script' (rewrite everything), 'voice' (new voiceover, same visuals)
  // or 'visuals' (new pictures and videos; `videos` = how many scenes are video clips).
  redo(slug, what, videos) {
    const rec = this.state.posts[slug]; if (!rec) throw new Error('That video no longer exists.');
    if (!['script', 'voice', 'visuals'].includes(what)) throw new Error('Pick what to retry.');
    if (this.progress.active) throw new Error('Wait until the current task finishes.');
    const out = path.join(this.ws, 'output', slug), cdir = path.join(this.ws, 'clips', slug);
    const rm = (f) => { try { if (f && fs.existsSync(f)) fs.rmSync(f, { recursive: true, force: true }); } catch {} };
    // posts already scheduled with this version are replaced when the new version is accepted
    const had = ['youtube', 'tiktok', 'facebook'].filter((pl) => rec.upload && rec.upload[pl] && rec.upload[pl].status === 'scheduled');
    if (had.length) rec.stale = { platforms: [...new Set([...(rec.stale ? rec.stale.platforms : []), ...had])], when: rec.slot ? sched.fmtLocal(rec.slot) : (rec.stale || {}).when || '', post: (rec.stale && rec.stale.post) || { title: rec.post.title, short_caption: rec.post.short_caption } };
    this.state.jobs = this.state.jobs.filter((j) => j.slug !== slug);
    if (rec.files) { rm(rec.files.final); rm(rec.files.upload); }
    if (rec.fix && rec.fix.files) { rm(rec.fix.files.final); rm(rec.fix.files.upload); }
    try { fs.readdirSync(out).filter((f) => /^captions.*\.ass$/.test(f)).forEach((f) => rm(path.join(out, f))); } catch {}
    if (what !== 'visuals') rm(path.join(out, 'voice.mp3'));
    if (what !== 'voice') rm(cdir);
    if (what === 'visuals') {
      rec.post.videos = Math.max(1, Math.round(+videos || 1));
      if (this.autoScenesOk(rec.post, false)) this.pickVideos(rec.post, rec.post.videos); // otherwise produce() rebuilds the scenes first
      fs.writeFileSync(path.join(this.ws, 'posts', slug + '.json'), JSON.stringify(rec.post, null, 2));
    }
    Object.assign(rec, { status: 'script', approved: true, redo: true, accepted: false, upload: {}, slot: null, files: null, review: null, fix: null, error: null });
    this.save();
    const go = () => this.produce({ skipReady: true }).catch((e) => { this.feed('Retry could not start: ' + e.message.slice(0, 200)); this.finish(); rec.status = 'failed'; rec.error = e.message.slice(0, 300); this.save(); });
    if (what !== 'script') return go();
    return this.enqueue(async () => {
      const n = this.nicheInfo(), old = rec.post;
      this.begin(`Rewriting "${old.title}"`, [{ label: 'Writing a new script', w: 1 }]);
      this.step(0);
      try {
        const idea = { title: old.title, premise: old.description, hook: this.beats(old.voiceover)[0] || '' };
        const txt = await this.claude(P.scriptPrompt({ ideas: [idea], niche: n.name, nicheStyle: this.styleLine(n.style), learned: this.craftLessons(), memory: this.memoryList(), auto: this.state.settings.mediaMode === 'auto' })
          + `\n\nThis is a REWRITE: the user did not like the previous version. Keep the same topic but write a clearly better, fresh script (new wording, new scenes). Previous voiceover, do not reuse it:\n"""${old.voiceover}"""`, { onStatus: this.creep(0) });
        let arr = extractJson(txt); if (!Array.isArray(arr)) arr = [arr];
        const raws = arr.slice(0, 1).filter((r) => r && r.voiceover && Array.isArray(r.scenes) && r.scenes.length);
        if (!raws.length) throw new Error('The new script came back empty.');
        await this.repairAutoScenes(raws, this.styleLine(n.style));
        const post = this.applyMedia(raws[0]);
        Object.assign(post, { slug, niche: n.id, style: this.styleLine(n.style) });
        rec.post = post; this.state.usedTitles.push(post.title);
        fs.writeFileSync(path.join(this.ws, 'posts', slug + '.json'), JSON.stringify(post, null, 2));
        this.step(0, 'done'); this.finish('New script ready. Making the video…'); this.save();
      } catch (e) {
        this.step(0, 'error'); this.finish('Could not rewrite the script: ' + e.message.slice(0, 200));
        rec.status = 'failed'; rec.error = 'Script rewrite failed: ' + e.message.slice(0, 300); this.save(); return;
      }
      setTimeout(go, 0);
    });
  }
  clipCount(slug) {
    try { return fs.readdirSync(path.join(this.ws, 'clips', slug)).filter((f) => /^\d+\.(mp4|png|jpe?g|webp)$/i.test(f)).length; } catch { return 0; }
  }
  // Music, assembly, check and (with Auto approve) scheduling of whatever visuals exist.
  async finishVideo(slug) {
    const rec = this.state.posts[slug], post = rec.post;
    const mc = await this.chooseMusic(post);
    rec.music = mc;
    const res = await assemble(this.ws, post, mc.file ? path.join(this.ws, 'music', mc.file) : null, (m) => this.feed(m));
    rec.files = res; rec.status = 'ready'; rec.accepted = false; rec.error = null;
    rec.review = await reviewVideo(this.ws, post, res).catch(() => null);
    if (!rec.redo) this.state.daily[today()] = (this.state.daily[today()] || 0) + 1;
    delete rec.redo;
    this.save();
    if (this.state.settings.autoApprove && (!rec.review || rec.review.ok)) this.accept(slug, true); // a video with detected problems waits for your Fix
  }
  // Continue: finish an unfinished video with exactly what is already made (script, voiceover, scenes, clips). Nothing new is generated;
  // a missing scene's words are shown over the scene before it.
  continueVideo(slug) {
    const rec = this.state.posts[slug]; if (!rec) throw new Error('That video no longer exists.');
    if (this.progress.active) throw new Error('Wait until the current task finishes.');
    const voice = path.join(this.ws, 'output', slug, 'voice.mp3');
    if (!fs.existsSync(voice) || fs.statSync(voice).size < 20000) throw new Error('This video has no voiceover yet, so it cannot be finished. Use Retry.');
    if (!this.clipCount(slug)) throw new Error('No pictures or clips were made for this video yet. Use Retry.');
    return this.enqueue(async () => {
      const miss = this.missingScenes(slug, rec.post);
      this.begin(`Finishing "${rec.post.title}" with what is already made`, [{ label: `Assembling ${rec.post.scenes.length - miss.length}/${rec.post.scenes.length} scenes`, w: 1 }]);
      this.step(0);
      if (miss.length) this.feed(`Using the existing voiceover and ${rec.post.scenes.length - miss.length} of ${rec.post.scenes.length} scenes. Missing scene${miss.length > 1 ? 's' : ''} ${miss.join(', ')} are covered by the scene before.`);
      try {
        rec.status = 'making'; rec.error = null; this.save();
        await this.finishVideo(slug);
        this.step(0, 'done'); this.finish('Finished with the existing voiceover, script and clips.');
      } catch (e) {
        rec.status = 'failed'; rec.error = e.message.slice(0, 400); this.save();
        this.step(0, 'error'); this.finish('Could not finish: ' + e.message.slice(0, 200));
      }
    });
  }
  missingScenes(slug, post) {
    const cdir = path.join(this.ws, 'clips', slug);
    return post.scenes.map((_, i) => i + 1).filter((n) => !['mp4', 'png', 'jpg', 'jpeg', 'webp'].some((e) => fs.existsSync(path.join(cdir, `${String(n).padStart(2, '0')}.${e}`))));
  }
  async produce({ skipReady = false } = {}) {
    return this.enqueue(async () => {
      const todo = this.pending().map(([slug]) => slug);
      if (!todo.length) throw new Error('No approved scripts to produce.');
      const left = MAX_PER_DAY - (this.state.daily[today()] || 0);
      if (todo.filter((s) => !this.state.posts[s].redo).length > left) throw new Error(`Daily limit: only ${Math.max(left, 0)} more video(s) allowed today.`);
      if (!skipReady && !this.isReady()) throw new Error('Finish the Setup checks first (all logins must pass).');
      const steps = [];
      todo.forEach((slug) => {
        const t = this.state.posts[slug].post.title;
        steps.push({ label: `Voiceover: ${t}`, w: 2 }, { label: `Visuals in Google Flow: ${t}`, w: 8 }, { label: `Assembling: ${t}`, w: 2 });
      });
      this.begin('Making your videos', steps);
      let noVideoCredits = false; // once Flow runs out of video credits, later Automatic videos in this batch use pictures only
      for (let v = 0; v < todo.length; v++) {
        const slug = todo[v], rec = this.state.posts[slug], post = rec.post, b = v * 3;
        try {
          rec.status = 'making'; this.save();
          fs.mkdirSync(path.join(this.ws, 'output', slug), { recursive: true });
          fs.mkdirSync(path.join(this.ws, 'clips', slug), { recursive: true });
          // 1. voiceover (skipped when a good file already exists, e.g. after a retry)
          this.step(b);
          const vfile = path.join(this.ws, 'output', slug, 'voice.mp3');
          if (fs.existsSync(vfile) && fs.statSync(vfile).size > 20000) this.feed('Voiceover already exists, reusing it');
          else {
            await this.chromeRun((note) => P.voicePrompt({ post, voice: this.state.settings.voice, ws: this.ws, downloads: this.downloads }) + this.hintFor(rec, 'produce') + note, { onStatus: this.creep(b), label: 'the voiceover' });
            if (!fs.existsSync(vfile) || fs.statSync(vfile).size < 20000) throw new Error('Voiceover failed: the audio file was not saved.');
          }
          this.step(b, 'done');
          // 2. Flow visuals. Old or short scene lists are rebuilt to one scene per phrase first (their old clips no longer match).
          if (!this.autoScenesOk(post, false) && this.clipCount(slug) === 0) {
            await this.repairAutoScenes([post], post.style || this.styleLine(this.nicheInfo().style));
            if (this.autoScenesOk(post, false)) {
              if (post.videos) this.pickVideos(post, post.videos); else this.applyMedia(post);
              fs.rmSync(path.join(this.ws, 'clips', slug), { recursive: true, force: true }); fs.mkdirSync(path.join(this.ws, 'clips', slug), { recursive: true });
              fs.writeFileSync(path.join(this.ws, 'posts', slug + '.json'), JSON.stringify(post, null, 2)); this.save();
            }
          }
          // Flow: only scenes that are still missing; progress follows the files that appear
          this.step(b + 1);
          const cdir = path.join(this.ws, 'clips', slug);
          const poll = setInterval(() => {
            const n = post.scenes.length - this.missingScenes(slug, post).length;
            this.sub(b + 1, n / post.scenes.length); this.progress.steps[b + 1].label = `Visuals in Google Flow: ${post.title} (${n}/${post.scenes.length})`;
          }, 3000);
          const auto = this.state.settings.mediaMode === 'auto';
          const toPictures = (why) => { // Automatic mode: missing video scenes become pictures (no more video credits spent)
            const vids = this.missingScenes(slug, post).filter((n) => post.scenes[n - 1].type === 'video');
            if (!vids.length) return false;
            vids.forEach((n) => { post.scenes[n - 1] = { ...post.scenes[n - 1], type: 'image' }; });
            fs.writeFileSync(path.join(this.ws, 'posts', slug + '.json'), JSON.stringify(post, null, 2)); this.save();
            this.feed(`${why} Making scene${vids.length > 1 ? 's' : ''} ${vids.join(', ')} as picture${vids.length > 1 ? 's' : ''} instead.`);
            return true;
          };
          if (auto && noVideoCredits) toPictures('Google Flow is out of video credits.');
          try {
            let lastErr = '';
            for (let attempt = 1; attempt <= 3 && this.missingScenes(slug, post).length; attempt++) {
              const only = this.missingScenes(slug, post);
              try {
                const fr = await this.chromeRun((note) => P.flowPrompt({ post, style: post.style || this.nicheInfo().style, ws: this.ws, downloads: this.downloads, only: only.length < post.scenes.length ? only : null }) + this.hintFor(rec, 'produce') + note, { attempts: 1, onStatus: (m) => this.feed(m), label: 'Google Flow', maxTurns: 700 });
                if (fr && fr.detail && this.missingScenes(slug, post).length) lastErr = String(fr.detail);
              } catch (e) { if (this.cancelled) throw e; lastErr = e.message; this.feed(`Flow problem: ${lastErr.slice(0, 120)}`); if (/not connected|extension is not|extension not|no browser/i.test(lastErr)) break; }
              if (CREDITS_RE.test(lastErr)) {
                noVideoCredits = true;
                if (!auto || !toPictures('Google Flow is out of video credits.')) break; // other modes: stop and tell you
                attempt = Math.min(attempt, 2); // one more run just for the pictures
              } else if (lastErr) await new Promise((r) => setTimeout(r, 4000));
            }
            const miss = this.missingScenes(slug, post);
            if (miss.length) throw new Error(`Google Flow did not produce scene${miss.length > 1 ? 's' : ''} ${miss.join(', ')}. ${lastErr}`.trim());
          } finally { clearInterval(poll); }
          this.step(b + 1, 'done');
          // 3. assemble
          this.step(b + 2);
          await this.finishVideo(slug);
          this.step(b + 2, 'done');
        } catch (e) {
          rec.status = 'failed'; rec.error = e.message.slice(0, 400);
          [b, b + 1, b + 2].forEach((i) => { if (this.progress.steps[i].status !== 'done') this.step(i, 'error'); });
          this.feed(`"${post.title}" failed: ${e.message.slice(0, 200)}`); this.save();
          if (this.cancelled) break;
          this.alert({ kind: 'produce', slug, title: `"${post.title}" could not be finished`, detail: rec.error });
        }
      }
      this.finish('Production finished.');
    });
  }

  // ---------- review and fix ----------
  async reviewNow(slug) {
    const rec = this.state.posts[slug]; if (!rec || !rec.files) return;
    rec.review = await reviewVideo(this.ws, rec.post, rec.files, rec.files.tag || '');
    this.save();
  }
  // Turn the user's plain-English fix request into numeric adjustments.
  async interpretFix(note) {
    const fallback = () => {
      const o = {}; const t = note.toLowerCase();
      const m = t.match(/(\d+(?:\.\d+)?)\s*(?:s|sec)/); const sec = m ? +m[1] : 0.5;
      if (/(visual|video|image|picture|scene|clip).*(early|ahead|fast|before)|(early|ahead).*(visual|video|image|picture|scene)/.test(t)) o.visualShift = sec;
      else if (/(visual|video|image|picture|scene|clip).*(late|behind|slow|after)/.test(t)) o.visualShift = -sec;
      if (/caption.*(early|ahead)/.test(t)) o.captionShift = sec; else if (/caption.*(late|behind)/.test(t)) o.captionShift = -sec;
      if (/music.*(loud|too much)/.test(t)) o.musicVolume = 0.07; else if (/music.*(quiet|low|soft)/.test(t)) o.musicVolume = 0.2;
      return o;
    };
    const quick = fallback();
    if (Object.keys(quick).length && note.trim().split(/\s+/).length <= 14) return quick; // clear short note: no Claude call needed
    try {
      const raw = await this.claude(`A user is fixing a short video that was assembled automatically. Convert their request into adjustments.
Request: "${note}"
Fields (seconds; positive = LATER): visualShift = move every picture/clip change later (use when visuals change too EARLY, typically 0.2-1.5), captionShift = move captions later (negative = earlier), musicVolume = 0.03-0.4 (default 0.12), or omit a field.
Reply with ONLY JSON: {"visualShift":0,"captionShift":0,"musicVolume":0.12,"summary":"what you will change in 8 words"}`, {});
      const j = extractJson(raw);
      const out = {};
      if (isFinite(j.visualShift) && j.visualShift) out.visualShift = Math.max(-3, Math.min(3, +j.visualShift));
      if (isFinite(j.captionShift) && j.captionShift) out.captionShift = Math.max(-3, Math.min(3, +j.captionShift));
      if (j.musicVolume > 0) out.musicVolume = Math.min(+j.musicVolume, 0.4);
      return Object.keys(out).length ? out : fallback();
    } catch { return fallback(); }
  }
  fixVideo(slug, note = '') {
    const rec = this.state.posts[slug]; if (!rec || !rec.files) return;
    note = String(note || '').trim();
    return this.enqueue(async () => {
      this.begin(`Fixing "${rec.post.title}"`, [{ label: note ? 'Understanding your fix request' : 'Re-timing scenes and captions to the voice', w: 1 }, { label: 'Rebuilding the video', w: 4 }, { label: 'Checking the fixed video', w: 1 }]);
      rec.fix = { status: 'working' }; this.save();
      try {
        this.step(0);
        let adj = {};
        if (note) { adj = await this.interpretFix(note); this.feed('Applying: ' + (JSON.stringify(adj) === '{}' ? 'a fresh re-time to the voice' : JSON.stringify(adj))); }
        this.step(0, 'done'); this.step(1);
        const musicFile = rec.music && rec.music.file ? path.join(this.ws, 'music', rec.music.file) : null;
        const tag = '-fix' + Date.now().toString(36).slice(-4);
        const files = await assemble(this.ws, rec.post, musicFile, (m) => this.feed(m), tag, adj);
        files.tag = tag;
        this.step(1, 'done'); this.step(2);
        const report = await reviewVideo(this.ws, rec.post, files, tag);
        rec.fix = { status: 'review', files, report, at: Date.now(), note };
        this.step(2, 'done'); this.finish(report.ok ? 'Fixed version is ready. Preview it, then approve.' : 'Fixed version is ready, but some issues remain.');
      } catch (e) { rec.fix = { status: 'failed', error: e.message.slice(0, 200) }; this.step(this.progress.steps.findIndex((s) => s.status === 'active'), 'error'); this.finish('Fix failed: ' + e.message.slice(0, 160)); }
      this.save();
    });
  }
  discardFix(slug) {
    const rec = this.state.posts[slug]; if (!rec) return;
    const fx = rec.fix && rec.fix.files;
    if (fx && fx.tag && (!rec.files || rec.files.tag !== fx.tag)) for (const f of [fx.final, fx.upload, path.join(this.ws, 'output', slug, `captions${fx.tag}.ass`)]) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
    rec.fix = null; this.save();
  }
  // Safety net: if the finished video file has gone missing, rebuild it from the saved voice and visuals before uploading.
  ensureVideo(slug) {
    const rec = this.state.posts[slug]; if (!rec) return Promise.resolve();
    const f = rec.files;
    if (f && f.upload && fs.existsSync(f.upload)) return Promise.resolve();
    this.rebuilding = this.rebuilding || new Map();
    if (this.rebuilding.has(slug)) return this.rebuilding.get(slug);
    const p = (async () => {
      this.feed('The video file is missing, rebuilding it from the saved voice and visuals…');
      const musicFile = rec.music && rec.music.file ? path.join(this.ws, 'music', rec.music.file) : null;
      try {
        const res = await assemble(this.ws, rec.post, musicFile, (m) => this.feed(m), '');
        rec.files = { ...res, tag: '' }; rec.review = null; this.save();
      } catch (e) { throw new Error('The video file is missing and could not be rebuilt (' + e.message.slice(0, 160) + '). Press Fix on the video to rebuild it.'); }
    })().finally(() => this.rebuilding.delete(slug));
    this.rebuilding.set(slug, p);
    return p;
  }
  // Approving a fix only swaps the video: the fixed file replaces the previous one (which is deleted).
  // Nothing is scheduled or posted until you press "Accept & schedule" again.
  approveFix(slug) {
    const rec = this.state.posts[slug]; if (!rec || !rec.fix || rec.fix.status !== 'review') return;
    const fx = rec.fix.files, old = rec.files || {}, out = path.join(this.ws, 'output', slug);
    const norm = (f) => path.resolve(String(f)).toLowerCase();
    const keep = new Set([fx.final, fx.upload, path.join(out, `captions${fx.tag || ''}.ass`)].filter(Boolean).map(norm));
    const rmOld = (f) => { try { if (f && !keep.has(norm(f)) && fs.existsSync(f)) fs.unlinkSync(f); } catch {} };
    // posts that were already scheduled with the old video must be replaced when the user accepts again
    const had = ['youtube', 'tiktok', 'facebook'].filter((pl) => rec.upload && rec.upload[pl] && rec.upload[pl].status === 'scheduled');
    if (had.length) rec.stale = { platforms: had, when: rec.slot ? sched.fmtLocal(rec.slot) : '' };
    rmOld(old.final); rmOld(old.upload); rmOld(path.join(out, `captions${old.tag || ''}.ass`));
    rec.files = { ...fx }; rec.review = rec.fix.report; rec.fix = null;
    rec.accepted = false; rec.upload = {}; rec.slot = null;
    this.state.jobs = this.state.jobs.filter((j) => j.slug !== slug);
    this.save();
  }
  // Used by accept() when the previous version of this video was already scheduled somewhere.
  replaceQueued(slug) {
    const rec = this.state.posts[slug], st = rec.stale;
    return this.enqueue(async () => {
      this.begin(`Replacing the queued uploads of "${rec.post.title}"`, st.platforms.map((pl) => ({ label: `${pl[0].toUpperCase() + pl.slice(1)}: remove old, upload fixed`, w: 3 })));
      for (const [i, pl] of st.platforms.entries()) {
        this.step(i);
        try {
          await this.chromeRun((note) => P.deleteScheduledPrompt({ platform: pl, post: { ...rec.post, ...(st.post || {}) }, when: st.when, fbPage: this.state.settings.fbPage }) + note, { attempts: 2, onStatus: this.creep(i), label: `removing the old ${pl} post` });
        } catch (e) {
          if (this.cancelled) { this.step(i, 'error'); break; }
          rec.upload[pl] = { status: 'failed', detail: 'Could not remove the old scheduled post: ' + e.message.slice(0, 160) + ' Delete it yourself, then press Retry upload to schedule the fixed video.' };
          this.step(i, 'error'); this.save();
          this.alert({ kind: 'upload', slug, platform: pl, title: `Could not replace the ${pl} upload`, detail: rec.upload[pl].detail });
          continue;
        }
        rec.upload[pl] = { status: 'queued' }; this.save();
        await this.uploadOne(slug, pl, i);
      }
      rec.stale = null; this.save();
      this.finish('Replacement finished.');
    });
  }

  // ---------- upload & schedule ----------
  // Always check the clock right before scheduling: a queued slot can pass while earlier uploads run.
  ensureSlot(slug) {
    const rec = this.state.posts[slug];
    if (rec.slot && rec.slot >= Date.now() + sched.LEAD_MS) return rec.slot;
    if (rec.customSlot && rec.customSlot >= Date.now() + sched.LEAD_MS) { rec.slot = rec.customSlot; this.retime(slug, rec.slot); return rec.slot; }
    const [slot] = sched.nextSlots(1, this.takenTimes(slug), Date.now(), this.state.settings.slotJitter !== false);
    if (rec.slot) this.feed(`The planned time ${sched.fmtLocal(rec.slot)} has passed, moving to ${sched.fmtLocal(slot)}`);
    rec.slot = slot; this.retime(slug, slot);
    return slot;
  }
  retime(slug, slot) {
    for (const j of this.state.jobs.filter((x) => x.slug === slug && (x.status === 'waiting' || (x.status === 'failed' && /stopped|closed|code null/i.test(x.detail || ''))))) { j.status = 'waiting'; j.runAt = slot + (j.kind === 'post' ? 0 : j.platform === 'facebook' ? 4 : 3) * 60000; }
    this.save();
  }
  // Pick your own posting time for one video (ms timestamp), or null to go back to automatic US slots.
  setCustomSlot(slug, ts) {
    const rec = this.state.posts[slug]; if (!rec) return;
    if (ts && ts < Date.now() + sched.LEAD_MS) throw new Error('Pick a time at least 20 minutes from now.');
    rec.customSlot = ts || null;
    if (!rec.accepted) rec.slot = null;
    this.save();
  }
  async uploadOne(slug, pl, stepIdx = 0) {
    const rec = this.state.posts[slug];
    rec.tried = rec.tried || {}; const isRetry = !!rec.tried[pl]; rec.tried[pl] = true;
    rec.upload[pl] = { status: 'running' }; this.save();
    const t0 = Date.now();
    try {
      await this.ensureVideo(slug);
      let slot;
      const r = await this.chromeRun((note) => {
        slot = this.ensureSlot(slug); // re-checked on every attempt
        const step = (rec.minuteStep && rec.minuteStep[pl]) || MINUTE_STEP[pl] || 0;
        if (step) slot = roundUp(slot, step);
        const when = { local: sched.fmtLocal(slot), et: sched.fmtET(slot), ...sched.localParts(slot) };
        return P.uploadPrompt({ platform: pl, post: rec.post, files: rec.files, when, fbPage: this.state.settings.fbPage, retry: isRetry || !!note }) + this.hintFor(rec, pl) + note;
      }, { onStatus: this.creep(stepIdx), label: `the ${pl} upload`, model: UPLOAD_MODEL });
      const secs = Math.round((Date.now() - t0) / 1000);
      this.feed(`${pl}: scheduled in ${Math.floor(secs / 60)}m ${secs % 60}s`);
      rec.upload[pl] = { status: 'scheduled', detail: r.detail || '', when: slot, secs };
      this.step(stepIdx, 'done');
    } catch (e) {
      if (this.cancelled) { rec.upload[pl] = { status: 'stopped', detail: 'Stopped by you. Press Retry upload to continue.' }; this.step(stepIdx, 'error'); }
      else {
        rec.upload[pl] = { status: 'failed', detail: e.message.slice(0, 300) }; this.step(stepIdx, 'error');
        this.alert({ kind: 'upload', slug, platform: pl, title: `The ${pl} upload failed`, detail: e.message.slice(0, 400) });
      }
    }
    this.save();
  }
  accept(slug, auto = false) {
    const rec = this.state.posts[slug]; if (!rec || rec.status !== 'ready') return;
    rec.accepted = true;
    rec.slot = null; this.ensureSlot(slug);
    rec.upload = {}; PLATFORMS.forEach((p) => (rec.upload[p] = { status: 'queued' }));
    this.state.jobs = this.state.jobs.filter((j) => j.slug !== slug);
    this.state.jobs.push({ id: `${slug}:ig`, kind: 'post', platform: 'instagram', slug, runAt: rec.slot, status: 'waiting' });
    ['facebook', 'instagram'].forEach((pl) => this.state.jobs.push({ id: `${slug}:c:${pl}`, kind: 'comment', platform: pl, slug, runAt: rec.slot + (pl === 'facebook' ? 4 : 3) * 60000, status: 'waiting' }));
    rec.upload.instagram = { status: 'waiting', detail: `Instagram can't schedule on the web. The app will post it at the planned time (keep the app and Chrome open).` };
    this.save();
    if (rec.stale && rec.stale.platforms.length) this.replaceQueued(slug); else this.uploadMany(slug, ['youtube', 'tiktok', 'facebook']);
  }
  uploadMany(slug, list) {
    const rec = this.state.posts[slug];
    return this.enqueue(async () => {
      this.begin(`Scheduling "${rec.post.title}"`, list.map((p) => ({ label: `${p[0].toUpperCase() + p.slice(1)}: schedule`, w: 3 })));
      if (list.length > 1 && this.state.settings.parallelUploads !== false) {
        list.forEach((_, i) => this.step(i));
        await Promise.all(list.map((pl, i) => this.uploadOne(slug, pl, i))); // each platform in its own browser tab at the same time
      } else {
        for (const [i, pl] of list.entries()) {
          this.step(i);
          await this.uploadOne(slug, pl, i);
          if (this.cancelled) break;
        }
      }
      this.finish('Uploads finished.');
    });
  }
  // Retry whatever is not scheduled yet (failed, stopped, or never started).
  retryUpload(slug, pl) {
    const rec = this.state.posts[slug]; if (!rec) return;
    const list = pl ? [pl] : ['youtube', 'tiktok', 'facebook'].filter((x) => !rec.upload || !['scheduled', 'posted'].includes((rec.upload[x] || {}).status));
    if (!rec.upload) { rec.upload = {}; PLATFORMS.forEach((p) => (rec.upload[p] = { status: 'queued' })); }
    if (list.includes('instagram')) { this.retryJob(`${slug}:ig`); list.splice(list.indexOf('instagram'), 1); }
    if (list.length) { list.forEach((x) => (rec.upload[x] = { status: 'queued' })); this.save(); this.uploadMany(slug, list); }
  }
  reject(slug) { const rec = this.state.posts[slug]; if (rec) { rec.status = 'rejected'; this.save(); } }

  // Timed jobs: Instagram posting and engagement comments (a live post is needed)
  tick() {
    this.posterTick();
    const now = Date.now();
    for (const j of this.state.jobs.filter((x) => x.status === 'waiting' && x.runAt <= now)) {
      j.status = 'running'; this.save();
      this.enqueue(async () => {
        const rec = this.state.posts[j.slug]; if (!rec) { j.status = 'done'; return; }
        this.begin(j.kind === 'post' ? `Posting to Instagram: ${rec.post.title}` : `Adding a comment on ${j.platform}`, [{ label: j.kind === 'post' ? 'Instagram post' : `${j.platform} comment`, w: 1 }]);
        this.step(0);
        try {
          if (j.kind === 'post') await this.ensureVideo(j.slug);
          const mk = (note) => (j.kind === 'post' ? P.uploadPrompt({ platform: 'instagram', post: rec.post, files: rec.files, when: null, fbPage: this.state.settings.fbPage })
            : P.commentPrompt({ platform: j.platform, post: rec.post, fbPage: this.state.settings.fbPage })) + this.hintFor(rec, 'job:' + j.id) + note;
          const r = await this.chromeRun(mk, { onStatus: this.creep(0), label: j.kind === 'post' ? 'the Instagram post' : 'the comment', model: j.kind === 'comment' ? 'haiku' : UPLOAD_MODEL, maxTurns: j.kind === 'comment' ? 60 : undefined });
          j.status = 'done'; j.detail = r.detail;
          if (j.kind === 'post') rec.upload.instagram = { status: 'posted', detail: r.detail || '' };
          this.step(0, 'done');
        } catch (e) {
          j.status = 'failed'; j.detail = this.cancelled ? 'Stopped by you.' : e.message.slice(0, 300); this.step(0, 'error');
          if (j.kind === 'post') rec.upload.instagram = { status: this.cancelled ? 'stopped' : 'failed', detail: j.detail };
          if (!this.cancelled) this.alert({ kind: 'job', jobId: j.id, slug: j.slug, title: j.kind === 'post' ? 'The Instagram post failed' : `The ${j.platform} comment failed`, detail: j.detail });
        }
        this.finish(); this.save();
      });
    }
  }
  retryJob(id) { const j = this.state.jobs.find((x) => x.id === id); if (j) { j.status = 'waiting'; j.runAt = Date.now(); this.save(); this.tick(); } }
}

Object.assign(Engine.prototype, posters);

module.exports = { Engine };
