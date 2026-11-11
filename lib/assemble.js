// Node port of the original assemble.py using the ffmpeg bundled with the app (no Python needed).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const unpack = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpack(require('ffmpeg-static'));
const FFPROBE = unpack(require('ffprobe-static').path);

function exec(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { cwd, windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg failed: ${err.slice(-500)}`))));
  });
}

function execErr(bin, args) {
  return new Promise((resolve) => {
    const c = spawn(bin, args, { windowsHide: true });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('error', () => resolve(''));
    c.on('close', () => resolve(err));
  });
}
const probeDur = async (f, sel) => parseFloat((await exec(FFPROBE, ['-v', 'error', ...(sel ? ['-select_streams', sel] : []), '-show_entries', sel ? 'stream=duration' : 'format=duration', '-of', 'csv=p=0', f])).trim()) || 0;

const W = 1080, H = 1920, FPS = 30, MUSIC_VOL = 0.12;
const IMG = ['.png', '.jpg', '.jpeg', '.webp'];
const CAP = require('./captions');

function motion(kind, frames) {
  const centre = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  if (kind === 'zoom_out') return `z='max(1.25-0.25*on/${frames},1)':${centre}`;
  if (kind === 'pan_right') return `z='1.2':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`;
  if (kind === 'pan_left') return `z='1.2':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
  return `z='min(1+0.25*on/${frames},1.25)':${centre}`;
}

// Word-by-word captions timed from the real pauses in the voiceover (see captions.js).
const ASS_HEAD = [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
  '[V4+ Styles]',
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
  'Style: Word,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,7,2,5,40,40,40,1',
  '', '[Events]', 'Format: Layer,Start,End,Name,Style,MarginL,MarginR,MarginV,Effect,Text',
];
function buildCaptions(words, total) {
  const emph = new Set(['stop', 'now', 'go', 'truth', 'free', 'never', 'today', 'secret']);
  const ts = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const lines = [...ASS_HEAD];
  words.forEach((w, i) => {
    const nxt = i + 1 < words.length ? words[i + 1].start : total;
    // hold a word until the next one starts, but never across a real pause longer than 0.35 s
    const end = Math.max(w.start + 0.12, nxt - w.end > 0.35 ? Math.min(nxt, w.end + 0.35) : nxt);
    const color = emph.has(w.word.toLowerCase()) ? '&H4AC9FF&' : '&HFFFFFF&';
    lines.push(`Dialogue: 0,${ts(w.start)},${ts(end)},,Word,0,0,0,,{\\pos(${W / 2},1180)\\c${color}\\fscx72\\fscy72\\t(0,100,\\fscx100\\fscy100)}${w.word.toUpperCase()}`);
  });
  return lines.join('\n') + '\n';
}
async function alignVoice(voice, voiceover) {
  const { silences, duration } = await CAP.detectSilences(FFMPEG, voice);
  return { words: CAP.align(voiceover, silences, duration), duration };
}

// Voice level: measure once, apply a plain gain (no dynamic processing that can eat the ending).
async function voiceGainDb(voice) {
  const err = await execErr(FFMPEG, ['-hide_banner', '-i', voice, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json', '-f', 'null', '-']);
  const m = err.match(/\{[\s\S]*"input_i"[\s\S]*?\}/);
  if (!m) return 0;
  try {
    const j = JSON.parse(m[0]);
    const gain = -14 - parseFloat(j.input_i);
    const headroom = -1.5 - parseFloat(j.input_tp);
    return Math.max(-12, Math.min(gain, headroom, 12));
  } catch { return 0; }
}

/**
 * @param {string} ws workspace dir  @param {object} post post json  @param {string|null} musicFile
 */
async function assemble(ws, post, musicFile, onStatus = () => {}, tag = '') {
  const out = path.join(ws, 'output', post.slug);
  const cdir = path.join(ws, 'clips', post.slug);
  const voice = path.join(out, 'voice.mp3');
  if (!fs.existsSync(voice)) throw new Error('Voiceover file is missing.');
  const scenes = post.scenes.map((s) => (typeof s === 'string' ? { prompt: s } : s));
  let clips = scenes.map((_, i) => {
    const n = String(i + 1).padStart(2, '0');
    for (const e of ['mp4', 'png', 'jpg', 'jpeg', 'webp']) { const p = path.join(cdir, `${n}.${e}`); if (fs.existsSync(p)) return p; }
    return null;
  });
  const have = clips.filter(Boolean);
  if (!have.length) throw new Error('No generated visuals were found.');
  // If some scenes are missing, use what exists (equal share) rather than failing the whole video.
  const used = clips.map((c, i) => ({ c, s: scenes[i] })).filter((x) => x.c);
  const dur = parseFloat((await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voice])).trim()) + 0.5;
  const weights = used.map((x) => x.s.seconds || 8);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const segs = weights.map((w) => (dur * w) / wsum);

  onStatus('Timing the captions to the voice');
  const aligned = await alignVoice(voice, post.voiceover);
  const capName = `captions${tag}.ass`;
  fs.writeFileSync(path.join(out, capName), buildCaptions(aligned.words, dur), 'utf8');
  const gain = await voiceGainDb(voice);

  const args = ['-y'];
  used.forEach((x) => args.push('-i', x.c));
  args.push('-i', voice);
  const vi = used.length, mi = used.length + 1;
  if (musicFile) args.push('-stream_loop', '-1', '-i', musicFile);
  const parts = used.map((x, i) => {
    const seg = segs[i];
    if (IMG.includes(path.extname(x.c).toLowerCase())) {
      const frames = Math.max(Math.floor(seg * FPS), 1);
      return `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=${motion(x.s.motion, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},trim=0:${seg.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[v${i}]`;
    }
    return `[${i}:v]tpad=stop_mode=clone:stop_duration=30,trim=0:${seg.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1[v${i}]`;
  });
  parts.push(used.map((_, i) => `[v${i}]`).join('') + `concat=n=${used.length}:v=1:a=0[v]`);
  parts.push(`[v]ass=${capName}:fontsdir=C\\\\:/Windows/Fonts[vc]`);
  // voice: fixed gain, limiter, padded with silence to the full video length so the last words are never cut
  const voiceChain = `[${vi}:a]volume=${gain.toFixed(2)}dB,alimiter=limit=0.89,apad=whole_dur=${dur.toFixed(2)}`;
  if (musicFile) parts.push(`${voiceChain}[vo];[${mi}:a]volume=${MUSIC_VOL},afade=t=out:st=${(dur - 1.5).toFixed(2)}:d=1.5[m];[vo][m]amix=inputs=2:duration=first:normalize=0[a]`);
  else parts.push(`${voiceChain}[a]`);
  const final = path.join(out, `${post.slug}${tag}.mp4`);
  args.push('-filter_complex', parts.join(';'), '-map', '[vc]', '-map', '[a]', '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', final);
  onStatus('Rendering the final video');
  await exec(FFMPEG, args, out);

  // Upload copy under ~9.3 MB: Claude in Chrome's file upload tool caps files at 10 MB.
  const upload = path.join(out, `${post.slug}${tag}-upload.mp4`);
  if (fs.statSync(final).size <= 9_300_000) fs.copyFileSync(final, upload);
  else {
    const vk = Math.floor((9_300_000 * 8 / 1000) / dur - 128);
    onStatus('Compressing for upload');
    await exec(FFMPEG, ['-y', '-v', 'error', '-i', final, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${vk}k`, '-maxrate', `${Math.floor(vk * 1.4)}k`, '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', upload], out);
  }
  return { final, upload, seconds: dur };
}

// Automatic QA of a finished video: audio length, fading ending, caption sync, missing scenes.
async function reviewVideo(ws, post, files, tag = '') {
  const out = path.join(ws, 'output', post.slug);
  const voice = path.join(out, 'voice.mp3');
  const issues = [], info = {};
  const vDur = await probeDur(voice);
  const fVideo = await probeDur(files.final, 'v:0'), fAudio = await probeDur(files.final, 'a:0');
  info.voiceSeconds = +vDur.toFixed(1); info.videoSeconds = +fVideo.toFixed(1); info.audioSeconds = +fAudio.toFixed(1);
  if (fAudio < vDur - 0.3) issues.push({ code: 'audio-cut', text: `The audio ends ${(vDur - fAudio).toFixed(1)}s early, so the last words of the voiceover are cut off.` });
  if (fVideo < vDur - 0.3) issues.push({ code: 'video-short', text: `The picture ends ${(vDur - fVideo).toFixed(1)}s before the voice does.` });
  // loudness of the voice's final seconds, final video vs. original voice
  const win = Math.max(vDur - 2.5, 0);
  const lvl = async (f) => { const e = await execErr(FFMPEG, ['-ss', win.toFixed(2), '-t', '2', '-i', f, '-vn', '-af', 'volumedetect', '-f', 'null', '-']); const m = e.match(/mean_volume:\s*(-?[\d.]+)/); return m ? parseFloat(m[1]) : null; };
  const [lv, lo] = [await lvl(files.final), await lvl(voice)];
  if (lv !== null && lo !== null) { info.endLevelDb = +(lv - lo).toFixed(1); if (lv - lo < -7) issues.push({ code: 'fade', text: `The voice is ${Math.abs(lv - lo).toFixed(0)} dB quieter at the end than in the original recording (it fades out).` }); }
  // caption sync: compare the captions burned into this video with a fresh alignment
  try {
    const ass = fs.readFileSync(path.join(out, `captions${tag}.ass`), 'utf8');
    const starts = [...ass.matchAll(/Dialogue: 0,(\d+):(\d+):([\d.]+)/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]);
    const fresh = (await alignVoice(voice, post.voiceover)).words;
    const n = Math.min(starts.length, fresh.length);
    if (n) {
      const d = Array.from({ length: n }, (_, i) => Math.abs(starts[i] - fresh[i].start));
      const mean = d.reduce((a, b) => a + b, 0) / n, max = Math.max(...d);
      info.captionMeanOff = +mean.toFixed(2); info.captionMaxOff = +max.toFixed(2);
      if (mean > 0.3 || max > 1.0) issues.push({ code: 'captions', text: `Captions are out of sync with the voice (about ${mean.toFixed(1)}s late/early on average, up to ${max.toFixed(1)}s).` });
    }
  } catch { issues.push({ code: 'captions-missing', text: 'No caption timing file was found for this video.' }); }
  const missing = post.scenes.map((_, i) => String(i + 1).padStart(2, '0')).filter((n) => !['mp4', 'png', 'jpg', 'jpeg', 'webp'].some((e) => fs.existsSync(path.join(ws, 'clips', post.slug, `${n}.${e}`))));
  if (missing.length) issues.push({ code: 'scenes', text: `${missing.length} scene(s) have no generated visual (${missing.join(', ')}).` });
  return { ok: !issues.length, issues, info, checkedAt: Date.now() };
}

// Pull evenly spaced frames from a reference video and count scene cuts (pacing).
async function sampleVideo(file, outDir, frames = 8) {
  fs.mkdirSync(outDir, { recursive: true });
  const dur = parseFloat((await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim()) || 1;
  const dim = (await exec(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])).trim();
  await exec(FFMPEG, ['-y', '-v', 'error', '-i', file, '-vf', `fps=${frames}/${dur.toFixed(3)},scale=540:-2`, '-frames:v', String(frames), path.join(outDir, 'f%02d.jpg')]);
  const cuts = await new Promise((resolve) => {
    const c = spawn(FFMPEG, ['-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], { windowsHide: true });
    let err = ''; c.stderr.on('data', (d) => (err += d)); c.on('close', () => resolve((err.match(/pts_time:/g) || []).length)); c.on('error', () => resolve(0));
  });
  return { duration: dur, size: dim, cuts, frames: fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg')).map((f) => path.join(outDir, f)) };
}

module.exports = { assemble, reviewVideo, sampleVideo, FFMPEG, FFPROBE };
