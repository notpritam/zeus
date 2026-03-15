import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('zeus', {
  getStatus: () => ipcRenderer.invoke('zeus:status'),
});
