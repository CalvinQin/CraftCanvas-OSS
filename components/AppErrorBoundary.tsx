import React from 'react';

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  declare props: React.PropsWithChildren;
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <div role="alert" className="max-w-md text-center">
        <h1 className="mb-3 text-xl font-bold">页面暂时无法显示</h1>
        <p className="mb-6 text-sm text-ink-500">请重新加载后继续。已保存的云端作品仍会保留。</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>重新加载</button>
        <a href="/" className="ml-4 text-sm underline underline-offset-4">返回首页</a>
      </div>
    </main>;
  }
}
