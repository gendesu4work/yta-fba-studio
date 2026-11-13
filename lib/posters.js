// Poster tab: pick a niche -> Claude Opus writes 5 ideas -> pick one -> Google Flow makes the picture (Claude in Chrome)
// -> the user edits the text (Claude helps) -> approve -> post now or schedule at a US prime-time slot on a Facebook Page
// and, optionally, Instagram. Mixed into Engine (methods use `this`).
const fs = require('fs');
const path = require('path');
const { extractJson } = require('./claude');
const PN = require('./posterNiches');
const PP = require('./posterPrompts');
const sched = require('./schedule');
const { execFile } = require('child_process');

// Token savings: Opus ONLY writes the ideas (the user's choice). Every browser step runs on Sonnet at low effort
// whatever the Create tab's model setting is (the user's rule: Opus for ideas, Sonnet for everything else).
const IDEA_MODEL = 'opus';
const EDIT_MODEL = 'sonnet';
const POST_MODEL = 'sonnet';
const FLOW_MODEL = 'sonnet';
// Lean runs (see claude.js slim): tiny system prompt + only the tools each task needs.
const SYS_TEXT = 'You write short, original social media copy. Follow the instructions exactly. Reply with JSON only, no other text.';
const SYS_WEB = 'You write short, original social media copy. Use at most 3 web searches. Reply with JSON only, no other text.';
const SYS_BROWSER = 'You drive the user\'s own Chrome through the given tools. Follow the numbered steps exactly with as few tool calls as possible. Reply with JSON only.';
const T_FLOW = ['navigate', 'javascript_tool', 'tabs_close_mcp'];
const T_POST = ['navigate', 'javascript_tool', 'find', 'file_upload', 'tabs_close_mcp']; // the page script types the time itself, so no mouse/keyboard tool
const T_IG = ['navigate', 'javascript_tool', 'find', 'file_upload', 'computer', 'tabs_close_mcp'];
const T_COMMENT = ['navigate', 'javascript_tool', 'find', 'computer', 'browser_batch', 'tabs_close_mcp'];
const IMG_RE = /^v\d+\.(png|jpe?g|webp)$/i;
const ANGLES = ['unexpected contrast', 'nostalgia', 'a tiny everyday win', 'a common mistake', 'a "nobody talks about this" truth', 'a before/after', 'a myth vs reality', 'a bold one-liner', 'a seasonal moment', 'a work-life moment', 'a money moment', 'a weekend moment', 'a Monday moment', 'an underdog', 'a surprising number from a real source', 'a quiet, cinematic mood', 'loud and colourful', 'minimal and clean', 'a question that sparks debate', 'a hidden detail people miss'];
const pick = (a, n) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
const clean = (t, base) => {
  const o = { ...base, ...(t || {}) };
  if (o.position === 'split') o.position = 'top';
  if (!['top', 'center', 'bottom'].includes(o.position)) o.position = ['top', 'center', 'bottom'].includes(base.position) ? base.position : 'top';
  if (!['none', 'shade', 'box'].includes(o.band)) o.band = base.band;
  o.size = Math.max(0.5, Math.min(1.6, +o.size || 1));
  o.dark = o.dark == null || isNaN(+o.dark) ? 0.75 : Math.max(0, Math.min(1, +o.dark)); // dark grade + vignette strength
  o.headline = String(o.headline || ''); o.sub = ''; o.footer = ''; // always: one hook caption on a square picture
  o.stroke = !!o.stroke; o.upper = !!o.upper;
  return o;
};

