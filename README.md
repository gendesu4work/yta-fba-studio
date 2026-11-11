# YTA and FBA Studio

Powered by NEXUS MEDIA. A Windows desktop app that turns a niche into scheduled short-form animations
(YouTube Shorts, TikTok, Instagram Reels, Facebook Reels). It drives your own Claude account and your own Chrome
(Claude in Chrome), so you only need a Claude account and the extension.

## Download
Get the latest installer from **[Releases](../../releases/latest)**: `YTA-and-FBA-Studio-Setup-x.y.z.exe`.
Run it, pick an install folder, done. Windows SmartScreen may warn because the installer is not code-signed
(More info, then Run anyway).

## First run
1. Install **Claude Code** and sign in with your Claude account.
2. Install the **Claude in Chrome** extension and sign in.
3. Log in to ElevenLabs, Google Flow, Facebook (Meta Business Suite), YouTube, TikTok and Instagram in Chrome.
4. Open the app, go to **Setup**, press **Check my setup**.

Tabs: **Create** (niche, 10 daily ideas, up to 5 picks, scripts, visuals, music), **Builder** (learn art style from
reference videos), **Music**, **Upload & Schedule** (US prime-time slots), **Settings** (theme, window mode, account, updates).
Your data lives in `Documents\Shorts Studio`.

## Auto-update
The installed app checks this repository's Releases every 7 days and installs new versions silently when idle.

## Publishing a new version
```bash
# bump "version" in package.json, commit, then:
git tag v1.2.1 && git push origin main --tags
```
The GitHub Action builds the installer and attaches it, with `latest.yml`, to a new Release. The auto-updater needs
the repository to be **public** (or a token in the app, which this app does not ship).

## Develop
```bash
npm install
node node_modules/electron/install.js
npm start          # run from source
npm run dist       # build the installer into dist/
```
