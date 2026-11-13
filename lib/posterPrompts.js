// Prompts for the Poster tab: single-picture posts for a Facebook Page and (optionally) Instagram.
const { TOKENS, memoryBlock } = require('./prompts');

const TEXT_SHAPE = '{"headline":"","position":"top|center|bottom","font":"Rounded|Impact|Arial Black|Segoe UI|Georgia|Bahnschrift","color":"#ffffff","accent":"#ffd400","stroke":false,"band":"none|shade|box","upper":false,"size":1}';

const RULES = `Rules (strict):
- Original and genuinely worth stopping for: entertaining AND valuable (a laugh, a lesson, a useful fact or real news). Natural US-style English, relatable to the US, Canada, Australia and the UK.
- No misleading claims, no fake statistics or quotes, no misattributed quotes, no medical/financial/legal guarantees, no hate, violence, sexual content, politics bait or anything that hurts monetization.
- No real people's likeness, no celebrities, no brand logos, no copyrighted characters or existing meme templates.
- Never engagement bait ("like if", "share to win", "tag a friend", "comment YES").`;

function posterIdeasPrompt({ niche, guide, style, text, web, history, angle, memory }) {
  return `You are the creative director of a Facebook Page and Instagram account that posts ONE eye-catching picture with short text on it.
Niche: ${niche}${guide ? `\nWhat this niche needs: ${guide}` : ''}
${web ? 'FIRST use web search to find what is genuinely new right now (last 48 hours). Only use stories you found in a reputable source, and put "Outlet, Mon D" in "source".\n' : ''}
Create 5 poster ideas that are clearly DIFFERENT from each other (different topics, emotions, layouts and colour moods) and different from everything made before: ${history.length ? history.slice(-60).join(' | ') : 'nothing yet'}.
Creative direction for this batch (use it as a spark, not a rule): ${angle}.

${RULES}
${memoryBlock(memory)}
FORMAT (always): a SQUARE 1:1 picture that the app darkens with a vignette, with ONE hook caption written in front of it (bold, high-contrast, easy to read on the dark picture). The picture is made by an AI image generator and must contain NO text at all; the app writes the hook caption on top afterwards, so the image prompt must describe a square composition with clean space where the caption goes (top, center or bottom, matching "text.position").
Base visual style for this niche: ${style}. Default text look: ${JSON.stringify(text)} (change it when another look fits the idea better).
Text on the picture: ONLY "headline", the hook caption that makes people stop scrolling (6-25 words, one or two short sentences, may end with 1-2 fitting emojis like 🙏❤️🔥💯). Nothing else is written on the picture. Wrap one or two key words of the headline in *asterisks* to colour them with the accent colour (optional).
"realistic": true when the picture is photorealistic, i.e. it looks like a real photograph (Meta's toggle says the AI label is required for realistic photos made with AI, so it is then turned on); false for illustrations, cartoons, 3D renders and clearly stylized art.

Reply with ONLY a JSON array of 5 objects, no other text:
[{"title":"short internal name","angle":"2-4 word angle","imagePrompt":"40-70 words: one vivid square 1:1 scene, subject, composition, light, colours, where the empty space for text is. No text, letters, signs, logos or watermarks.","realistic":false,"text":${TEXT_SHAPE},"caption":"ONE short line plus 2-4 relevant hashtags","comment":"one genuine, relatable question the audience will want to answer","source":"","why":"one honest sentence on why it will stop the scroll"}]`;
}

function posterRevisePrompt({ niche, item, note, memory }) {
  return `You edit the text of a social media poster (one picture with short text written on top) for a ${niche} Facebook Page / Instagram account.
Picture: ${item.idea.imagePrompt}
Current text design: ${JSON.stringify(item.text)}
Current caption: ${item.caption}
Current comment: ${item.comment}
${item.idea.source ? `News source (keep every fact true to it): ${item.idea.source}\n` : ''}
The user wants: ${note || 'make the text punchier and easier to read, keep the meaning'}

${RULES}
${memoryBlock(memory)}
The picture is square (1:1) and carries ONE hook caption ("headline", 6-25 words, may end with 1-2 emojis); nothing else is written on it. *asterisks* mark accent-coloured words. Change only what the user asked for (plus anything needed to keep it readable).
Reply with ONLY JSON, no other text:
{"text":${TEXT_SHAPE},"caption":"","comment":""}`;
}

