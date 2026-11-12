import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Upload, Layers, Download } from 'lucide-react';
import ProductShell from './ProductShell';
const App = React.lazy(() => import('../App'));
export default function WorkspacePage() {
  const [state, setState] = useState<'loading' | 'signin' | 'ready' | 'error'>('loading');
  const load = () => { setState('loading'); fetch('/api/session', { cache: 'no-store' }).then(async r => { if (!r.ok) throw new Error(); const data = await r.json(); setState(data.userId ? 'ready' : 'signin'); }).catch(() => setState('error')); };
  useEffect(() => { document.title = '创作工作台 · CraftCanvas'; load(); }, []);
  if (state === 'ready') return <React.Suspense fallback={<div className="page-loading">正在打开你的画板…</div>}><App /></React.Suspense>;
  return <ProductShell><main id="main-content" className="workspace-welcome page-width"><p className="eyebrow">你的个人创作空间</p><h1>从第一张素材，<br />开始你的画布。</h1><p>登录后，你的参考图、创作结果和画板会跟随账号保存。</p>{state === 'loading' ? <p role="status">正在读取账号…</p> : state === 'error' ? <div role="alert"><p>暂时无法读取账号，请重试。</p><button className="btn-primary" onClick={load}>重新加载</button></div> : <a className="btn-primary" href={`/account?login=1&next=workspace${window.location.search ? `&resume=${encodeURIComponent(window.location.search)}` : ''}`}>登录并进入工作台 <ArrowUpRight size={18} /></a>}<div className="welcome-steps">{[[Upload, '上传真实产品图'], [Layers, '生成并完善作品'], [Download, '保存与导出交付']].map(([Icon, text]: any) => <span key={text}><Icon size={18} />{text}</span>)}</div><a className="btn-text" href="/library?tab=templates">先看看创作模板 <ArrowUpRight size={16} /></a></main></ProductShell>;
}
