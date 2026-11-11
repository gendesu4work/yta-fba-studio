const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, findClaude, extractJson } = require('./claude');
const { spawn } = require('child_process');
const niches = require('./niches');
const P = require('./prompts');
const { assemble, sampleVideo } = require('./assemble');
const sched = require('./schedule');

const MAX_PER_DAY = 5;
const PLATFORMS = ['youtube', 'tiktok', 'facebook', 'instagram'];
const today = () => new Date().toLocaleDateString('en-CA');

const DEFAULTS = {
  settings: { niche: 'motivation', customNiche: '', voice: 'Motivational Coach - Leader', fbPage: '', mediaMode: 'auto', videoCount: 1, sceneCount: 7, autoApprove: false, model: 'sonnet', music: 'auto', theme: 'light', accent: '#00a2ff', windowMode: 'window' },
  setup: { claude: null, chrome: null, logins: null, checkedAt: null },
  refs: [], musicInfo: {}, usage: {}, ideas: [], selected: [], posts: {}, jobs: [], usedTitles: [], daily: {},
};

class Engine {
  constructor(ws, emit) {
    this.ws = ws; this.emit = emit;
    this.downloads = path.join(os.homedir(), 'Downloads');
    for (const d of ['posts', 'clips', 'output', 'music']) fs.mkdirSync(path.join(ws, d), { recursive: true });
    this.file = path.join(ws, 'state.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.state = { ...structuredClone(DEFAULTS), ...saved, settings: { ...DEFAULTS.settings, ...(saved.settings || {}) }, setup: { ...DEFAULTS.setup, ...(saved.setup || {}) } };
    this.progress = { active: false, title: '', steps: [], pct: 0, feed: [] };
    this.queue = Promise.resolve();
    this.handle = { kill: null };
    this.cancelled = false;
    this.timer = setInterval(() => this.tick(), 30000);
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1)); this.emit('state', this.publicState()); }
  publicState() {
    return { ...this.state, ready: this.isReady(), tracks: this.listTracks(), niches, progress: this.progress, usedToday: this.state.daily[today()] || 0, maxPerDay: MAX_PER_DAY, workspace: this.ws,
      claudePath: findClaude(), slotsPreview: sched.nextSlots(5, this.takenTimes()).map((t) => ({ ts: t, local: sched.fmtLocal(t), et: sched.fmtET(t) })) };
  }
  takenTimes() { return Object.values(this.state.posts).map((p) => p.slot).filter(Boolean); }

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

  cancel() { this.cancelled = true; if (this.handle.kill) this.handle.kill(); this.feed('Stopped by you.'); }

  enqueue(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch(() => {}); return p; }

  async claude(prompt, { chrome = false, tools = false, web = false, onStatus } = {}) {
    if (this.cancelled) throw new Error('Cancelled');
    const r = await run({ prompt, cwd: this.ws, chrome, tools, web, onStatus, handle: this.handle, model: this.state.settings.model, effort: chrome ? 'low' : undefined });
    if (r.usage) this.addUsage(r.usage);
    if (this.cancelled) throw new Error('Cancelled');
    if (r.isError) throw new Error(r.text || 'Claude reported an error');
    return r.text;
  }

  // ---------- settings ----------
  setSettings(patch) {
    const s = { ...this.state.settings, ...patch };
    s.videoCount = Math.max(0, Math.min(+s.videoCount || 0, s.sceneCount));
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
      this.begin(`Learning from "${name.slice(0, 50)}"`, [{ label: kind === 'file' ? 'Sampling frames and pacing' : 'Watching the video in Chrome', w: 1 }, { label: 'Analyzing the art style and craft', w: 4 }]);
      try {
        let raw;
        if (kind === 'file') {
          this.step(0);
          const dir = path.join(this.ws, 'refs', id);
          const meta = await sampleVideo(src, dir);
          ref.thumb = meta.frames[0]; ref.meta = { seconds: Math.round(meta.duration), cuts: meta.cuts, size: meta.size };
          this.step(0, 'done'); this.step(1);
          raw = await this.claude(P.analyzeFilePrompt({ name, frames: meta.frames, meta }), { tools: true, onStatus: this.creep(1) });
        } else {
          this.step(0, 'done'); this.step(1);
          raw = await this.claude(P.analyzeUrlPrompt({ url: src }), { chrome: true, tools: true, onStatus: this.creep(1) });
        }
        const j = extractJson(raw);
        ref.summary = j.summary || '';
        ref.lessons = (j.lessons || []).map((l, i) => ({ id: `${id}-${i}`, cat: l.cat || 'other', text: l.text, on: true }));
        ref.status = 'done'; this.step(1, 'done'); this.finish(`Learned ${ref.lessons.length} things.`);
      } catch (e) {
        ref.status = 'failed'; ref.error = e.message.slice(0, 200);
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
        const txt = await this.claude(P.ideasPrompt({ niche: n.name, nicheNote: n.note, used: this.state.usedTitles }), { onStatus: (m) => this.feed(m) });
        const arr = extractJson(txt);
        this.state.ideas = arr.slice(0, 10).map((x, i) => ({ id: `${Date.now()}-${i}`, ...x }));
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
  applyMedia(post) {
    const { mediaMode, videoCount } = this.state.settings;
    const auto = mediaMode === 'auto' && post.scenes.every((s) => s && s.line);
    post.scenes = post.scenes.map((s, i) => {
      if (auto) {
        const words = String(s.line).split(/\s+/).filter(Boolean).length;
        const video = i === 0 || s.type === 'video'; // the hook is always a moving clip
        return { ...s, type: video ? 'video' : 'image', seconds: Math.max(2, Math.round(words / 2.6 * 10) / 10) };
      }
      const video = mediaMode === 'videos' || (mediaMode === 'mixed' && i < Math.max(1, videoCount));
      return { ...s, type: video ? 'video' : 'image', seconds: video ? 8 : Math.min(Math.max(s.seconds || 5, 4), 7) };
    });
    return post;
  }
  async generateScripts() {
    return this.enqueue(async () => {
      const picks = this.state.ideas.filter((i) => this.state.selected.includes(i.id));
      if (!picks.length) throw new Error('Pick at least one idea first.');
      const n = this.nicheInfo();
      this.begin('Writing scripts', [{ label: `Writing ${picks.length} script${picks.length > 1 ? 's' : ''} in one go`, w: 1 }]);
      this.step(0);
      try {
        const txt = await this.claude(P.scriptPrompt({ ideas: picks, niche: n.name, nicheStyle: this.styleLine(n.style), sceneCount: this.state.settings.sceneCount, learned: this.craftLessons(), auto: this.state.settings.mediaMode === 'auto' }), { onStatus: this.creep(0) });
        let arr = extractJson(txt); if (!Array.isArray(arr)) arr = [arr];
        for (const raw of arr.slice(0, picks.length)) {
          if (!raw || !raw.voiceover || !Array.isArray(raw.scenes) || !raw.scenes.length) continue;
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

  // ---------- production (voice -> Flow -> assemble) ----------
  pending() { return Object.entries(this.state.posts).filter(([, p]) => p.status === 'script' && p.approved); }
  async produce() {
    return this.enqueue(async () => {
      const todo = this.pending().map(([slug]) => slug);
      if (!todo.length) throw new Error('No approved scripts to produce.');
      const left = MAX_PER_DAY - (this.state.daily[today()] || 0);
      if (todo.length > left) throw new Error(`Daily limit: only ${Math.max(left, 0)} more video(s) allowed today.`);
      if (!this.isReady()) throw new Error('Finish the Setup checks first (all logins must pass).');
      const steps = [];
      todo.forEach((slug) => {
        const t = this.state.posts[slug].post.title;
        steps.push({ label: `Voiceover: ${t}`, w: 2 }, { label: `Visuals in Google Flow: ${t}`, w: 8 }, { label: `Assembling: ${t}`, w: 2 });
      });
      this.begin('Making your videos', steps);
      for (let v = 0; v < todo.length; v++) {
        const slug = todo[v], rec = this.state.posts[slug], post = rec.post, b = v * 3;
        try {
          rec.status = 'making'; this.save();
          fs.mkdirSync(path.join(this.ws, 'output', slug), { recursive: true });
          fs.mkdirSync(path.join(this.ws, 'clips', slug), { recursive: true });
          // 1. voiceover
          this.step(b);
          const vr = extractJson(await this.claude(P.voicePrompt({ post, voice: this.state.settings.voice, ws: this.ws, downloads: this.downloads }), { chrome: true, tools: true, onStatus: this.creep(b) }));
          if (!vr.ok || !fs.existsSync(path.join(this.ws, 'output', slug, 'voice.mp3'))) throw new Error('Voiceover failed: ' + (vr.detail || 'file missing'));
          this.step(b, 'done');
          // 2. Flow visuals: progress follows the clips that appear in the folder
          this.step(b + 1);
          const cdir = path.join(this.ws, 'clips', slug);
          const poll = setInterval(() => {
            const n = fs.readdirSync(cdir).filter((f) => /^\d\d\./.test(f)).length;
            this.sub(b + 1, n / post.scenes.length); this.progress.steps[b + 1].label = `Visuals in Google Flow: ${post.title} (${n}/${post.scenes.length})`;
          }, 3000);
          try {
            const fr = extractJson(await this.claude(P.flowPrompt({ post, style: post.style || this.nicheInfo().style, ws: this.ws, downloads: this.downloads }), { chrome: true, tools: true, onStatus: (m) => this.feed(m) }));
            if (fr.ok === false && !(fr.saved || []).length) throw new Error('Flow failed: ' + (fr.detail || ''));
          } finally { clearInterval(poll); }
          this.step(b + 1, 'done');
          // 3. assemble
          this.step(b + 2);
          const mc = await this.chooseMusic(post);
          rec.music = mc;
          const res = await assemble(this.ws, post, mc.file ? path.join(this.ws, 'music', mc.file) : null, (m) => this.feed(m));
          rec.files = res; rec.status = 'ready'; rec.accepted = false;
          this.state.daily[today()] = (this.state.daily[today()] || 0) + 1;
          this.step(b + 2, 'done');
          this.save();
          if (this.state.settings.autoApprove) this.accept(slug, true);
        } catch (e) {
          rec.status = 'failed'; rec.error = e.message.slice(0, 300);
          [b, b + 1, b + 2].forEach((i) => { if (this.progress.steps[i].status !== 'done') this.step(i, 'error'); });
          this.feed(`"${post.title}" failed: ${e.message.slice(0, 200)}`); this.save();
          if (this.cancelled) break;
        }
      }
      this.finish('Production finished.');
    });
  }

  // ---------- upload & schedule ----------
  accept(slug, auto = false) {
    const rec = this.state.posts[slug]; if (!rec || rec.status !== 'ready') return;
    rec.accepted = true;
    const [slot] = sched.nextSlots(1, this.takenTimes());
    rec.slot = slot; rec.upload = {}; PLATFORMS.forEach((p) => (rec.upload[p] = { status: 'queued' }));
    this.state.jobs.push({ id: `${slug}:ig`, kind: 'post', platform: 'instagram', slug, runAt: slot, status: 'waiting' });
    ['facebook', 'instagram'].forEach((pl) => this.state.jobs.push({ id: `${slug}:c:${pl}`, kind: 'comment', platform: pl, slug, runAt: slot + (pl === 'facebook' ? 4 : 3) * 60000, status: 'waiting' }));
    this.save();
    this.enqueue(async () => {
      this.begin(`Scheduling "${rec.post.title}"`, ['youtube', 'tiktok', 'facebook'].map((p) => ({ label: `${p[0].toUpperCase() + p.slice(1)}: schedule for ${sched.fmtLocal(slot)}`, w: 3 })));
      const when = { local: sched.fmtLocal(slot), et: sched.fmtET(slot), ...sched.localParts(slot) };
      for (const [i, pl] of ['youtube', 'tiktok', 'facebook'].entries()) {
        this.step(i);
        try {
          const r = extractJson(await this.claude(P.uploadPrompt({ platform: pl, post: rec.post, files: rec.files, when, fbPage: this.state.settings.fbPage }), { chrome: true, tools: true, onStatus: this.creep(i) }));
          rec.upload[pl] = { status: r.ok ? 'scheduled' : 'failed', detail: r.detail || '' };
          this.step(i, r.ok ? 'done' : 'error');
        } catch (e) { rec.upload[pl] = { status: 'failed', detail: e.message.slice(0, 200) }; this.step(i, 'error'); if (this.cancelled) break; }
        this.save();
      }
      rec.upload.instagram = { status: 'waiting', detail: `Instagram can't schedule on the web. The app will post it at ${sched.fmtLocal(slot)} (keep the app and Chrome open).` };
      this.finish('Scheduled. Instagram and the comments run at publish time.');
      this.save();
    });
  }
  reject(slug) { const rec = this.state.posts[slug]; if (rec) { rec.status = 'rejected'; this.save(); } }

  // Timed jobs: Instagram posting and engagement comments (a live post is needed)
  tick() {
    const now = Date.now();
    for (const j of this.state.jobs.filter((x) => x.status === 'waiting' && x.runAt <= now)) {
      j.status = 'running'; this.save();
      this.enqueue(async () => {
        const rec = this.state.posts[j.slug]; if (!rec) { j.status = 'done'; return; }
        this.begin(j.kind === 'post' ? `Posting to Instagram: ${rec.post.title}` : `Adding a comment on ${j.platform}`, [{ label: j.kind === 'post' ? 'Instagram post' : `${j.platform} comment`, w: 1 }]);
        this.step(0);
        try {
          const prompt = j.kind === 'post' ? P.uploadPrompt({ platform: 'instagram', post: rec.post, files: rec.files, when: null, fbPage: this.state.settings.fbPage })
            : P.commentPrompt({ platform: j.platform, post: rec.post, fbPage: this.state.settings.fbPage });
          const r = extractJson(await this.claude(prompt, { chrome: true, tools: true, onStatus: this.creep(0) }));
          j.status = r.ok ? 'done' : 'failed'; j.detail = r.detail;
          if (j.kind === 'post') rec.upload.instagram = { status: r.ok ? 'posted' : 'failed', detail: r.detail || '' };
          this.step(0, r.ok ? 'done' : 'error');
        } catch (e) { j.status = 'failed'; j.detail = e.message.slice(0, 200); this.step(0, 'error'); }
        this.finish(); this.save();
      });
    }
  }
  retryJob(id) { const j = this.state.jobs.find((x) => x.id === id); if (j) { j.status = 'waiting'; j.runAt = Date.now(); this.save(); this.tick(); } }
}

module.exports = { Engine };
