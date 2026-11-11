// Silent auto-updater: checks GitHub Releases every 7 days and installs new versions
// without asking, but only while the app is idle so a running video job is never cut off.
const INTERVAL = 7 * 24 * 3600 * 1000;

function init({ app, engine }) {
  const state = { packaged: app.isPackaged, version: app.getVersion() };
  const set = (status) => engine.setSettings({ updateStatus: status });
  if (!app.isPackaged) return { state, check: async () => set('Updates only run in the installed app.') };

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
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

  autoUpdater.on('update-available', (i) => set(`Downloading version ${i.version}…`));
  autoUpdater.on('update-not-available', () => set(`Up to date (version ${state.version}).`));
  autoUpdater.on('update-downloaded', (i) => { set(`Version ${i.version} downloaded. Installing when idle.`); installWhenIdle(); });
  const fail = (e) => { const m = String(e.message || e); set(/404|No published versions|latest\.yml|Not Found/i.test(m) ? 'No releases found on GitHub yet.' : /ENOTFOUND|ETIMEDOUT|ECONN|network/i.test(m) ? 'Could not reach GitHub. Check your internet connection.' : 'Update check failed: ' + m.slice(0, 120)); };
  autoUpdater.on('error', fail);

  async function check(force = false) {
    const last = engine.state.settings.lastUpdateCheck || 0;
    if (!force && Date.now() - last < INTERVAL) return;
    engine.setSettings({ lastUpdateCheck: Date.now() });
    set('Checking for updates…');
    try { await autoUpdater.checkForUpdates(); } catch (e) { fail(e); }
  }
  setTimeout(() => check(false), 20 * 1000);            // shortly after launch
  setInterval(() => check(false), 6 * 3600 * 1000);      // app may stay open for days; re-evaluate the 7-day rule
  return { state, check };
}

module.exports = { init, INTERVAL };
