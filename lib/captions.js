// Word timing for captions without any speech-recognition model: the real pauses in the
// voiceover (ffmpeg silencedetect) are matched to the script's punctuation / [pause] tags, then
// words are spread over the actual speech time between those anchors by syllable weight.
const { spawn } = require('child_process');

function detectSilences(ffmpeg, file, noise = '-35dB', minDur = 0.12) {
  return new Promise((resolve, reject) => {
    const c = spawn(ffmpeg, ['-i', file, '-af', `silencedetect=noise=${noise}:d=${minDur}`, '-f', 'null', '-'], { windowsHide: true });
    let err = '';
    c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', () => {
      const total = (err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) || []).slice(1).map(Number);
      const dur = total.length ? total[0] * 3600 + total[1] * 60 + total[2] : 0;
      const sil = []; let start = null;
      for (const m of err.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
        if (m[1] === 'start') start = Math.max(0, +m[2]);
        else if (start !== null) { sil.push([start, +m[2]]); start = null; }
      }
      if (start !== null) sil.push([start, dur]);
      resolve({ silences: sil, duration: dur });
    });
  });
}

const BREAK_BEFORE = new Set(['that', 'and', 'but', 'so', 'then', 'because', 'when', 'while', 'which', 'who', 'or', 'until', 'after', 'before', 'if', 'where', 'now', 'instead']);
const syl = (w) => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) || []).length) + w.replace(/[^A-Za-z0-9]/g, '').length * 0.12;