function posterFlowPrompt({ item, style, ws, downloads }) {
  const dir = `${ws}\\posters\\${item.id}`;
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account.

${TOKENS}
TASK: Make ONE poster picture in Google Flow and save it to "${dir}\\".
1. Open https://labs.google/fx/tools/flow in a NEW tab and start a NEW project named "poster-${item.id}".
2. Use IMAGE generation (text-to-image), not video. Aspect ratio: ALWAYS square 1:1. Set it before submitting and read the setting back to confirm; never use any other ratio. If there is a setting for the number of outputs, choose 2 (gives the user a choice); otherwise 1.
3. Prompt (type it exactly, then submit once):
"""
${item.idea.imagePrompt} Style: ${style}. No text, no letters, no words, no signs, no logos, no watermark, no borders.
"""
4. Wait until the images are finished. Check each one (a screenshot is fine here): no baked-in text or garbled letters, no watermark, square 1:1, no borders or letterboxing, the main subject is not cut off, and there is clean space for text. If none passes, edit nothing else and regenerate once with the same prompt.
5. DOWNLOAD THE WHOLE PROJECT ONCE (never picture by picture): click the 3-dots menu on the right side of the project and choose "Download project". Then with your shell tool:
   a. Find the newest .zip in "${downloads}" (created in the last few minutes) and wait until its size stops changing.
   b. Extract it into the NEW empty folder "${dir}\\_flow_download" (never run anything from it).
   c. Copy each picture (png/jpg/jpeg/webp, max 4, only the ones that passed the check) to "${dir}\\v1.<ext>", "${dir}\\v2.<ext>"... keeping the original extension.
   d. Delete the "_flow_download" folder and the zip.
   If "Download project" is missing or fails, download each passing picture on its own and move the newest file from "${downloads}" to v1/v2..., one at a time, and say so in "detail".
6. Confirm the files exist and are larger than 30 KB.

Reply with ONLY JSON: {"ok":true|false,"saved":["v1.png"],"aspect":"1:1","detail":"short note"}`;
}

const aiNote = (realistic) => realistic
  ? 'AI LABEL: this picture looks like a realistic photo made with AI, so turn the "Add AI label" / "AI info" toggle ON wherever the composer offers it.'
  : 'AI LABEL: leave the "Add AI label" / "AI info" toggle OFF. Meta only requires it for realistic photos and videos made with AI, and this picture is an illustration/stylized scene without realistic people. If a label is applied automatically, leave it.';

function posterPostPrompt({ platform, item, file, when, fbPage, retry }) {
  const sched = when
    ? `First read the current date and time on this computer. SCHEDULE it (do NOT publish now) for ${when.local} in the account's own time zone (date ${when.date}, time ${when.time12} / ${when.time24}); that is ${when.et}, a strong time for US audiences. If that time is already past or less than 15 minutes away when you reach the scheduler, stop and reply {"ok":false,"detail":"slot passed"}. If the picker cannot take that exact minute, use the closest selectable time up to 10 minutes AFTER it and state the time you used.`
    : 'Publish it right now.';
  const common = `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account. Open a NEW tab.
${TOKENS}
Picture file (upload this exact file): ${file}
${aiNote(item.realistic)}
${retry ? 'This is a RETRY: first check whether this same picture/caption already exists as a draft, a scheduled post or a published post from an earlier attempt; reuse or delete the leftover so no duplicate is created.' : 'This is the first attempt.'}
Before the final Post/Schedule click, double-check the picture, the caption and the time. Then confirm the result on screen before replying.
Reply with ONLY JSON: {"ok":true|false,"detail":"short note"}`;
  if (platform === 'facebook') return `${common}

TASK: Create a PHOTO post (not a reel, not a story) on the Facebook Page "${fbPage}" through Meta Business Suite: https://business.facebook.com/latest/composer (Create post). Never use the personal profile; make sure the selected Page is "${fbPage}". If the composer also offers Instagram, leave Instagram unticked (it is handled separately).
- If the photo file input is hidden: before clicking "Add photo", run this with the javascript tool: patch HTMLInputElement.prototype.click so file inputs are stored on window.__fileInput instead of opening a dialog, then use file_upload on that input.
- Text (keep it exactly, it is short on purpose): ${item.caption}
- ${sched} (Scheduling options / "Schedule" in the publish section).`;
  if (platform === 'instagram') return `${common}

TASK: Post this picture on Instagram web (https://www.instagram.com) with Create > Post. When asked to crop, keep it square (1:1 / original) so nothing is cut off. Instagram web cannot schedule, so publish it now.
- Caption (keep it exactly): ${item.caption}`;
  throw new Error('Unknown platform');
}

function posterCommentPrompt({ platform, item, fbPage }) {
  const where = platform === 'facebook' ? `the Facebook Page "${fbPage}" (open the Page, or Meta Business Suite > Content)` : "Instagram (the account's newest post)";
  return `You are operating the user's own, already-logged-in Chrome (Claude in Chrome). Never switch or sign out of any account. Open a NEW tab.
${TOKENS}
TASK: On ${where}, find the newest PHOTO post with the caption "${item.caption}" and post ONE comment from the SAME account: "${item.comment}"
Only post it if that post is live and the comment is not already there. Do not tag anyone and never comment from another account.
Reply with ONLY JSON: {"ok":true|false,"detail":"short note"}`;
}

module.exports = { posterIdeasPrompt, posterRevisePrompt, posterFlowPrompt, posterPostPrompt, posterCommentPrompt };