module.exports = {
  posterInit() {
    const p = (this.state.poster = { niche: 'memes', custom: '', ideas: [], pick: null, history: [], items: {}, jobs: [], ...(this.state.poster || {}) });
    for (const it of Object.values(p.items)) {
      if (it.status === 'generating') { it.status = it.variants && it.variants.length ? 'editing' : 'failed'; it.error = 'The app was closed while the picture was being made.'; }
      for (const u of Object.values(it.upload || {})) if (u.status === 'running') { u.status = 'failed'; u.detail = 'The app was closed during this post.'; }
    }
    for (const j of p.jobs) if (j.status === 'running') { j.status = 'failed'; j.detail = 'The app was closed during this task.'; }
    fs.mkdirSync(path.join(this.ws, 'posters'), { recursive: true });
  },
  posterNiche() {
    const p = this.state.poster, n = PN.find((x) => x.id === p.niche) || PN[0];
    return n.id === 'custom' ? { ...n, name: p.custom.trim() || 'General feel-good posts', guide: p.custom.trim() ? `Posts about: ${p.custom.trim()}` : '' } : n;
  },
  posterTaken(except) {
    return [...this.takenTimes(), ...Object.values(this.state.poster.items).filter((x) => x.id !== except && x.slot).map((x) => x.slot)];
  },
  posterNextSlot(except) { return sched.nextSlots(1, this.posterTaken(except), Date.now(), this.state.settings.slotJitter !== false)[0]; },
  posterPublic() {
    const t = this.posterNextSlot();
    return { posterNiches: PN.map(({ id, name, blurb, web }) => ({ id, name, blurb, web: !!web })), posterSlot: t ? { ts: t, local: sched.fmtLocal(t), et: sched.fmtET(t) } : null };
  },
  posterSettings(patch) {
    const p = this.state.poster;
    if (patch.niche && PN.some((x) => x.id === patch.niche)) p.niche = patch.niche;
    if (typeof patch.custom === 'string') p.custom = patch.custom.slice(0, 200);
    if ('pick' in patch) p.pick = patch.pick;
    this.save();
  },

  // ---------- 1. five fresh ideas (Claude Opus) ----------
  posterIdeas() {
    return this.enqueue(async () => {
      const n = this.posterNiche(), p = this.state.poster;
      this.begin('Poster ideas', [{ label: `Claude Opus: 5 ${n.name} ideas${n.web ? ' (checking today\'s news)' : ''}`, w: 1 }]);
      this.step(0);
      try {
        const txt = await this.claude(PP.posterIdeasPrompt({ niche: n.name, guide: n.guide, style: n.style, text: n.text, web: !!n.web, history: p.history.slice(-30), angle: pick(ANGLES, 3).join(', '), memory: this.memoryList() }),
          { model: IDEA_MODEL, effort: 'medium', slim: { system: n.web ? SYS_WEB : SYS_TEXT, web: !!n.web }, onStatus: (m) => this.feed(m) });
        const arr = extractJson(txt);
        if (!Array.isArray(arr) || !arr.length) throw new Error('Claude returned no ideas.');
        const stamp = Date.now().toString(36);
        p.ideas = arr.slice(0, 5).map((x, i) => ({ id: `${stamp}${i}`, niche: n.id, nicheName: n.name, title: String(x.title || 'Idea ' + (i + 1)), angle: String(x.angle || ''), imagePrompt: String(x.imagePrompt || ''),
          realistic: !!x.realistic, text: clean(x.text, n.text), caption: String(x.caption || ''), comment: String(x.comment || ''), source: String(x.source || ''), why: String(x.why || '') }));
        p.pick = null;
        p.history = [...p.history, ...p.ideas.map((x) => `${x.title}: ${x.text.headline}`)].slice(-80);
        this.step(0, 'done'); this.finish('5 ideas ready. Pick the best one.');
      } catch (e) { this.step(0, 'error'); this.finish('Could not create ideas: ' + e.message.slice(0, 200)); }
      this.save();
    });
  },

  // ---------- 2. the picture in Google Flow ----------
  posterCreate(ideaId) {
    const p = this.state.poster, idea = p.ideas.find((x) => x.id === ideaId);
    if (!idea) throw new Error('Pick an idea first.');
    const id = `${new Date().toISOString().slice(0, 10)}-${idea.id}`;
    if (!p.items[id]) p.items[id] = { id, created: Date.now(), idea, title: idea.title, niche: idea.nicheName, text: { ...idea.text }, caption: idea.caption, comment: idea.comment, realistic: idea.realistic, variants: [], variant: null, status: 'queued', platforms: { facebook: true, instagram: false }, mode: 'schedule' };
    this.save();
    this.posterFlow(id);
    return id;
  },
  posterVariants(id) {
    const dir = path.join(this.ws, 'posters', id);
    try { return fs.readdirSync(dir).filter((f) => IMG_RE.test(f) && fs.statSync(path.join(dir, f)).size > 30000).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))); } catch { return []; }
  },
  posterFlow(id) {
    const it = this.state.poster.items[id]; if (!it) throw new Error('Poster not found.');
    it.status = 'generating'; it.error = ''; this.save();
    return this.enqueue(async () => {
      this.begin(`Poster picture: ${it.title}`, [{ label: 'Google Flow: making the picture', w: 4 }, { label: 'Ready to edit', w: 1 }]);
      this.step(0);
      const dir = path.join(this.ws, 'posters', id);
      fs.mkdirSync(dir, { recursive: true });
      const before = new Set(this.posterVariants(id));
      // A new run must not overwrite earlier pictures: move old ones aside under the next free numbers afterwards.
      const keep = [...before].map((f) => { const tmp = path.join(dir, '_old_' + f); fs.renameSync(path.join(dir, f), tmp); return tmp; });
      try {
        const style = (PN.find((x) => x.id === it.idea.niche) || PN[PN.length - 1]).style;
        const t0 = Date.now();
        let full = false;
        const r = await this.chromeRun((note) => { full = this.posterNeedsInstall('flow', note); return PP.posterFlowPrompt({ item: it, style, full }) + this.hintFor(it, 'produce') + note; },
          { attempts: 2, onStatus: this.creep(0), label: 'Google Flow', model: FLOW_MODEL, effort: 'low', maxTurns: 8, slim: { system: SYS_BROWSER, chromeTools: ['navigate', 'javascript_tool'] } });
        if (r.ok === false) throw new Error(r.detail || 'Google Flow could not start the picture.');
        if (full) this.posterInstalled('flow');
        this.feed('Saving the pictures from the Flow download…');
        await this.posterCollect(id, t0); // the app unzips the download itself (no Claude tokens)
        const fresh = this.posterVariants(id);
        if (!fresh.length) throw new Error('Google Flow finished but no picture was saved. ' + (r.detail || ''));
        it.aspect = r.aspect || it.aspect;
        this.step(0, 'done');
      } catch (e) {
        if (this.cancelled) it.error = 'Stopped by you.'; else { it.error = e.message.slice(0, 300); this.alert({ kind: 'poster', slug: id, title: `The poster picture for "${it.title}" failed`, detail: it.error }); }
        this.step(0, 'error');
      } finally {
        // renumber: new pictures first (v1..), earlier ones after them so nothing is lost
        const fresh = this.posterVariants(id);
        let n = fresh.length;
        for (const tmp of keep) { const ext = path.extname(tmp); fs.renameSync(tmp, path.join(dir, `v${++n}${ext}`)); }
        it.variants = this.posterVariants(id);
        if (fresh.length) it.variant = fresh[0]; else if (!it.variants.includes(it.variant)) it.variant = it.variants[0] || null;
        it.status = it.variants.length ? 'editing' : 'failed';
        if (it.status === 'editing') this.step(1, 'done');
        this.finish(it.status === 'editing' ? 'Picture ready. Edit the text, then approve.' : 'The picture could not be made.');
        this.save();
      }
    });
  },
  // Wait for Flow's "Download project" zip in Downloads, unzip it into its own new folder and keep the pictures as v1, v2...
  async posterCollect(id, t0) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let zip = null, last = -1;
    for (let i = 0; i < 180 && !this.cancelled; i++) { // up to 6 minutes: the page script waits for the pictures, then downloads
      const cand = fs.readdirSync(this.downloads).filter((f) => /\.zip$/i.test(f)).map((f) => path.join(this.downloads, f))
        .map((f) => ({ f, st: fs.statSync(f) })).filter((x) => x.st.mtimeMs >= t0 - 5000).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
      if (cand) { if (zip === cand.f && cand.st.size === last && last > 0) break; zip = cand.f; last = cand.st.size; }
      await sleep(2000);
    }
    if (!zip) throw new Error('The Flow download (zip) did not arrive in your Downloads folder.');
    const dir = path.join(this.ws, 'posters', id), tmp = path.join(dir, '_flow_' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SS_ZIP -DestinationPath $env:SS_OUT -Force'], { windowsHide: true, env: { ...process.env, SS_ZIP: zip, SS_OUT: tmp } }, (e) => (e ? rej(new Error('Could not unzip the Flow download: ' + e.message)) : res())));
    const found = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(png|jpe?g|webp)$/i.test(e.name) && fs.statSync(f).size > 30000) found.push(f); } };
    walk(tmp);
    found.sort().slice(0, 4).forEach((f, i) => fs.copyFileSync(f, path.join(dir, `v${i + 1}${path.extname(f).toLowerCase()}`)));
    fs.rmSync(tmp, { recursive: true, force: true });
    try { fs.unlinkSync(zip); } catch {}
    if (!found.length) throw new Error('The Flow download had no pictures in it.');
  },
  // Page scripts are stored in the site's localStorage after the first run; later runs send a one-line call.
  posterNeedsInstall(name, note) {
    const inst = this.state.poster.installed || {};
    if (/INSTALL_NEEDED|eval|Content Security/i.test(note || '')) { delete inst[name]; this.state.poster.installed = inst; } // stored copy missing or blocked: send it inline
    return inst[name] !== require('./posterScripts').LIBS[name].v;
  },
  // The Meta page library as a file next to the posters, so Claude can upload it instead of typing it.
  posterLibFile() {
    const { name, text } = require('./posterScripts').META_FILE();
    const d = path.join(this.ws, 'posters', '_lib'), f = path.join(d, name);
    if (!fs.existsSync(f)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, text); }
    return f;
  },
  posterInstalled(name) { this.state.poster.installed = { ...(this.state.poster.installed || {}), [name]: require('./posterScripts').LIBS[name].v }; this.save(); },
  posterImage(id, file) {
    if (!IMG_RE.test(file) && file !== 'final.jpg') throw new Error('Bad file');
    const f = path.join(this.ws, 'posters', id, file);
    const ext = path.extname(f).slice(1).toLowerCase();
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + fs.readFileSync(f).toString('base64');
  },

  // ---------- 3. edit ----------
  posterUpdate(id, patch) {
    const it = this.state.poster.items[id]; if (!it) throw new Error('Poster not found.');
    if (patch.text) it.text = clean({ ...it.text, ...patch.text }, it.text);
    for (const k of ['caption', 'comment']) if (typeof patch[k] === 'string') it[k] = patch[k].slice(0, 600);
    if ('realistic' in patch) it.realistic = !!patch.realistic;
    if (patch.variant && it.variants.includes(patch.variant)) it.variant = patch.variant;
    if (patch.platforms) it.platforms = { facebook: !!patch.platforms.facebook, instagram: !!patch.platforms.instagram };
    if (patch.mode === 'now' || patch.mode === 'schedule') it.mode = patch.mode;
    this.save();
  },
  posterRevise(id, note) {
    const it = this.state.poster.items[id]; if (!it) throw new Error('Poster not found.');
    return this.enqueue(async () => {
      this.begin('Editing the poster text', [{ label: 'Claude: rewriting the text', w: 1 }]);
      this.step(0);
      try {
        const j = extractJson(await this.claude(PP.posterRevisePrompt({ niche: it.niche, item: it, note, memory: this.memoryList() }), { model: EDIT_MODEL, effort: 'low', slim: { system: SYS_TEXT }, onStatus: (m) => this.feed(m) }));
        it.text = clean(j.text, it.text);
        if (j.caption) it.caption = String(j.caption); if (j.comment) it.comment = String(j.comment);
        this.step(0, 'done'); this.finish('Text updated.');
      } catch (e) { this.step(0, 'error'); this.finish('Could not edit the text: ' + e.message.slice(0, 200)); }
      this.save();
    });
  },
  // The finished design is drawn in the app (square picture + hook caption) and saved here as a JPEG well under the 10 MB upload limit.
  posterSave(id, dataUrl) {
    const it = this.state.poster.items[id]; if (!it) throw new Error('Poster not found.');
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('The design could not be exported.');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 9.5e6) throw new Error('The finished picture is too large to upload.');
    const f = path.join(this.ws, 'posters', id, 'final.jpg');
    fs.writeFileSync(f, buf);
    it.final = f; it.savedAt = Date.now(); this.save();
    return f;
  },

  // ---------- 4. post now or schedule ----------
  posterPublish(id) {
    const it = this.state.poster.items[id]; if (!it) throw new Error('Poster not found.');
    const pls = ['facebook', 'instagram'].filter((x) => it.platforms[x]);
    if (!pls.length) throw new Error('Choose Facebook, Instagram or both.');
    if (it.platforms.facebook && !this.state.settings.fbPage) throw new Error('Enter your Facebook Page name on the Setup tab first.');
    if (!it.final || !fs.existsSync(it.final)) throw new Error('Save the design first.');
    if (!it.caption.trim()) throw new Error('Write a caption first.');
    it.approved = Date.now();
    it.slot = it.mode === 'schedule' ? this.posterNextSlot(id) : null;
    it.upload = {};
    const p = this.state.poster;
    p.jobs = p.jobs.filter((j) => j.item !== id);
    if (it.mode === 'schedule') {
      // Token saver: the app itself posts at the US prime-time slot (a plain "publish now" run is far cheaper than
      // filling in Meta's scheduler, whose time boxes need a mouse/keyboard tool). The app and Chrome must be open then.
      pls.forEach((pl) => { this.posterQueue(id, pl, it.slot); });
      it.status = 'scheduled'; this.save();
    } else {
      pls.forEach((pl) => (it.upload[pl] = { status: 'queued' }));
      it.status = 'publishing'; this.save();
      this.posterPostMany(id, pls);
    }
    return it.slot;
  },
  posterQueue(id, pl, at) {
    const it = this.state.poster.items[id], p = this.state.poster;
    p.jobs = p.jobs.filter((j) => j.id !== `${id}:post:${pl}`);
    p.jobs.push({ id: `${id}:post:${pl}`, kind: 'post', platform: pl, item: id, runAt: at, status: 'waiting' });
    it.upload[pl] = { status: 'waiting', when: at, detail: 'The app posts it at this time (keep the app and Chrome open).' };
  },
  async posterPostOne(id, pl, stepIdx) {
    const it = this.state.poster.items[id];
    it.tried = it.tried || {}; const retry = !!it.tried[pl]; it.tried[pl] = true;
    it.upload[pl] = { status: 'running' }; this.save();
    try {
      const r = await this.chromeRun((note) => PP.posterPostPrompt({ platform: pl, item: it, file: it.final, fbPage: this.state.settings.fbPage, retry: retry || !!note, libFile: this.posterLibFile() }) + this.hintFor(it, pl) + note,
        { attempts: 2, onStatus: this.creep(stepIdx), label: `the ${pl} post`, model: POST_MODEL, effort: 'low', maxTurns: pl === 'facebook' ? 14 : 40,
          slim: { system: SYS_BROWSER, chromeTools: pl === 'facebook' ? T_POST : T_IG, read: true, dirs: [path.join(this.ws, 'posters'), path.join(this.ws, 'posters', '_lib'), path.dirname(it.final)] } });
      it.upload[pl] = { status: 'posted', when: Date.now(), detail: r.detail || '' };
      // the engagement comment needs a live post
      const at = Date.now() + (pl === 'facebook' ? 4 : 3) * 60000;
      this.state.poster.jobs = this.state.poster.jobs.filter((j) => j.id !== `${id}:c:${pl}`);
      if (it.comment.trim()) this.state.poster.jobs.push({ id: `${id}:c:${pl}`, kind: 'comment', platform: pl, item: id, runAt: at, status: 'waiting' });
      this.step(stepIdx, 'done');
    } catch (e) {
      it.upload[pl] = { status: this.cancelled ? 'stopped' : 'failed', detail: this.cancelled ? 'Stopped by you.' : e.message.slice(0, 300) };
      this.step(stepIdx, 'error');
      if (!this.cancelled) this.alert({ kind: 'poster', slug: id, platform: pl, title: `The ${pl} poster post failed`, detail: e.message.slice(0, 400) });
    }
    this.posterStatus(id); this.save();
  },
  posterPostMany(id, list) {
    const it = this.state.poster.items[id];
    return this.enqueue(async () => {
      this.begin(`Posting poster "${it.title}"`, list.map((pl) => ({ label: `${pl === 'facebook' ? 'Facebook Page' : 'Instagram'}: post`, w: 3 })));
      for (const [i, pl] of list.entries()) { // one after another, never at the same time
        this.step(i);
        await this.posterPostOne(id, pl, i);
        if (this.cancelled) break;
      }
      this.finish('Poster done.');
    });
  },
  posterStatus(id) {
    const it = this.state.poster.items[id]; const u = Object.values(it.upload || {});
    if (!u.length) return;
    it.status = u.some((x) => ['failed', 'stopped'].includes(x.status)) ? 'attention' : u.every((x) => x.status === 'posted') ? 'posted' : u.some((x) => ['queued', 'running'].includes(x.status)) ? 'publishing' : 'scheduled';
  },
  posterRetry(id, pl) {
    const it = this.state.poster.items[id]; if (!it || !it.upload || !it.upload[pl]) return;
    if (it.mode === 'schedule' && it.slot > Date.now() + 60000) { this.posterQueue(id, pl, it.slot); this.posterStatus(id); this.save(); return; } // still before its time
    it.upload[pl] = { status: 'queued' }; this.posterStatus(id); this.save();
    this.posterPostMany(id, [pl]);
  },
  posterDiscard(id) {
    const it = this.state.poster.items[id]; if (!it) return;
    if (it.upload && Object.values(it.upload).some((u) => u.status === 'running')) throw new Error('This poster is being posted right now.');
    this.state.poster.jobs = this.state.poster.jobs.filter((j) => j.item !== id);
    delete this.state.poster.items[id];
    fs.rmSync(path.join(this.ws, 'posters', id), { recursive: true, force: true });
    this.save();
  },

  // Timed tasks: Instagram at the scheduled time, and the engagement comment a few minutes after each post goes live.
  posterTick() {
    const now = Date.now(), p = this.state.poster; if (!p) return;
    for (const j of p.jobs.filter((x) => x.status === 'waiting' && x.runAt <= now)) {
      const it = p.items[j.item]; if (!it) { j.status = 'done'; continue; }
      j.status = 'running'; this.save();
      this.enqueue(async () => {
        this.begin(j.kind === 'post' ? `Posting poster to ${j.platform}: ${it.title}` : `Adding a comment on ${j.platform}`, [{ label: j.kind === 'post' ? `${j.platform} post` : `${j.platform} comment`, w: 1 }]);
        this.step(0);
        if (j.kind === 'post') {
          await this.posterPostOne(j.item, j.platform, 0);
          j.status = it.upload[j.platform].status === 'posted' ? 'done' : 'failed'; j.detail = it.upload[j.platform].detail;
        } else {
          try {
            const r = await this.chromeRun((note) => PP.posterCommentPrompt({ platform: j.platform, item: it, fbPage: this.state.settings.fbPage }) + note, { attempts: 2, onStatus: this.creep(0), label: 'the comment', model: POST_MODEL, effort: 'low', maxTurns: 30, slim: { system: SYS_BROWSER, chromeTools: T_COMMENT } });
            j.status = 'done'; j.detail = r.detail; this.step(0, 'done');
          } catch (e) { j.status = 'failed'; j.detail = this.cancelled ? 'Stopped by you.' : e.message.slice(0, 300); this.step(0, 'error'); }
        }
        this.finish(); this.save();
      });
    }
  },
  posterRetryJob(id) { const j = this.state.poster.jobs.find((x) => x.id === id); if (j) { j.status = 'waiting'; j.runAt = Date.now(); this.save(); this.posterTick(); } },
};