// tokens: [{word, boundary: 0|1|2}] boundary after the word: 1 = comma-ish, 2 = sentence end or [pause]
function tokenize(voiceover) {
  const toks = [];
  const re = /\[[^\]]*\]|[A-Za-z0-9$%'’]+[.,!?;:…—-]*/g;
  let m;
  while ((m = re.exec(voiceover))) {
    const s = m[0];
    if (s[0] === '[') { if (toks.length) toks[toks.length - 1].boundary = Math.max(toks[toks.length - 1].boundary, /pause|beat|silence/i.test(s) ? 2 : 1); continue; }
    const clean = s.replace(/[^A-Za-z0-9$%'’]/g, '');
    if (!clean) continue;
    toks.push({ word: clean, boundary: /[.!?…]$/.test(s) ? 2 : /[,;:—-]$/.test(s) ? 1 : 0, w: syl(clean) });
  }
  return toks;
}

/**
 * @returns {{word:string,start:number,end:number}[]}
 */
function align(voiceover, silences, total) {
  const toks = tokenize(voiceover);
  if (!toks.length) return [];
  let t0 = 0, t1 = total;
  const sil = silences.filter(([a, b]) => b - a >= 0.12).map((x) => x.slice());
  if (sil.length && sil[0][0] <= 0.05) t0 = sil.shift()[1];
  if (sil.length && sil[sil.length - 1][1] >= total - 0.05) t1 = sil.pop()[0];
  const m = sil.length;
  // cum[k] = speech time elapsed when silence k starts (cum[m] = total speech)
  const cum = []; let acc = 0, prev = t0;
  sil.forEach(([s, e]) => { acc += s - prev; cum.push(acc); prev = e; });
  acc += t1 - prev; cum.push(acc);
  const speechTotal = acc;
  const pos = (k) => (k < 0 ? 0 : k >= m ? speechTotal : cum[k]);
  const dur = (k) => sil[k][1] - sil[k][0];

  const W = toks.reduce((a, t) => a + t.w, 0), rate = speechTotal / W;
  const groups = []; let cur = [];
  toks.forEach((t, i) => { cur.push(i); if (t.boundary && i < toks.length - 1) { groups.push({ idx: cur, strength: t.boundary }); cur = []; } });
  groups.push({ idx: cur, strength: 2 });
  const G = groups.length;
  const gw = groups.map((g) => g.idx.reduce((a, i) => a + toks[i].w, 0));
  const pre = [0]; gw.forEach((w) => pre.push(pre[pre.length - 1] + w)); // pre[g] = weight of groups < g

  // DP over (last anchored boundary b, its silence k); b=-1,k=-1 is the start, b=G-1,k=m the end.
  const INF = 1e18, LAM = 7;
  const idx = (b, k) => (b + 1) * (m + 2) + (k + 1);
  const cost = new Map(), from = new Map();
  cost.set(idx(-1, -1), 0);
  for (let b0 = -1; b0 < G - 1; b0++) {
    for (let k0 = -1; k0 <= m - 1; k0++) {
      const c0 = cost.get(idx(b0, k0)); if (c0 === undefined) continue;
      for (let b = b0 + 1; b <= G - 1; b++) {
        const last = b === G - 1;
        const w = pre[b + 1] - pre[b0 + 1];
        const kEnd = last ? [m] : []; if (!last) for (let k = k0 + 1; k < m; k++) kEnd.push(k);
        for (const k of kEnd) {
          const tg = pos(k) - pos(k0), ex = w * rate;
          let c = c0 + ((tg - ex) * (tg - ex)) / (ex + 0.3);
          for (let q = b0 + 1; q < b; q++) c += groups[q].strength === 2 ? 2 : 0.2;           // skipped boundaries
          for (let q = k0 + 1; q < Math.min(k, m); q++) c += dur(q) > 0.35 ? 1.2 : 0.15;        // unused silences
          if (!last) c -= LAM * Math.min(dur(k), 0.7) * (groups[b].strength === 2 ? 1 : 0.5);   // reward real pauses
          const id = idx(b, k);
          if (c < (cost.get(id) ?? INF)) { cost.set(id, c); from.set(id, [b0, k0]); }
        }
      }
    }
  }
  const anchors = []; // [boundaryIndex, silenceIndex]
  let cb = G - 1, ck = m;
  while (!(cb === -1 && ck === -1)) { const f = from.get(idx(cb, ck)); if (!f) break; if (cb < G - 1) anchors.unshift([cb, ck]); [cb, ck] = f; }

  if (process.env.DEBUG_ALIGN) console.log('anchors', anchors.map(([b,k])=>b+'->'+sil[k][0].toFixed(1)).join(' '), 'groups', G, 'sil', m);
  const toReal = (sp, isStart = false) => { // word starts that land exactly on a pause belong after it
    let rem = sp;
    for (let k = 0; k <= m; k++) {
      const s = k === 0 ? t0 : sil[k - 1][1], e = k < m ? sil[k][0] : t1;
      if ((isStart ? rem < e - s - 1e-9 : rem <= e - s) || k === m) return s + Math.min(rem, e - s);
      rem -= e - s;
    }
    return t1;
  };
  const words = new Array(toks.length);
  let gStart = 0, spStart = 0;
  const windows = anchors.map(([b, k]) => ({ gEnd: b, spEnd: pos(k) }));
  windows.push({ gEnd: G - 1, spEnd: speechTotal });
  for (const win of windows) {
    const ids = []; for (let g = gStart; g <= win.gEnd; g++) ids.push(...groups[g].idx);
    // inner pauses (not chosen as phrase anchors) still sit between two words: snap each to the nearest word gap
    const cuts = []; // [word-count-before, speech position]
    const wsumAll = ids.reduce((a, i) => a + toks[i].w, 0) || 1;
    for (let k = 0; k < m; k++) {
      const pk = pos(k);
      if (pk <= spStart + 0.15 || pk >= win.spEnd - 0.15 || dur(k) < 0.22) continue;
      const target = ((pk - spStart) / (win.spEnd - spStart || 1)) * wsumAll;
      let acc2 = 0, bestN = -1, bestD = 1e9;
      for (let n = 1; n < ids.length; n++) {
        acc2 += toks[ids[n - 1]].w;
        const d = Math.abs(acc2 - target) - (toks[ids[n - 1]].boundary ? 0.8 : 0) - (BREAK_BEFORE.has(toks[ids[n]].word.toLowerCase()) ? 2.2 : 0);
        if (d < bestD) { bestD = d; bestN = n; }
      }
      if (bestN > 0 && !cuts.some((c) => c[0] === bestN)) cuts.push([bestN, pk]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const parts = []; let from0 = 0, sp0 = spStart;
    for (const [n, pk] of cuts) { if (n <= from0 || pk <= sp0) continue; parts.push([ids.slice(from0, n), sp0, pk]); from0 = n; sp0 = pk; }
    parts.push([ids.slice(from0), sp0, win.spEnd]);
    for (const [pids, a0, a1] of parts) {
      const wsum = pids.reduce((a, i) => a + toks[i].w, 0) || 1;
      let p = a0;
      for (const i of pids) { const d = ((a1 - a0) * toks[i].w) / wsum; words[i] = { word: toks[i].word, start: toReal(p, true), end: toReal(p + d) }; p += d; }
    }
    gStart = win.gEnd + 1; spStart = win.spEnd;
  }
  return words;
}

module.exports = { detectSilences, align, tokenize };
