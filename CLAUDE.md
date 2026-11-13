# YTA and FBA Studio

Electron app (`main.js`, `preload.js`, `renderer/`, `lib/`) that turns a niche into scheduled short-form stickman animations. Upload and comment instructions for Claude in Chrome live in `lib/prompts.js`.

## AI-content label when posting (standing rule)
Leave the AI label **unchecked** on every platform:
- YouTube "Altered or synthetic content": No
- TikTok "AI-generated content": off
- Facebook / Instagram "Add AI label": off

Why: each platform only requires the label for realistic content that viewers could mistake for real (Meta's toggle reads "required for realistic photos and videos made with AI"). Our videos are stickman/cartoon animation with a generic narrator voice, so the label doesn't apply.

Exceptions:
- If a video shows realistic-looking people, a real person's likeness or voice, or realistic fake events, turn the label ON on every platform.
- If a platform adds a label automatically, leave it. Never alter or re-upload a file to get rid of one.

The upload prompts in `lib/prompts.js` (`AI_NOTE` and the TikTok task) must stay in line with this rule.

## Poster tab (standing rule)
Picture posts are always a square 1:1 Flow image, darkened with a vignette by the app, with ONE hook caption in front (no second line, no footer). Default look: centered rounded-bold white ALL CAPS caption, no outline (the user's reference). Motivational = luxury "dream life" pictures (cash, cars, watches) for a young audience; photorealistic pictures get the AI label on. See `lib/posters.js`, `lib/posterPrompts.js` and `drawPoster` in `renderer/app.js`.
