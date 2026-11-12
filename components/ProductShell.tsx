import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { BrandWordmark, LogoMark } from './Logo';
export function ProductHeader({ active = '' }: { active?: string }) {
  const [account, setAccount] = useState<any>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { const controller = new AbortController(); fetch('/api/account', { signal: controller.signal, cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(setAccount).catch(() => {}); return () => controller.abort(); }, []);
  const links = [['/', '产品'], ['/library', '资料库'], ['/workflow', '节点工作流'], ['/docs', '开源文档'], ['/pricing', '费用说明'], ['/help', '使用指南']];
  return <header className="product-header"><div className="product-nav">
    <a href="/" className="brand" aria-label="CraftCanvas 首页"><LogoMark size={28} /><BrandWordmark /></a>
    <nav aria-label="主导航" className={open ? 'site-links is-open' : 'site-links'}>{links.map(([href, label]) => <a key={href} href={href} aria-current={active === href ? 'page' : undefined}>{label}</a>)}{account?.isAdmin && <a href="/admin">管理后台</a>}</nav>
    <div className="nav-actions"><a className="account-link" href={account?.account ? '/account' : '/account?login=1'}>{account?.account ? '个人中心' : '登录'}</a><a className="btn-primary btn-small" href="/workspace">进入工作台 <ArrowUpRight size={14} /></a><button className="mobile-menu" aria-label={open ? '关闭导航' : '打开导航'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button></div>
  </div></header>;
}
export function ProductFooter() {
  return <footer className="product-footer"><div className="footer-top"><div><a href="/" className="brand"><LogoMark size={25} /><BrandWordmark /></a><p>让商品的每一面，都值得被看见。</p></div><div className="footer-links"><a href="/workspace">开始创作</a><a href="/library">资料库</a><a href="/help">使用指南</a><a href="/account">个人中心</a><a href="/docs">开源文档</a><a href="https://github.com/CalvinQin/CraftCanvas-OSS">GitHub</a><a href="/privacy">隐私说明</a><a href="/terms">使用条款</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} CraftCanvas</span><span>专注于商品视觉创作</span></div></footer>;
}
export default function ProductShell({ active, children }: { active?: string; children: React.ReactNode }) { return <div className="product-site"><a className="skip-link" href="#main-content">跳转到正文</a><ProductHeader active={active} />{children}<ProductFooter /></div>; }
