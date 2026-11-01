/// <reference types="vite/client" />
import type { DesktopBridge } from '../shared/bridge.ts';
declare global { interface Window { interview: DesktopBridge } }
export {};
