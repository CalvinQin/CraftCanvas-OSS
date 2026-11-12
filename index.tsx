
import React from 'react';
import ReactDOM from 'react-dom/client';
import AppErrorBoundary from './components/AppErrorBoundary';
const WorkflowPage = React.lazy(() => import('./components/WorkflowPage'));
const WorkspacePage = React.lazy(() => import('./components/WorkspacePage'));
import { PUBLIC_PAGES } from './site/content';
const LibraryPage = React.lazy(() => import('./components/LibraryPage'));
const AccountPage = React.lazy(() => import('./components/AccountPage'));
const AdminPage = React.lazy(() => import('./components/AdminPage'));
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const path = window.location.pathname.replace(/\/$/, '') || '/';
if (['/admin', '/workspace', '/workflow', '/account', '/library'].includes(path)) { const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.append(meta); }
if (Object.hasOwn(PUBLIC_PAGES, path)) {
  import('./site/PublicPage').then(({ default: PublicPage }) => {
    const page = <React.StrictMode><PublicPage path={path} /></React.StrictMode>;
    if (rootElement.dataset.prerendered) ReactDOM.hydrateRoot(rootElement, page);
    else ReactDOM.createRoot(rootElement).render(page);
    document.title = PUBLIC_PAGES[path].title;
  }).catch(() => { if (!rootElement.dataset.prerendered) rootElement.innerHTML = '<main><h1>页面加载失败</h1><p>请刷新页面重试。</p></main>'; });
} else {
  ReactDOM.createRoot(rootElement).render(<React.StrictMode><AppErrorBoundary><React.Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-white text-sm text-ink-500">正在打开 CraftCanvas…</div>}>
    {path === '/admin' ? <AdminPage /> : path === '/account' ? <AccountPage /> : path === '/workflow' ? <WorkflowPage /> : path === '/workspace' ? <WorkspacePage /> : path === '/library' ? <LibraryPage /> : <main className="info-main page-width"><h1>页面不存在</h1><a href="/">返回 CraftCanvas 首页</a></main>}
  </React.Suspense></AppErrorBoundary></React.StrictMode>);
}
