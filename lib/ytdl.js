// Link downloads with the open-source yt-dlp (fetched once from its official GitHub release and checked
// against the published SHA-256) plus the ffmpeg that ships with the app:
//   - downloadMp3:   YouTube link -> MP3 for the Music tab
//   - downloadVideo: YouTube / TikTok / Instagram / Facebook link -> MP4 for the Builder tab (analysis only)
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const URL_OK = /^https:\/\/((www|m|music)\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)[^\s]+$/i;
// YouTube, TikTok (incl. short links), Instagram posts/reels/tv, Facebook videos/reels/watch/share/fb.watch
const VIDEO_OK = /^https:\/\/((www|m|music|web|vm|vt|mbasic)\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/|tiktok\.com\/|instagram\.com\/(reel|reels|p|tv)\/|facebook\.com\/|fb\.watch\/|fb\.com\/)[^\s]*$/i;

const toolDir = (ws) => path.join(ws, 'tools');
const toolPath = (ws) => path.join(toolDir(ws), 'yt-dlp.exe');

async function fetchBuf(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}) from ${new URL(url).host}`);
  return Buffer.from(await r.arrayBuffer());
}

// One-time setup: download yt-dlp.exe and verify it against the SHA2-256SUMS file published in the same release.
async function ensureTool(ws, onStatus = () => {}) {
  const exe = toolPath(ws);
  if (fs.existsSync(exe) && fs.statSync(exe).size > 5e6) return exe;
  fs.mkdirSync(toolDir(ws), { recursive: true });
  onStatus('Downloading yt-dlp (one time, about 18 MB) from its official GitHub release');
  const [bin, sums] = await Promise.all([fetchBuf(BASE + 'yt-dlp.exe'), fetchBuf(BASE + 'SHA2-256SUMS')]);
  const want = (sums.toString('utf8').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find((p) => p[1] && p[1].replace(/^\*/, '') === 'yt-dlp.exe') || [])[0];
  const got = crypto.createHash('sha256').update(bin).digest('hex');
  if (!want || want.toLowerCase() !== got) throw new Error('The downloaded yt-dlp did not match its published checksum, so it was discarded.');
  const tmp = exe + '.part';
  fs.writeFileSync(tmp, bin); fs.renameSync(tmp, exe);
  return exe;
}

function newestFile(dir, re, sinceMs) {
  try {
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= sinceMs).sort((a, b) => b.t - a.t).map((x) => x.f)[0] || '';
  } catch { return ''; }
}

function friendly(err, code) {
  if (/private|sign in|log ?in|login|members|age|unavailable|copyright|blocked|cookies|not available|restricted/i.test(err)) return 'That video is private, needs a login, or is restricted, so it can not be downloaded. Save it yourself and use "Add video files" instead.';
  if (/Unsupported URL/i.test(err)) return 'That link is not a video page. Paste the link of the video itself.';
  return (err.trim().split('\n').pop() || `yt-dlp stopped (code ${code})`).slice(0, 220);
}

function runYtdlp(ws, args, onStatus, handle, pick) {
  return new Promise((resolve, reject) => {
    const c = spawn(toolPath(ws), args, { cwd: ws, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    if (handle) handle.kill = () => { try { c.kill(); } catch {} };
    let out = '', err = '', lastPct = -10;
    c.stdout.on('data', (d) => {
      for (const line of d.toString('utf8').split(/\r?\n/)) {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) { const p = Math.floor(+m[1]); if (p - lastPct >= 10) { lastPct = p; onStatus(`Downloading… ${p}%`); } }
        else if (/\[(ExtractAudio|Merger|VideoConvertor)\]/.test(line)) onStatus('Converting');
        else if (pick(line)) out = line.trim();
      }
    });
    c.stderr.on('data', (d) => { err += d.toString('utf8'); });
    c.on('error', reject);
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

/** YouTube link -> MP3 inside <ws>/music. @returns {{file:string,title:string}} */
async function downloadMp3(ws, url, ffmpegPath, onStatus = () => {}, handle) {
  url = String(url || '').trim();
  if (!URL_OK.test(url)) throw new Error('Paste a full YouTube link (youtube.com/watch…, youtu.be/… or a Shorts link).');
  await ensureTool(ws, onStatus);
  const outDir = path.join(ws, 'music'); fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now() - 5000;
  const args = ['--no-playlist', '--no-warnings', '--windows-filenames', '--newline', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--ffmpeg-location', ffmpegPath, '-o', path.join(outDir, '%(title).90s.%(ext)s'), '--print', 'after_move:filepath', url];
  const r = await runYtdlp(ws, args, onStatus, handle, (l) => /\.mp3$/i.test(l.trim()));
  let file = r.out && fs.existsSync(r.out) ? r.out : (r.code === 0 ? newestFile(outDir, /\.mp3$/i, t0) : '');
  if (r.code !== 0 || !file) throw new Error(friendly(r.err, r.code));
  return { file: path.basename(file), title: path.basename(file).replace(/\.mp3$/i, '') };
}

/** YouTube / TikTok / Instagram / Facebook link -> MP4 in outDir (used only to study the video's technique). */
async function downloadVideo(ws, url, ffmpegPath, outDir, onStatus = () => {}, handle) {
  url = String(url || '').trim();
  if (!VIDEO_OK.test(url)) throw new Error('Paste the full link of a YouTube, TikTok, Instagram or Facebook video.');
  await ensureTool(ws, onStatus);
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now() - 5000;
  const args = ['--no-playlist', '--no-warnings', '--windows-filenames', '--newline', '--max-filesize', '300M',
    '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', ffmpegPath,
    '-o', path.join(outDir, 'source.%(ext)s'), '--print', 'after_move:%(title).80s|||%(filepath)s', url];
  const r = await runYtdlp(ws, args, onStatus, handle, (l) => l.includes('|||'));
  let title = '', file = '';
  if (r.out) { const [t, f] = r.out.split('|||'); title = (t || '').trim(); file = (f || '').trim(); }
  if (!file || !fs.existsSync(file)) file = r.code === 0 ? newestFile(outDir, /\.(mp4|mkv|webm|mov)$/i, t0) : '';
  if (r.code !== 0 || !file) throw new Error(friendly(r.err, r.code));
  return { file, title: title && title !== 'NA' ? title : '' };
}

module.exports = { downloadMp3, downloadVideo, ensureTool, URL_OK, VIDEO_OK, toolPath };
