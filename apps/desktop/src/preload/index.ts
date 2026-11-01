import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, HealthResult } from '../shared/bridge.ts';
const bridge: DesktopBridge = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getApiHealth: (): Promise<HealthResult> => ipcRenderer.invoke('api:health'),
};
contextBridge.exposeInMainWorld('interview', Object.freeze(bridge));
