// Runs the user's own Claude Code CLI (their Claude account) headlessly and turns its event stream
// into short human-readable status lines for the progress meter.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findClaude() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  try {
    const out = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (out) return out;
  } catch {}
  return null;
}

// Every Claude in Chrome tool; slim runs disable all but the few a task needs.
const CHROME_TOOLS = ['browser_batch', 'computer', 'file_upload', 'find', 'form_input', 'get_page_text', 'gif_creator', 'javascript_tool', 'list_connected_browsers',
  'navigate', 'read_console_messages', 'read_network_requests', 'read_page', 'resize_window', 'select_browser', 'shortcuts_execute', 'shortcuts_list', 'switch_browser',
  'tabs_close_mcp', 'tabs_context_mcp', 'tabs_create_mcp', 'update_plan', 'upload_image'];

function describeTool(name, input = {}) {
  const n = name.replace(/^mcp__claude-in-chrome__/, '');
  const t = (s) => (s ? String(s).slice(0, 70) : '');
  switch (n) {
    case 'navigate': return `Opening ${t(input.url)}`;
    case 'computer': return `Browser: ${input.action || 'working'}${input.text ? ' "' + t(input.text) + '"' : ''}`;
    case 'read_page': case 'get_page_text': return 'Reading the page';
    case 'find': return `Looking for "${t(input.query)}"`;
    case 'form_input': return 'Filling in a field';
    case 'file_upload': return 'Uploading the video file';
    case 'javascript_tool': return 'Running a page helper';
    case 'tabs_context_mcp': case 'tabs_create_mcp': return 'Managing browser tabs';
    case 'Bash': return `Running: ${t(input.description || input.command)}`;
    case 'Write': case 'Edit': return `Saving ${path.basename(input.file_path || 'file')}`;
    case 'Read': return `Reading ${path.basename(input.file_path || 'file')}`;
    default: return `Using ${n}`;
  }
}

/**
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.cwd
 * @param {boolean} [o.chrome]   attach Claude in Chrome
 * @param {boolean} [o.tools]    allow file/shell tools (and Chrome tools if chrome)
 * @param {(s:string)=>void} [o.onStatus]
 * @param {{kill:()=>void}} [o.handle]  receives {kill} so the UI can cancel
 */
function run(o) {
  return new Promise((resolve, reject) => {
    const exe = findClaude();
    if (!exe) return reject(new Error('Claude Code is not installed. See Setup step 1.'));
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (o.chrome) args.push('--chrome');
    if (o.slim) {
      // Token-lean run: a tiny system prompt instead of Claude Code's default one, no built-in tools, and only the
      // Chrome tools this task needs (each unused tool definition costs tokens on every run).
      args.push('--system-prompt', o.slim.system || 'Follow the instructions exactly. Be terse. Reply with JSON only.');
      // file_upload may only send files this session is allowed to Read, so upload tasks enable the Read tool.
      const builtins = [o.slim.web && 'WebSearch', o.slim.read && 'Read'].filter(Boolean);
      args.push('--tools', builtins.join(','));
      const allow = [...builtins];
      if (o.chrome) {
        const keep = new Set(o.slim.chromeTools || ['navigate', 'javascript_tool', 'tabs_close_mcp']);
        args.push('--disallowedTools', ...CHROME_TOOLS.filter((t) => !keep.has(t)).map((t) => 'mcp__claude-in-chrome__' + t));
        allow.push(...[...keep].map((t) => 'mcp__claude-in-chrome__' + t));
        const dirs = [o.cwd, ...(o.slim.dirs || [])].filter((d) => fs.existsSync(d));
        args.push('--add-dir', ...dirs);
      }
      if (allow.length) args.push('--allowedTools', ...allow);
    } else if (o.tools) {
      args.push('--allowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep');
      if (o.chrome) args.push('mcp__claude-in-chrome');
      // Share the workspace AND its sub-folders explicitly (Chrome's file_upload checks each path against the shared folders).
      const dirs = new Set([o.cwd]);
      for (const sub of ['output', 'clips', 'music', 'posts', 'posters']) { const d = path.join(o.cwd, sub); if (fs.existsSync(d)) dirs.add(d); }
      dirs.add(path.join(os.homedir(), 'Downloads'));
      try { dirs.add(fs.realpathSync(o.cwd)); } catch {}
      args.push('--add-dir', ...dirs);
    } else if (o.web) {
      args.push('--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch', 'WebFetch');
    } else {
      args.push('--tools', '');
    }
    if (o.model) args.push('--model', o.model);
    if (o.effort) args.push('--effort', o.effort);
    if (o.maxTurns) args.push('--max-turns', String(o.maxTurns));
    const isCmd = /\.(cmd|bat)$/i.test(exe);
    // lean runs skip Claude's hidden thinking (it adds tokens and these steps are scripted)
    const child = spawn(exe, args, { cwd: o.cwd, shell: isCmd, windowsHide: true, env: o.slim ? { ...process.env, MAX_THINKING_TOKENS: '0' } : process.env });
    if (o.handle) o.handle.kill = () => { try { child.kill(); } catch {} };
    child.stdin.end(o.prompt);

    let buf = '', finalText = '', isError = false, stderr = '', usage = null;
    const onLine = (line) => {
      if (!line.trim()) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const c of ev.message.content) {
          if (c.type === 'tool_use') o.onStatus && o.onStatus(describeTool(c.name, c.input));
          else if (c.type === 'text' && c.text && c.text.trim()) o.onStatus && o.onStatus('Claude: ' + c.text.trim().split('\n')[0].slice(0, 110));
        }
      } else if (ev.type === 'result') {
        finalText = ev.result || '';
        isError = !!ev.is_error;
        if (ev.usage) usage = { fresh: (ev.usage.input_tokens || 0) + (ev.usage.output_tokens || 0) + (ev.usage.cache_creation_input_tokens || 0), cached: ev.usage.cache_read_input_tokens || 0, turns: ev.num_turns || 0 };
      }
    };
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (buf.trim()) onLine(buf);
      if (code !== 0 && !finalText) return reject(new Error(stderr.trim().slice(-400) || `Claude exited with code ${code}`));
      resolve({ text: finalText, isError, usage });
    });
  });
}

// Pull the first JSON object/array out of a model reply (tolerates code fences and chatter).
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], text] : [text];
  for (const c of candidates) {
    const start = c.search(/[\[{]/);
    if (start < 0) continue;
    const open = c[start], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) { try { return JSON.parse(c.slice(start, i + 1)); } catch { break; } }
    }
  }
  throw new Error('Claude did not return valid JSON. Try again.');
}

module.exports = { run, findClaude, extractJson };
