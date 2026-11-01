import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HealthSchema, type HealthResult } from '../shared/bridge.ts';

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | undefined;
const endpoint = new URL(process.env.INTERVIEW_API_URL ?? 'http://127.0.0.1:3100');
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname)))
  throw new Error('Remote API must use HTTPS.');
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
    throw new Error('IPC sender is not the application main frame.');
}
ipcMain.handle('app:version', (event) => { trusted(event); return app.getVersion(); });
ipcMain.handle('api:health', async (event): Promise<HealthResult> => {
  trusted(event);
  try {
    const response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) return { ok: false, message: '服务端暂不可用。' };
    const parsed = HealthSchema.safeParse(await response.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: '服务端协议不兼容。' };
  } catch { return { ok: false, message: '无法连接服务端，请检查连接。' }; }
});
function createWindow() {
  window = new BrowserWindow({ width: 1080, height: 760, webPreferences: {
    preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('closed', () => { window = undefined; });
  void window.loadFile(join(here, 'renderer', 'index.html'));
}
void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
