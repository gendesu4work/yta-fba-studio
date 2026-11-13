// Prompts for the Poster tab: single-picture posts for a Facebook Page and (optionally) Instagram.
const { memoryBlock } = require('./prompts');
const { FLOW, META, META_INSTALL } = require('./posterScripts');

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

// ---- Browser tasks: token-lean. The app's scripts (posterScripts.js) do the page work; Claude only runs them in order.
const LEAN = `Rules: use ONLY the steps below. Never take screenshots and never read whole pages. Do not narrate. If the Chrome extension is not connected, reply {"ok":false,"detail":"Chrome extension not connected. Open Chrome and sign in to the Claude extension."}. Never switch or sign out of accounts.`;

function posterFlowPrompt({ item, style, full = true }) {
  const prompt = `${item.idea.imagePrompt} Style: ${style}. Square 1:1 image. No text, no letters, no words, no signs, no logos, no watermark, no borders.`;
  return `${LEAN}
TASK: start a square poster picture in Google Flow. The page script finishes and downloads it by itself, and the app saves the files.
1. navigate (no tabId) to https://flow.google.com/
2. javascript_tool, this code exactly:
${FLOW(prompt, full)}
3. Do NOT close the tab (the script is still working in it). Reply ONLY with the JSON the script returned (if it returned "INSTALL_NEEDED", reply {"ok":false,"detail":"INSTALL_NEEDED"}).`;
}

function posterPostPrompt({ platform, item, file, fbPage, retry, libFile }) {
  if (platform === 'facebook') {
    return `${LEAN}
TASK: publish a photo post now on the Facebook Page "${fbPage}" in Meta Business Suite.${retry ? ' Retry: first make sure this caption is not already the newest post on the Page; if it is, reply {"ok":true,"detail":"already posted"}.' : ''}
1. navigate (no tabId) to https://business.facebook.com/latest/composer
2. javascript_tool, this code exactly:
${META(fbPage, item.caption)}
   If it returns "INSTALL_NEEDED": find "sslib7 loader", file_upload that ref with paths ["${libFile}"], then javascript_tool: ${META_INSTALL(fbPage, item.caption)}
   If the result is ok:false, reply {"ok":false,"detail":<its detail>}.
3. find "ssimg7 upload", then file_upload that ref with paths ["${file}"].
4. javascript_tool: await __M.go(${item.realistic ? 'true' : 'false'},${JSON.stringify(fbPage)},${JSON.stringify(item.caption)})
   It checks the Page, photo and caption and only then clicks Publish. If it returns ok:false, reply ok:false with the result.
5. If ok:true, tabs_close_mcp on your tab. Reply ONLY JSON: {"ok":true|false,"detail":"<the detail>"}`;
  }
  if (platform === 'instagram') return `${LEAN}
${aiNote(item.realistic)}
TASK: publish this picture now on Instagram web: navigate to https://www.instagram.com, use Create > Post, upload the file with find + file_upload (paths ["${file}"]); never click the file input itself. Keep the crop square (original). Caption, exactly: ${item.caption}
Use find to get each control and computer left_click on its ref; use javascript_tool only to read small things (e.g. one element's text).${retry ? ' Retry: if this caption is already on the newest post, do not post again; reply ok:true.' : ''} Close your tab when done. Reply ONLY JSON: {"ok":true|false,"detail":"short note"}`;
  throw new Error('Unknown platform');
}

const aiNote = (realistic) => realistic
  ? 'AI LABEL: the picture looks like a realistic photo made with AI, so turn the "AI label" / "AI info" toggle ON if one is offered.'
  : 'AI LABEL: leave any "AI label" / "AI info" toggle OFF (stylized picture). If a label is applied automatically, leave it.';

function posterCommentPrompt({ platform, item, fbPage }) {
  const where = platform === 'facebook' ? `the Facebook Page "${fbPage}" (navigate to https://business.facebook.com/latest/content_calendar or the Page itself)` : "Instagram (navigate to https://www.instagram.com, open your own profile's newest post)";
  return `${LEAN}
TASK: on ${where}, open the newest photo post with the caption starting "${item.caption.slice(0, 40)}" and post ONE comment from the same account: "${item.comment}"
Only if that post is live and the comment is not already there. Use find for controls and computer left_click / type on refs. Close your tab when done. Reply ONLY JSON: {"ok":true|false,"detail":"short note"}`;
}

module.exports = { posterIdeasPrompt, posterRevisePrompt, posterFlowPrompt, posterPostPrompt, posterCommentPrompt };
