const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  state: call('state'), settings: call('settings'), check: call('check'), ideas: call('ideas'), select: call('select'),
  scripts: call('scripts'), updatePost: call('updatePost'), approveScript: call('approveScript'), discard: call('discard'),
  produce: call('produce'), accept: call('accept'), reject: call('reject'), retryJob: call('retryJob'), cancel: call('cancel'),
  refFiles: call('refFiles'), refUrl: call('refUrl'), toggleLesson: call('toggleLesson'), removeRef: call('removeRef'),
  musicFiles: call('musicFiles'), ytMusic: call('ytMusic'), removeMusic: call('removeMusic'), researchTrack: call('researchTrack'),
  winMode: call('winMode'), winCtl: call('winCtl'), authStatus: call('authStatus'), authLogout: call('authLogout'), authLogin: call('authLogin'),
  review: call('review'), addMemory: call('addMemory'), toggleMemory: call('toggleMemory'), removeMemory: call('removeMemory'), customSlot: call('customSlot'), fix: call('fix'), approveFix: call('approveFix'), discardFix: call('discardFix'), retryUpload: call('retryUpload'),
  retryProduce: call('retryProduce'), redo: call('redo'), continueVideo: call('continueVideo'), alertRetry: call('alertRetry'), alertFix: call('alertFix'), alertDismiss: call('alertDismiss'), dataInfo: call('dataInfo'), backupNow: call('backupNow'),
  appInfo: call('appInfo'), updateCheck: call('updateCheck'), updateInstall: call('updateInstall'),
  openFolder: call('openFolder'), openUrl: call('openUrl'),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
});
