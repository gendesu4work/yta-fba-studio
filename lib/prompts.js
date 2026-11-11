const RULES = `Content rules (strict):
- Original, entertaining AND genuinely valuable: a strong hook in the first 2 seconds, ONE concrete actionable takeaway (or a real twist/payoff for stories and comedy), and a loop-friendly ending.
- Natural US-style English with relatable references (jobs, money, school, fitness, side hustles, daily life). Never exclude or mislead anyone.
- No misleading claims, no fake statistics, no medical/financial/legal guarantees, no hate, graphic violence, sexual content or anything that would get a channel demonetized.
- Vary hook type, scenario, colour arc and delivery. Never templated or near-duplicate.`;

function ideasPrompt({ niche, nicheNote, used, count = 10 }) {
  return `You are the head writer for a faceless short-form animation channel (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels). Animation style: stickman / simple characters, 9:16, 25-50 seconds.

Niche: ${niche}${nicheNote ? ` (${nicheNote})` : ''}
Create ${count} DIFFERENT video ideas for today. Mix hook types (question, bold claim, "stop doing X", story opener, surprising fact, relatable confession, challenge, etc.). Every idea must be unique and not similar to these earlier titles: ${used.length ? used.slice(-40).join(' | ') : 'none yet'}.

${RULES}

Reply with ONLY a JSON array of ${count} objects, no other text:
[{"title":"short punchy title","hookType":"question|bold-claim|story|fact|confession|challenge|other","hook":"the exact first sentence spoken","premise":"2 sentences: what happens in the video","takeaway":"the one concrete takeaway / payoff / punchline","scenario":"the stickman scenario in one line"}]`;
}

function scriptPrompt({ ideas, niche, nicheStyle, sceneCount, learned, auto }) {
  const sceneRule = auto
    ? `- scenes: AUTOMATIC mode. Split the voiceover into its sentences IN ORDER and make exactly ONE scene per sentence (so every sentence gets a new visual). Each scene has "line" (that exact sentence, without [audio tags]), "type" ("video" or "image"), "motion" (zoom_in, zoom_out, pan_left or pan_right; used for images) and "prompt" (one vivid full-frame vertical 9:16 shot).
  * The FIRST scene MUST be "video" (a moving clip that hooks viewers in the first 3 seconds).
  * Decide type by what keeps viewers entertained: "video" for action, reveals, emotional peaks, punchlines and the final beat; "image" for calm or explanatory beats. Typically 30-50% videos, never more than 6 videos, never more than 14 scenes total, and never two similar shots back to back.`
    : `- scenes: exactly ${sceneCount} scenes in story order. Each has "seconds" (4-8), "motion" (one of zoom_in, zoom_out, pan_left, pan_right) and "prompt": a vivid description of ONE full-frame vertical 9:16 shot for an AI image/video generator.`;
  const shape = auto
    ? '{"slug":"","title":"","description":"","short_caption":"","engagement_comment":"","tags":[""],"voiceover":"","scenes":[{"line":"","type":"video","motion":"zoom_in","prompt":""}]}'
    : '{"slug":"","title":"","description":"","short_caption":"","engagement_comment":"","tags":[""],"voiceover":"","scenes":[{"seconds":6,"motion":"zoom_in","prompt":""}]}';
  return `Write the full production scripts for ${ideas.length} faceless short-form animation video${ideas.length > 1 ? 's' : ''}, one per idea. Make them clearly different from each other in hook, scenario, colour arc and delivery.

Niche: ${niche}
Ideas: ${JSON.stringify(ideas)}
Visual style line (applies to every scene): ${nicheStyle}
${learned ? `\nTechniques learned from the user's reference videos (apply them to structure, pacing, hook and delivery, in your own original way):\n${learned}\n` : ''}
${RULES}

Requirements for each video:
- voiceover: 90-140 words, max 900 characters, written for ElevenLabs v4. Use audio tags in square brackets sparingly (e.g. [slow cinematic], [pause], [firm], [laughs], [whispers]) to direct delivery. The first sentence is the hook. End so the video loops naturally into the opening.
${sceneRule}
- Each scene prompt includes a colour palette that shifts across the video (colour arc). Do NOT mention text, captions, letterboxing or borders in scene prompts.
- description: a short plain description plus 4-6 hashtags ending with #shorts.
- short_caption: ONE short line plus 2-3 hashtags (used for Facebook and Instagram).
- engagement_comment: one genuine, relatable question the audience will want to answer. No "comment YES", no "tag a friend", no engagement bait.
- slug: lowercase-hyphenated, unique, max 50 chars.

Reply with ONLY a JSON array with one object per idea, in the same order, no other text:
[${shape}]`;
}

function voicePrompt({ post, voice, ws, downloads }) {
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account.

${TOKENS}
TASK: Generate the voiceover for one video on ElevenLabs and save it as an MP3.
1. Open a NEW tab to https://elevenlabs.io/app/speech-synthesis/text-to-speech
2. Choose the model "Eleven v4" (Eleven v3/v4 family that supports audio tags). If it is not available, pick the newest expressive Eleven model and say so in your reply.
3. Select the voice named exactly "${voice}". Read the voice name on screen and verify it BEFORE generating. Never use any other voice, and never use a custom/cloned voice belonging to the user.
4. Replace the text box content with exactly this script (keep the [audio tags]):
"""
${post.voiceover}
"""
5. Check the credit estimate shown. If it is above 2000 credits, stop and report instead of generating.
6. Click Generate and wait until the audio is ready, then download the MP3 (Download button).
7. Using your shell tool, find the newest .mp3 in "${downloads}" (created in the last few minutes) and move it to "${ws}\\output\\${post.slug}\\voice.mp3" (create the folder if needed). Confirm the file exists and is larger than 20 KB.

Reply with ONLY JSON: {"ok":true|false,"detail":"short note"}`;
}

