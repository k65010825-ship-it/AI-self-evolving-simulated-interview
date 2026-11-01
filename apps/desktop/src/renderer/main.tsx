import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() {
  const [message, setMessage] = useState('尚未检查服务端连接。');
  const [busy, setBusy] = useState(false);
  async function checkHealth() {
    setBusy(true);
    try {
      if (!window.interview) { setMessage('此入口需要通过 Electron 启动。'); return; }
      const result = await window.interview.getApiHealth();
      setMessage(result.ok ? '连接成功：当前为开发骨架，面试功能尚未实现。' : result.message);
    } catch { setMessage('客户端连接检查失败。'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl p-10 text-slate-800">
    <h1 className="text-3xl font-semibold">AI 模拟面试工作台</h1>
    <p className="my-5">Java 后端 · Web 前端</p>
    <p>开发骨架已生成。正式面试、语音评估与策略自进化将在后续迭代接入。</p>
    <button className="my-6 rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => void checkHealth()}>
      {busy ? '检查中…' : '检查服务端连接'}
    </button><p role="status" aria-live="polite">{message}</p>
  </main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
