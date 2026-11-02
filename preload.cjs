const { contextBridge, ipcRenderer } = require('electron');
const pending = new Set();
let lastSaveError = '';
function persist(channel, state) {
  const operation = ipcRenderer.invoke(channel, JSON.stringify(state));
  pending.add(operation);
  operation.then(
    () => {
      pending.delete(operation);
      lastSaveError = '';
    },
    (error) => {
      pending.delete(operation);
      lastSaveError = String(error);
    },
  );
  return operation;
}
ipcRenderer.on('state:flush-request', async () => {
  while (pending.size) await Promise.allSettled([...pending]);
  ipcRenderer.send('state:flush-ready', { error: lastSaveError });
});
contextBridge.exposeInMainWorld('desktop', {
  load: async () => JSON.parse(await ipcRenderer.invoke('state:load')),
  save: (state) => persist('state:save', state),
  restore: (state) => persist('state:restore', state),
  exportBackup: (state) => ipcRenderer.invoke('backup:export', state),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  exportFile: (payload) => ipcRenderer.invoke('file:export', payload),
  openSource: (url) => ipcRenderer.invoke('source:open', url),
});