function flowPrompt({ post, style, ws, downloads }) {
  const list = post.scenes.map((s, i) => `Scene ${i + 1} [${s.type === 'video' ? 'VIDEO 8s' : 'IMAGE'}] -> save as ${String(i + 1).padStart(2, '0')}.${s.type === 'video' ? 'mp4' : 'png'}\n  Prompt: ${s.prompt}`).join('\n');
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account.

${TOKENS}
TASK: Generate the visuals for one video in Google Flow and save them into "${ws}\\clips\\${post.slug}\\" (create the folder).
Flow: https://labs.google/fx/tools/flow  (open in a NEW tab, start a new project named "${post.slug}").

Scenes to generate, in order:
${list}

Style line to APPEND to every prompt: ${style}

Rules:
- Aspect ratio 9:16 (vertical), 720p, video clips 8 seconds. Image scenes use Flow's text-to-image; VIDEO scenes use text-to-video (each video clip costs credits, so generate each video scene only ONCE unless it fails the check).
- After each generation, CHECK the result is true full-frame vertical 9:16: no 16:9 or letterboxed picture, no blurred bars or blur at the top or bottom, no baked-in text. If it fails, regenerate (max 2 retries); if it still fails, skip that scene and tell me.
- Download each finished asset, then with your shell tool move the newest download from "${downloads}" to "${ws}\\clips\\${post.slug}\\NN.ext" using the exact filename shown for that scene. Do this right after each scene so progress is visible.
- The FIRST scene must be a generated video clip (never a still) because it hooks viewers in the first 3 seconds.
- Do not stop until every scene is saved or skipped.

Reply with ONLY JSON: {"ok":true|false,"saved":[1,2,...],"skipped":[],"detail":"short note"}`;
}

const TOKENS = `Token budget: prefer get_page_text, read_page and find over screenshots; take a screenshot only when text cannot tell you the state (for example to check a generated image). Keep replies short and do not narrate.`;

const AI_NOTE = `Answer every "AI-generated / altered or synthetic content" question truthfully according to that platform's own rules (the visuals and the narration of this video are AI-generated). Never skip such a question, never misdescribe the content, and never remove provenance labels.`;

function uploadPrompt({ platform, post, files, when, fbPage }) {
  const sched = when
    ? `SCHEDULE it (do NOT publish immediately) for ${when.local} in the account's own time zone (date ${when.date}, time ${when.time12} / ${when.time24}). This is ${when.et} US Eastern prime time.`
    : 'Publish it right now.';
  const common = `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account. Open a NEW tab.
${TOKENS}
Video file (use this exact file, it is under the 10 MB upload limit): ${files.upload}
${AI_NOTE}
Before clicking the final Schedule/Post button, double-check the title/caption, the file, and the time. Then confirm the result on screen (e.g. the scheduled badge or the posted item) before replying.
Reply with ONLY JSON: {"ok":true|false,"detail":"short note"}`;
  if (platform === 'youtube') return `${common}

TASK: Upload a YouTube Short at https://studio.youtube.com (Create > Upload videos).
- Title: ${post.title} #shorts
- Description:\n${post.description}
- Tags: ${post.tags.join(', ')}
- Audience: "No, it's not made for kids". Visibility: Public (via schedule).
- ${sched}`;
  if (platform === 'tiktok') return `${common}

TASK: Upload a TikTok at https://www.tiktok.com/tiktokstudio/upload
- Caption: ${post.short_caption}
- Turn ON the "AI-generated content" label (it is AI-generated).
- ${sched} (use the Schedule video option in the "When to post" section).`;
  if (platform === 'facebook') return `${common}

TASK: Create a Reel on the Facebook Page "${fbPage}" through Meta Business Suite (https://business.facebook.com/latest/reels_composer). Never use the personal profile; make sure the Page is "${fbPage}".
- The composer's file input is hidden: before clicking "Add video", run this with the javascript tool to capture it: patch HTMLInputElement.prototype.click so file inputs are stored on window.__fileInput instead of opening a dialog, then use file_upload on that input.
- Caption (keep short): ${post.short_caption}
- ${sched}`;
  if (platform === 'instagram') return `${common}

TASK: Post a Reel on Instagram web (https://www.instagram.com) using Create > Post, choosing the video above (it will be shared as a Reel). Instagram web cannot schedule, so publish it now.
- Caption (keep short): ${post.short_caption}`;
  throw new Error('Unknown platform');
}

function commentPrompt({ platform, post, fbPage }) {
  const where = platform === 'facebook' ? `Facebook Page "${fbPage}" (Meta Business Suite or the Page's Reels tab)` : 'Instagram (lowest-effort route: the account\'s newest Reel)';
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account. Open a NEW tab.
${TOKENS}
TASK: On ${where}, find the newest reel titled/captioned "${post.short_caption}" and post ONE comment from the SAME account: "${post.engagement_comment}"
Only post it if that reel is live and the comment is not already there. Do not tag anyone, do not post comments from other accounts.
Reply with ONLY JSON: {"ok":true|false,"detail":"short note"}`;
}

function checkPrompt({ voice, fbPage }) {
  return `You are connected to the user's own Chrome through Claude in Chrome. Do NOT type anything, change any settings or log in/out. READ-ONLY check.
${TOKENS}
Open each of these in its own NEW tab, wait for it to load, and decide whether the user is logged in (signed-in dashboard visible) or not (login/sign-up page):
1. elevenlabs: https://elevenlabs.io/app/speech-synthesis/text-to-speech  (also report whether a voice named "${voice}" is visible or selectable, as "voiceFound")
2. flow: https://labs.google/fx/tools/flow
3. facebook: https://business.facebook.com/latest/home  (also report whether the Page "${fbPage}" is available, as "pageFound")
4. youtube: https://studio.youtube.com
5. tiktok: https://www.tiktok.com/tiktokstudio
6. instagram: https://www.instagram.com
Close the tabs you opened when done.
Reply with ONLY JSON:
{"elevenlabs":{"loggedIn":true,"note":"","voiceFound":true},"flow":{"loggedIn":true,"note":""},"facebook":{"loggedIn":true,"note":"","pageFound":true},"youtube":{"loggedIn":true,"note":""},"tiktok":{"loggedIn":true,"note":""},"instagram":{"loggedIn":true,"note":""}}`;
}

const ANALYZE_RULES = `Describe TECHNIQUE only. Never copy distinctive characters, logos, names, on-screen text or specific scenes from the source; phrase every lesson generically so a new, original video can use it.
Reply with ONLY JSON:
{"summary":"2 sentences","lessons":[{"cat":"art-style|palette|camera|pacing|hook|narrative|captions|audio","text":"one clear, reusable instruction"}]}
Give 3-6 detailed "art-style" lessons FIRST (line weight and texture, character design and proportions, background treatment, shading/lighting, level of detail, framing/composition, how it looks as an AI-image prompt), then 1-2 each for palette, camera, pacing, hook, narrative, captions, audio where visible.`;

function analyzeFilePrompt({ name, frames, meta }) {
  return `Study a short-form animation the user likes so a new video can reuse its craft.
Video: "${name}" · ${meta.duration.toFixed(0)}s · ${meta.size.replace(',', 'x')} · about ${meta.cuts} scene cuts (~${(meta.cuts / Math.max(meta.duration, 1)).toFixed(2)} cuts per second).
Read these frame images in order (evenly spaced through the video) with your Read tool and analyze how it is made:
${frames.join(', ')}
${ANALYZE_RULES}`;
}

function analyzeUrlPrompt({ url }) {
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Open this video in a NEW tab: ${url}
Do not download anything and do not interact with the account (no likes, follows or comments). Let it play and take screenshots at about 8 different moments, and read the caption/title. Close the tab when done. Then analyze how the video is made so a new video can reuse its craft.
${ANALYZE_RULES}`;
}

function musicResearchPrompt({ title }) {
  return `Research a background-music track the user owns, identified only by its file title: "${title}".
Use web search to find the track/artist and what it sounds like (genre, mood, energy, tempo feel, emotional arc, where it is typically used). If you cannot find it, infer cautiously from the title and set "confidence":"low".
Reply with ONLY JSON: {"artist":"","genre":"","vibe":"2-4 words","mood":"one sentence","energy":"low|medium|high","bestFor":["motivation","comedy","storytime","horror","finance","facts","fitness","kids"],"confidence":"high|medium|low"}`;
}

function musicPickPrompt({ post, tracks }) {
  return `Choose the single best background-music track for this short animation.
Video: "${post.title}" (niche: ${post.niche}). Hook: ${post.voiceover.slice(0, 160)}. Mood needed: the emotional arc of the script, with the voice staying clearly on top.
Tracks (already researched):
${tracks.map((t) => `- ${t.file} :: ${t.vibe || '?'} / ${t.mood || ''} / energy ${t.energy || '?'} / best for ${(t.bestFor || []).join(', ')}`).join(' ; ')}
Reply with ONLY JSON: {"file":"exact file name from the list","reason":"one sentence"}`;
}

module.exports = { analyzeFilePrompt, analyzeUrlPrompt, musicResearchPrompt, musicPickPrompt, ideasPrompt, scriptPrompt, voicePrompt, flowPrompt, uploadPrompt, commentPrompt, checkPrompt };
