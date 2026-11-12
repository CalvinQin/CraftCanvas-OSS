import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Type, Sparkles, Scissors, RotateCw, Download, X, Minus, Plus, Maximize, Loader2, Check, AlertCircle } from 'lucide-react';
import { NODE_META, type WorkflowGraph, type WorkflowKind, type PortKind } from '../workflow/types';

export const WORKFLOW_ICONS = { image: ImagePlus, prompt: Type, generate: Sparkles, cutout: Scissors, transform: RotateCw, output: Download };
const W = 250; const H = 264;
const inputY = (port: PortKind) => port === 'text' ? 76 : 108;

export default function WorkflowCanvas({ graph, selected, onSelect, onMove, onConnect, onRemoveEdge, onAdd, disabled, fitKey }: {
  graph: WorkflowGraph; selected: string | null; onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void; onConnect(source: string, target: string, port: PortKind): void;
  onRemoveEdge(id: string): void; onAdd(kind: WorkflowKind, x: number, y: number): void; disabled: boolean; fitKey: number;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 35, y: 40, k: .8 }); const viewRef = useRef(view); viewRef.current = view;
  const [link, setLink] = useState<{ id: string; port: PortKind } | null>(null);
  const drag = useRef<{ id?: string; x: number; y: number; originX: number; originY: number } | null>(null);
  const fit = () => {
    if (!surface.current || !graph.nodes.length) { setView({ x: 35, y: 40, k: .8 }); return; }
    const left = Math.min(...graph.nodes.map(n => n.x)); const top = Math.min(...graph.nodes.map(n => n.y));
    const width = Math.max(...graph.nodes.map(n => n.x + W)) - left; const height = Math.max(...graph.nodes.map(n => n.y + H)) - top;
    const { clientWidth: w, clientHeight: h } = surface.current; const k = Math.max(.25, Math.min(1, (w - 90) / width, (h - 100) / height));
    setView({ k, x: (w - width * k) / 2 - left * k, y: (h - height * k) / 2 - top * k });
  };
  useEffect(() => { fit(); setLink(null); }, [fitKey]);
  useEffect(() => { if (disabled) setLink(null); }, [disabled]);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
        setView(v => { const k = Math.min(1.5, Math.max(.25, v.k * Math.exp(-event.deltaY * .005))); return { k, x: x - (x - v.x) * k / v.k, y: y - (y - v.y) * k / v.k }; });
      } else setView(v => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  const zoom = (factor: number) => setView(v => { const k = Math.max(.25, Math.min(1.5, v.k * factor)); const x = (surface.current?.clientWidth || 600) / 2, y = (surface.current?.clientHeight || 500) / 2; return { k, x: x - (x - v.x) * k / v.k, y: y - (y - v.y) * k / v.k }; });
  return <div ref={surface} className="wf-surface" role="region" aria-label="节点工作流画布" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}
    onPointerDown={e => { if (e.button !== 0 || (e.target as HTMLElement).closest('button, .wf-node, .wf-zoom')) return; drag.current = { x: e.clientX, y: e.clientY, originX: view.x, originY: view.y }; e.currentTarget.setPointerCapture(e.pointerId); onSelect(null); }}
    onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (d.id) onMove(d.id, Math.max(-20000, Math.min(20000, d.originX + dx / view.k)), Math.max(-20000, Math.min(20000, d.originY + dy / view.k))); else setView(v => ({ ...v, x: d.originX + dx, y: d.originY + dy })); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onDragOver={e => { if (e.dataTransfer.types.includes('application/craftcanvas-node')) e.preventDefault(); }}
    onDrop={e => { e.preventDefault(); if (disabled) return; const kind = e.dataTransfer.getData('application/craftcanvas-node') as WorkflowKind; if (!Object.hasOwn(NODE_META, kind)) return; const rect = e.currentTarget.getBoundingClientRect(); onAdd(kind, (e.clientX - rect.left - view.x) / view.k, (e.clientY - rect.top - view.y) / view.k); }}>
    <div className="wf-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
      <svg className="wf-wires" aria-hidden="true">
        {graph.edges.map(edge => {
          const a = graph.nodes.find(n => n.id === edge.source), b = graph.nodes.find(n => n.id === edge.target); if (!a || !b) return null;
          const x1 = a.x + W, y1 = a.y + 88, x2 = b.x, y2 = b.y + inputY(edge.port); const c = Math.max(70, Math.abs(x2 - x1) * .45);
          return <path key={edge.id} d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`} className={`wf-wire ${edge.port} ${a.status === 'success' ? 'complete' : ''} ${a.status === 'running' ? 'running' : ''}`} />;
        })}
      </svg>
      {graph.edges.map(edge => { const a = graph.nodes.find(n => n.id === edge.source), b = graph.nodes.find(n => n.id === edge.target); if (!a || !b) return null; return <button key={edge.id} className="wf-edge-remove" disabled={disabled} style={{ left: (a.x + W + b.x) / 2 - 10, top: (a.y + 88 + b.y + inputY(edge.port)) / 2 - 10 }} aria-label={`移除连线：${a.label} → ${b.label}`} onClick={() => onRemoveEdge(edge.id)}><X size={12} /></button>; })}
      {graph.nodes.map((node, index) => {
        const meta = NODE_META[node.kind]; const Icon = WORKFLOW_ICONS[node.kind]; const image = node.output?.kind === 'image' ? node.output.value : node.config.image;
        return <article key={node.id} className={`wf-node ${selected === node.id ? 'selected' : ''} status-${node.status}`} style={{ left: node.x, top: node.y, width: W, height: H }} data-node-id={node.id} aria-label={`${node.label}节点`} onClick={() => onSelect(node.id)}>
          <button className="wf-node-heading" aria-label={`配置节点：${node.label}`} onPointerDown={e => { if (disabled || e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: node.id, x: e.clientX, y: e.clientY, originX: node.x, originY: node.y }; onSelect(node.id); }}>
            <span className={`wf-icon ${meta.color}`}><Icon size={16} /></span><strong>{node.label}</strong><span className="wf-node-number">{String(index + 1).padStart(2, '0')}</span>
          </button>
          {meta.inputs.map(port => <div key={port} className="wf-input-label" style={{ top: inputY(port) - 10 }}><button disabled={disabled} className={`wf-port ${port} ${link?.port === port && link.id !== node.id ? 'ready' : ''}`} aria-label={`${node.label}的${port === 'text' ? '提示词' : '图片'}输入`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (link) { if (link.port === port) { onConnect(link.id, node.id, port); setLink(null); } } else onSelect(node.id); }} /><span>{port === 'text' ? '提示词' : node.kind === 'generate' ? '参考图 · 可选' : '图片'}</span></div>)}
          {meta.output && <button disabled={disabled} className={`wf-port wf-out ${meta.output} ${link?.id === node.id ? 'ready' : ''}`} aria-label={`${node.label}的${meta.output === 'text' ? '提示词' : '图片'}输出`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setLink(link?.id === node.id ? null : { id: node.id, port: meta.output! }); }} />}
          <div className={`wf-node-content ${meta.inputs.length ? 'has-inputs' : ''}`}>
            {image ? <img src={image} alt={`${node.label}预览`} draggable={false} /> : node.kind === 'prompt' ? <p>{node.config.prompt || '选择节点，填写你的创作要求…'}</p> : <div className="wf-node-placeholder"><Icon size={24} /><span>{node.kind === 'image' ? '点击节点上传图片' : node.kind === 'generate' ? '等待模型生成' : '等待上游图片'}</span></div>}
          </div>
          <div className="wf-node-status">{node.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : node.status === 'success' ? <Check size={13} /> : ['error', 'blocked'].includes(node.status) ? <AlertCircle size={13} /> : <span className="wf-status-dot" />}<span>{({ idle: '待运行', running: '执行中', success: '已完成 · 可复用', error: '执行失败', blocked: '等待上游' })[node.status]}</span></div>
        </article>;
      })}
    </div>
    {link && <div className="wf-link-hint" role="status">点击下游节点的{link.port === 'text' ? '提示词' : '图片'}输入端口<button onClick={() => setLink(null)} aria-label="取消连线"><X size={15} /></button></div>}
    {!graph.nodes.length && <div className="wf-empty-canvas"><Sparkles size={32} /><h2>从第一个节点开始</h2><p>拖入左侧节点，或点击添加。连接端口，把步骤串起来。</p></div>}
    <div className="wf-zoom"><button aria-label="缩小工作流" onClick={() => zoom(.85)}><Minus size={16} /></button><span>{Math.round(view.k * 100)}%</span><button aria-label="放大工作流" onClick={() => zoom(1.15)}><Plus size={16} /></button><button aria-label="适配整个工作流" onClick={fit}><Maximize size={16} /></button></div>
    <span className="wf-canvas-tip">拖动节点或空白处 · ⌘/Ctrl + 滚轮缩放</span>
  </div>;
}
