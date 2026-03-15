import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('zeus', {
  getStatus: () => ipcRenderer.invoke('zeus:status'),
  togglePower: () => ipcRenderer.invoke('zeus:toggle-power'),
});
