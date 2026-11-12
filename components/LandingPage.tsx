import { FAQ } from '../site/content';
import React, { useEffect, useRef } from 'react';
import { ArrowRight, ArrowUpRight, Layers, Check, MoveUpRight } from 'lucide-react';
import ProductShell from './ProductShell';
import { templates } from '../services/templates';
export default function LandingPage() {
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const elements = mainRef.current?.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!elements) return;
    if (!('IntersectionObserver' in window)) {
      elements.forEach(element => element.setAttribute('data-revealed', 'true'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.setAttribute('data-revealed', 'true');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <ProductShell active="/"><main id="main-content" ref={mainRef} className="landing-motion">
    <section className="landing-hero page-width"><div className="hero-copy"><p className="eyebrow"><span />为商品而生的 AI 创作工作台</p><h1>商品图创作，<br />连接更多<span>可能。</span></h1><p className="hero-description">开源 AI 工作台，把一张实拍图变成更多视觉方向。<br className="desktop-break" />用自然语言创作，在无限画布上完善，<br className="desktop-break" />把灵感变成可以交付的作品。</p><div className="hero-actions"><a className="btn-primary" href="/workspace">开始你的创作 <ArrowUpRight size={18} /></a><a className="btn-text" href="#workflow">了解工作流程 <ArrowRight size={16} /></a></div><p className="hero-note"><Check size={14} />MIT 开源 · 可自托管 · 模型与托管费用另计</p></div>
      <div className="hero-art-stage"><div className="hero-art"><div className="art-caption"><span>CRAFT / CANVAS</span><span>商品视觉实验室 — 01</span></div><img width="1536" height="1024" src="/images/studio-products.jpg" alt="暖白色摄影布景中的陶瓷杯、香水瓶和产品包装，展示商品视觉创作方向" fetchPriority="high" /><div className="art-toolbar"><span><Layers size={15} />从实拍到创作，尽在一张画布</span><a href="/workspace?template=editorial" aria-label="试用品牌场景模板"><MoveUpRight size={18} /></a></div><div className="art-label">创作方向示意 · AI 生成</div></div><span className="hero-orbit hero-orbit-one" aria-hidden="true" /><span className="hero-orbit hero-orbit-two" aria-hidden="true" /></div>
    </section>
    <section data-reveal className="workflow-section" id="workflow"><div className="page-width"><div className="section-heading"><p className="eyebrow">一个连贯的创作流程</p><h2>从素材开始，<br />在画布上完成。</h2><p>少一点反复切换，多一点专注创作。<br />素材、提示词、版本与交付，都有自己的位置。</p></div><div className="workflow-steps">{[['01', '收好你的素材', '上传产品实拍、品牌图片与参考灵感。在个人资料库中分类、搜索与收藏。', '/library', '打开资料库'], ['02', '描述你的想法', '选择场景模板或直接输入想法。多角度、商品九图与图像编辑都从同一个工作台开始。', '/workspace', '进入工作台'], ['03', '完善并交付', '在画布上比较版本、调整布局和添加批注。导出图片或备份可编辑项目，继续下一次创作。', '/help#export', '了解导出']].map(([n, title, text, href, label]) => <article key={n} style={{ '--reveal-order': Number(n) - 1 } as React.CSSProperties}><span className="step-number">{n}</span><h3>{title}</h3><p>{text}</p><a href={href}>{label} <ArrowRight size={15} /></a></article>)}</div></div></section>
    <section data-reveal className="templates-section page-width"><div className="section-row"><div><p className="eyebrow">先有方向，再有作品</p><h2>下一张图，从这里开始。</h2></div><a className="btn-text" href="/library?tab=templates">查看全部模板 <ArrowRight size={16} /></a></div><div className="template-preview-grid">{templates.slice(0, 3).map((t, i) => <a className={`template-preview tone-${t.tone}`} href={`/workspace?template=${t.id}`} key={t.id} style={{ '--reveal-order': i } as React.CSSProperties}><div className="template-preview-art"><img width="1536" height="1024" loading="lazy" src="/images/studio-products.jpg" alt="商品摄影创作方向示意" style={{ objectPosition: `${i * 50}% 65%` }} /><span>0{i + 1}</span></div><div className="template-preview-copy"><p>{t.category}</p><h3>{t.title} <ArrowUpRight size={19} /></h3><span>{t.description}</span></div></a>)}</div></section>
    <section data-reveal className="canvas-story page-width"><div className="story-visual"><div className="story-grid"><div className="story-image"><img width="1536" height="1024" loading="lazy" src="/images/studio-products.jpg" alt="在画板上组织商品图片的示意" /><span>品牌场景 / 版本 01</span></div><div className="story-prompt"><span>你的创作指令</span><p>“保留产品的真实细节，试试自然侧光和暖白背景。”</p><a href="/workspace?template=editorial">用这个方向开始 <ArrowUpRight size={15} /></a></div></div></div><div className="story-copy"><p className="eyebrow">为持续创作留出空间</p><h2>好作品，<br />值得慢慢打磨。</h2><p>让参考图和生成结果并排呈现。选中图片继续调整，把每一次版本都留在画布上。你的素材库与云端画板随账号保存。</p><a className="btn-text" href="/workspace">打开你的画布 <ArrowRight size={16} /></a><div className="story-features"><span><Check size={15} />个人云端保存</span><span><Check size={15} />自然语言图像编辑</span><span><Check size={15} />批量下载与项目备份</span></div></div></section>
    <section data-reveal className="open-source-story page-width"><div className="story-copy"><p className="eyebrow">OPEN SOURCE / CONNECT YOUR IDEAS</p><h2>让创作步骤，<br />成为你的方法。</h2><p>连接图片、提示词和模型，把一次成功的尝试变成可复用的节点工作流。源码采用 MIT 许可，也欢迎你继续构建。</p><a className="btn-text" href="/docs/workflows">了解节点工作流 <ArrowRight size={16} /></a></div><a href="/docs/workflows" className="workflow-preview"><img src="/images/workflow-preview.png" width="1338" height="775" loading="lazy" alt="CraftCanvas 节点工作流：图片连接旋转处理与输出节点，可在右侧调整步骤参数" /></a></section>
    <section data-reveal className="landing-faq page-width"><div><p className="eyebrow">开始前的几个问题</p><h2>安心开始，<br />清楚使用。</h2></div><div>{FAQ.map(([q, a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
    <section data-reveal className="start-banner page-width"><div><p className="eyebrow">让你的下一个想法落地</p><h2>一张实拍，就是起点。</h2></div><a href="/workspace" className="btn-primary">进入创作工作台 <ArrowUpRight size={18} /></a></section>
  </main></ProductShell>;
}
