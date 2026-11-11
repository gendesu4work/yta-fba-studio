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

const W = 1080, H = 1920, FPS = 30, MUSIC_VOL = 0.12;
const IMG = ['.png', '.jpg', '.jpeg', '.webp'];

function motion(kind, frames) {
  const centre = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  if (kind === 'zoom_out') return `z='max(1.25-0.25*on/${frames},1)':${centre}`;
  if (kind === 'pan_right') return `z='1.2':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`;
  if (kind === 'pan_left') return `z='1.2':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
  return `z='min(1+0.25*on/${frames},1.25)':${centre}`;
}

// Word-by-word captions; timings are spread over the voice length, weighted by word length and pauses.
function buildCaptions(voiceover, total) {
  const text = voiceover.replace(/\[[^\]]*\]/g, ' ');
  const words = text.match(/[A-Za-z0-9'’$%]+[.,!?;:]?/g) || [];
  const weights = words.map((w) => w.replace(/[^A-Za-z0-9]/g, '').length + 2 + (/[.!?]$/.test(w) ? 5 : /[,;:]$/.test(w) ? 2.5 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const emph = new Set(['stop', 'now', 'go', 'truth', 'free', 'never', 'today', 'secret']);
  const ts = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  let t = 0.2;
  const usable = Math.max(total - 0.4, 1);
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Word,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,7,2,5,40,40,40,1',
    '', '[Events]', 'Format: Layer,Start,End,Name,Style,MarginL,MarginR,MarginV,Effect,Text',
  ];
  words.forEach((w, i) => {
    const dur = (weights[i] / sum) * usable;
    const clean = w.replace(/[^A-Za-z0-9'’$%]/g, '');
    const color = emph.has(clean.toLowerCase()) ? '&H4AC9FF&' : '&HFFFFFF&';
    const txt = `{\\pos(${W / 2},1180)\\c${color}\\fscx72\\fscy72\\t(0,100,\\fscx100\\fscy100)}${clean.toUpperCase()}`;
    lines.push(`Dialogue: 0,${ts(t)},${ts(t + dur)},,Word,0,0,0,,${txt}`);
    t += dur;
  });
  return lines.join('\n') + '\n';
}

/**
 * @param {string} ws workspace dir  @param {object} post post json  @param {string|null} musicFile
 */
async function assemble(ws, post, musicFile, onStatus = () => {}) {
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

  onStatus('Building captions');
  fs.writeFileSync(path.join(out, 'captions.ass'), buildCaptions(post.voiceover, dur), 'utf8');

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
  parts.push('[v]ass=captions.ass:fontsdir=C\\\\:/Windows/Fonts[vc]');
  if (musicFile) parts.push(`[${vi}:a]loudnorm=I=-14:TP=-1.5:LRA=7[vo];[${mi}:a]volume=${MUSIC_VOL},afade=t=out:st=${(dur - 1.5).toFixed(2)}:d=1.5[m];[vo][m]amix=inputs=2:duration=first:normalize=0[a]`);
  else parts.push(`[${vi}:a]loudnorm=I=-14:TP=-1.5:LRA=7[a]`);
  const final = path.join(out, `${post.slug}.mp4`);
  args.push('-filter_complex', parts.join(';'), '-map', '[vc]', '-map', '[a]', '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', final);
  onStatus('Rendering the final video');
  await exec(FFMPEG, args, out);

  // Upload copy under ~9.3 MB: Claude in Chrome's file upload tool caps files at 10 MB.
  const upload = path.join(out, `${post.slug}-upload.mp4`);
  if (fs.statSync(final).size <= 9_300_000) fs.copyFileSync(final, upload);
  else {
    const vk = Math.floor((9_300_000 * 8 / 1000) / dur - 128);
    onStatus('Compressing for upload');
    await exec(FFMPEG, ['-y', '-v', 'error', '-i', final, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${vk}k`, '-maxrate', `${Math.floor(vk * 1.4)}k`, '-bufsize', `${vk * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', upload], out);
  }
  return { final, upload, seconds: dur };
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

module.exports = { assemble, sampleVideo, FFMPEG, FFPROBE };
