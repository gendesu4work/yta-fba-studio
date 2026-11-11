// Silent auto-updater: checks GitHub Releases every 7 days and installs new versions
// without asking, but only while the app is idle so a running video job is never cut off.
const INTERVAL = 7 * 24 * 3600 * 1000;

function init({ app, engine }) {
  const state = { packaged: app.isPackaged, version: app.getVersion() };
  const set = (status) => engine.setSettings({ updateStatus: status });
  if (!app.isPackaged) return { state, check: async () => set('Updates only run in the installed app.'), install: async () => {} };

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false; // a manual check waits for the Update app button; background checks download by themselves (see below)
  autoUpdater.autoInstallOnAppQuit = true; // fallback: installs on next close if we never reach an idle moment
  autoUpdater.logger = null;

  const busy = () => {
    if (engine.progress.active) return true;
    const soon = Date.now() + 10 * 60 * 1000;
    return engine.state.jobs.some((j) => j.status === 'running' || (j.status === 'waiting' && j.runAt <= soon));
  };
  let installing = false;
  const installWhenIdle = () => {
    if (installing) return;
    if (busy()) return setTimeout(installWhenIdle, 60 * 1000);
    installing = true;
    engine.backup('pre-update');
    set('Installing the update…');
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500); // silent, then relaunch
  };

  let manual = false, downloading = false, lastPct = -10;
  const download = async () => {
    if (downloading) return; downloading = true; lastPct = -10;
    try { await autoUpdater.downloadUpdate(); } catch (e) { downloading = false; fail(e); }
  };
  autoUpdater.on('update-available', (i) => {
    engine.setSettings({ updateAvailable: i.version });
    if (manual) set(`Version ${i.version} is available. Press Update app to install it.`);
    else { set(`Downloading version ${i.version}…`); download(); } // background check: keep the old hands-off behaviour
  });
  autoUpdater.on('update-not-available', () => { engine.setSettings({ updateAvailable: '' }); set(`Up to date (version ${state.version}).`); });
  autoUpdater.on('download-progress', (p) => { const pct = Math.floor(p.percent || 0); if (pct - lastPct >= 5) { lastPct = pct; set(`Downloading the update… ${pct}%`); } });
  autoUpdater.on('update-downloaded', (i) => { engine.setSettings({ updateAvailable: '' }); set(`Version ${i.version} downloaded. Installing${busy() ? ' as soon as the running task finishes' : ' now'}…`); installWhenIdle(); });
  const fail = (e) => { const m = String(e.message || e); set(/404|No published versions|latest\.yml|Not Found/i.test(m) ? 'No releases found on GitHub yet.' : /ENOTFOUND|ETIMEDOUT|ECONN|network/i.test(m) ? 'Could not reach GitHub. Check your internet connection.' : 'Update check failed: ' + m.slice(0, 120)); };
  autoUpdater.on('error', fail);

  // The Update app button: download the found update, install it silently (same folder, your data untouched) and reopen the app.
  async function install() {
    if (!engine.state.settings.updateAvailable) { await check(true); if (!engine.state.settings.updateAvailable) return; }
    manual = false; set('Downloading the update…'); await download();
  }
  async function check(force = false) {
    manual = force;
    const last = engine.state.settings.lastUpdateCheck || 0;
    if (!force && Date.now() - last < INTERVAL) return;
    engine.setSettings({ lastUpdateCheck: Date.now() });
    set('Checking for updates…');
    try { await autoUpdater.checkForUpdates(); } catch (e) { fail(e); }
  }
  setTimeout(() => check(false), 20 * 1000);            // shortly after launch
  setInterval(() => check(false), 6 * 3600 * 1000);      // app may stay open for days; re-evaluate the 7-day rule
  return { state, check, install };
}

module.exports = { init, INTERVAL };
