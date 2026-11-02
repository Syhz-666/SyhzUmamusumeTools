const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  load: () => ipcRenderer.invoke('state:load'),
  save: (state) => ipcRenderer.invoke('state:save', state),
  restore: (state) => ipcRenderer.invoke('state:restore', state),
  exportBackup: (state) => ipcRenderer.invoke('backup:export', state),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  exportFile: (payload) => ipcRenderer.invoke('file:export', payload),
  openSource: (url) => ipcRenderer.invoke('source:open', url),
});
