import React from 'react';
import { ArrowUpRight, Github, GitBranch, BookOpen, Server, Check } from 'lucide-react';
import LandingPage from '../components/LandingPage';
import InfoPage from '../components/InfoPage';
import ProductShell from '../components/ProductShell';
import { DOCS, FAQ, PROJECT } from './content';

function DocsPage({ path }: { path: string }) {
  const page = DOCS[path];
  return <ProductShell active="/docs"><main id="main-content" className="info-main page-width"><div className="info-heading"><p className="eyebrow">{page.eyebrow}</p><h1>{page.heading}</h1><p>{page.intro}</p><div className="docs-actions"><a href={PROJECT.repository} className="btn-primary"><Github size={16} />查看 GitHub 源码<ArrowUpRight size={16} /></a><span>v{PROJECT.version} · MIT · 更新于 {PROJECT.updated}</span></div></div><div className="docs-nav-cards"><a href="/docs"><BookOpen size={18} /><span>项目概览</span></a><a href="/docs/workflows"><GitBranch size={18} /><span>节点工作流指南</span></a><a href="/docs/self-hosting"><Server size={18} /><span>自托管部署</span></a></div><div className="info-layout"><nav aria-label="文档目录">{page.sections.map(s => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}</nav><article className="info-content">{page.sections.map(s => <section key={s.id} id={s.id}><h2>{s.title}</h2>{s.text.map(p => <p key={p}>{p}</p>)}{s.code && <pre className="docs-code"><code>{s.code}</code></pre>}</section>)}{path === '/docs' && <section id="faq"><h2>常见问题</h2>{FAQ.map(([q,a]) => <div key={q}><h3>{q}</h3><p>{a}</p></div>)}</section>}<p className="docs-source">维护者：<a href="https://github.com/CalvinQin">Calvin Qin</a> · <a href={`${PROJECT.repository}/blob/main/CHANGELOG.md`}>更新记录</a> · <a href={path+'.md'}>Markdown 版本</a></p></article></div></main></ProductShell>;
}
function PricingPage() {
  return <ProductShell active="/pricing"><main id="main-content" className="info-main page-width"><div className="info-heading"><p className="eyebrow">OPEN SOURCE / USAGE</p><h1>源码开放。费用透明。</h1><p>开源许可、模型调用和托管成本各有边界。先了解实际可用的能力，再开始创作。</p></div><div className="open-source-plans">{[
    ['MIT 开源许可','自由构建自己的创作工具','源代码允许使用、修改和商用，分发时保留版权和许可声明。第三方依赖、字体和品牌标识保留各自条款。','查看许可证',`${PROJECT.repository}/blob/main/LICENSE`],
    ['模型与托管','按自己的供应商方案使用','AI 模型 API、Workers、D1 和 R2 可能产生费用。站点按账号显示请求额度，具体模型和积分规则由部署者配置。','了解自托管','/docs/self-hosting'],
    ['本站会员','当前尚未开放付款','会员和充值为方案预览，不接受真实付款，不自动续费。实际可用额度、模型配置和使用记录请在个人中心查看。','查看个人中心','/account'],
  ].map(([name,title,text,label,href])=><article key={name}><span><Check size={15}/>{name}</span><h2>{title}</h2><p>{text}</p><a className="btn-text" href={href}>{label}<ArrowUpRight size={16}/></a></article>)}</div></main></ProductShell>;
}
export default function PublicPage({ path }: { path: string }) {
  if (path === '/') return <LandingPage />;
  if (DOCS[path]) return <DocsPage path={path} />;
  if (path === '/pricing') return <PricingPage />;
  return <InfoPage kind={path.slice(1) as 'help'|'privacy'|'terms'} />;
}
