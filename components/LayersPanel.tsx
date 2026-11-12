import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CanvasNodeData } from '../types';
import {
  Layers, Lock, LockOpen, Eye, EyeOff, ChevronUp, ChevronDown, ChevronRight, X,
  ImageIcon, Loader2, AlertCircle, WandSparkles, Download,
} from 'lucide-react';

import Tip from './Tip';

interface LayersPanelProps {
  nodes: CanvasNodeData[];
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onToggleLock: (id: string) => void;
  onToggleHide: (id: string) => void;
  onMoveLayer: (id: string, dir: 'up' | 'down') => void;
  onFlyTo: (id: string) => void;
  onClose: () => void;
  /** 图片内部图层 */
  onDecompose: (nodeId: string) => void;
  onToggleNodeLayer: (nodeId: string, layerId: string) => void;
  onDownloadLayer: (nodeId: string, layerId: string) => void;
  /** 双击名称重命名 */
  onRename: (nodeId: string, label: string) => void;
  /** 拖动排序：把 dragId 移到 targetId 的层级位置 */
  onReorder: (dragId: string, targetId: string) => void;
}

const LayersPanel: React.FC<LayersPanelProps> = ({
  nodes, selectedIds, onSelect, onToggleLock, onToggleHide, onMoveLayer, onFlyTo, onClose,
  onDecompose, onToggleNodeLayer, onDownloadLayer, onRename, onReorder,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const dragImage = useRef<HTMLCanvasElement | null>(null);
  const dragNode = dragId ? nodes.find(node => node.id === dragId) : null;
  useEffect(() => {
    if (!dragId) return;
    const move = (event: DragEvent) => setDragPoint({ x: event.clientX, y: event.clientY });
    const end = () => { setDragId(null); setDragOverId(null); setDragPoint(null); };
    window.addEventListener('dragover', move);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragover', move);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
      dragImage.current?.remove(); dragImage.current = null;
    };
  }, [dragId]);
  const toggleExpand = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 数组末尾 = 渲染最上层 → 面板倒序展示（顶层在上，Figma 习惯）；搜索过滤
  const q = query.trim().toLowerCase();
  const ordered = [...nodes].reverse().filter(n => !q || n.label.toLowerCase().includes(q));
  return (
    <><div
      data-canvas-ui
      className="absolute left-4 top-16 z-40 flex max-h-[62vh] w-64 flex-col rounded-2xl border border-ink-200/70 bg-white/95 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-left-2 duration-200"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-ink-100 px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-black text-ink-800">
          <Layers className="h-3.5 w-3.5 text-accent-600" /> 图层 · {nodes.length}
        </span>
        <Tip label="关闭图层面板">
          <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
      {/* 图层搜索 */}
      <div className="border-b border-ink-100 px-2.5 py-1.5">
        <input
          aria-label="搜索图层"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索图层…"
          className="w-full rounded-lg border border-transparent bg-ink-100/60 px-2.5 py-1.5 text-[11px] text-ink-700 outline-none transition-colors placeholder:text-ink-300 focus:border-accent-300 focus:bg-white"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {ordered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-ink-400">{q ? '没有匹配的图层' : '画板还没有内容'}</p>
        )}
        {ordered.map(n => {
          const selected = selectedIds.has(n.id);
          const hasLayers = Boolean(n.layers?.length);
          const isOpen = expanded.has(n.id);
          return (
            <React.Fragment key={n.id}>
              <div
                role="group"
                aria-label={`图层：${n.label}`}
                draggable={!q && renamingId !== n.id}
                onDragStart={(e) => {
                  setDragId(n.id); setDragPoint({ x: e.clientX, y: e.clientY });
                  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id);
                  // The OS drag bitmap is transparent; the product renders its own card.
                  const blank = document.createElement('canvas'); blank.width = 1; blank.height = 1;
                  blank.style.cssText = 'position:fixed;left:-100px;top:-100px;pointer-events:none';
                  document.body.appendChild(blank); dragImage.current = blank;
                  e.dataTransfer.setDragImage(blank, 0, 0);
                }}
                onDragOver={(e) => { if (dragId && dragId !== n.id) { e.preventDefault(); setDragOverId(n.id); } }}
                onDragLeave={() => setDragOverId(prev => (prev === n.id ? null : prev))}
                onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== n.id) onReorder(dragId, n.id); setDragId(null); setDragOverId(null); }}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                onClick={(e) => { onSelect(n.id, e.shiftKey || e.metaKey || e.ctrlKey); }}
                onDoubleClick={() => onFlyTo(n.id)}
                className={`group flex cursor-pointer items-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors ${selected ? 'bg-accent-50/80 ring-1 ring-accent-200' : 'hover:bg-ink-100/70'} ${dragOverId === n.id ? 'ring-2 ring-accent-400' : ''} ${dragId === n.id ? 'opacity-40' : ''}`}
              >
                {/* 展开箭头（已分解才显示） */}
                {hasLayers ? (
                  <Tip label={isOpen ? '收起图层' : '展开图层'}><button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                    aria-expanded={isOpen}
                    className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-400 hover:text-accent-600"
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button></Tip>
                ) : <span className="w-4 shrink-0" />}
                {/* 缩略图 / 状态 */}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-200 bg-white">
                  {n.status === 'processing' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-500" />
                    : n.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                    : n.url ? <img src={n.url} draggable={false} className="h-full w-full object-cover" alt="" />
                    : <ImageIcon className="h-3.5 w-3.5 text-ink-300" />}
                </span>
                {renamingId === n.id ? (
                  <input
                    autoFocus
                    aria-label={`重命名图层：${n.label}`}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { onRename(n.id, renameValue); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => { onRename(n.id, renameValue); setRenamingId(null); }}
                    className="min-w-0 flex-1 rounded-md border border-accent-300 bg-white px-1.5 py-0.5 text-[11px] font-bold text-ink-800 outline-none"
                  />
                ) : (
                  <Tip label="点击选中 · 双击或 F2 重命名 · 拖动排序" className="min-w-0 flex-1"><button
                    aria-label={`选中图层：${n.label}`}
                    aria-pressed={selected}
                    onClick={(e) => { e.stopPropagation(); onSelect(n.id, e.shiftKey || e.metaKey || e.ctrlKey); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'F2') { e.preventDefault(); setRenamingId(n.id); setRenameValue(n.label); }
                      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); onMoveLayer(n.id, e.key === 'ArrowUp' ? 'up' : 'down'); }
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(n.id); setRenameValue(n.label); }}
                    className={`w-full truncate text-left text-[11px] font-bold ${n.hidden ? 'text-ink-300 line-through' : 'text-ink-700'}`}
                  >
                    {n.label}
                    {hasLayers && <span className="ml-1 rounded bg-accent-50 px-1 py-px text-[9px] font-black text-accent-600">{n.layers!.length} 层</span>}
                  </button></Tip>
                )}
                {/* 行内操作 */}
                <span className="flex shrink-0 items-center gap-0.5">
                  {!hasLayers && n.status === 'completed' && n.url && !n.refId && (
                    <Tip label="AI 分解为 背景/主体/文字 图层">
                      <button onClick={(e) => { e.stopPropagation(); onDecompose(n.id); }} className="flex h-5.5 w-5.5 items-center justify-center rounded-md text-ink-300 opacity-0 transition-all hover:text-accent-600 group-hover:opacity-100 group-focus-within:opacity-100">
                        <WandSparkles className="h-3 w-3" />
                      </button>
                    </Tip>
                  )}
                  <span className={`flex items-center gap-0.5 ${n.locked || n.hidden ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'}`}>
                    <Tip label={n.locked ? '解锁（恢复拖动）' : '锁定（禁止拖动）'}>
                      <button onClick={(e) => { e.stopPropagation(); onToggleLock(n.id); }} className={`flex h-5.5 w-5.5 items-center justify-center rounded-md transition-colors ${n.locked ? 'text-amber-500' : 'text-ink-300 hover:text-ink-600'}`}>
                        {n.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                      </button>
                    </Tip>
                    <Tip label={n.hidden ? '显示' : '隐藏'}>
                      <button onClick={(e) => { e.stopPropagation(); onToggleHide(n.id); }} className={`flex h-5.5 w-5.5 items-center justify-center rounded-md transition-colors ${n.hidden ? 'text-accent-600' : 'text-ink-300 hover:text-ink-600'}`}>
                        {n.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </Tip>
                  </span>
                  <span className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Tip label="上移一层">
                      <button onClick={(e) => { e.stopPropagation(); onMoveLayer(n.id, 'up'); }} className="flex h-3.5 w-4 items-center justify-center text-ink-300 hover:text-accent-600">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                    </Tip>
                    <Tip label="下移一层">
                      <button onClick={(e) => { e.stopPropagation(); onMoveLayer(n.id, 'down'); }} className="flex h-3.5 w-4 items-center justify-center text-ink-300 hover:text-accent-600">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </Tip>
                  </span>
                </span>
              </div>

              {/* 图片内部图层（展开态，顶层在上） */}
              {hasLayers && isOpen && [...n.layers!].reverse().map(l => (
                <div key={l.id} className="group ml-6 flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-ink-100/60">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-200"
                    style={{ backgroundImage: 'repeating-conic-gradient(#efedea 0% 25%, #ffffff 0% 50%)', backgroundSize: '8px 8px' }}>
                    <img src={l.url} className="h-full w-full object-cover" alt="" />
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[10.5px] font-bold ${l.hidden ? 'text-ink-300 line-through' : 'text-ink-600'}`}>{l.name}</span>
                  <Tip label={l.hidden ? '显示该层' : '隐藏该层'}>
                    <button onClick={() => onToggleNodeLayer(n.id, l.id)} className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${l.hidden ? 'text-accent-600' : 'text-ink-300 hover:text-ink-600'}`}>
                      {l.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </Tip>
                  <Tip label="下载该层 PNG">
                    <button onClick={() => onDownloadLayer(n.id, l.id)} className="flex h-5 w-5 items-center justify-center rounded text-ink-300 opacity-0 transition-all hover:text-accent-600 group-hover:opacity-100 group-focus-within:opacity-100">
                      <Download className="h-3 w-3" />
                    </button>
                  </Tip>
                </div>
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
      {dragNode && dragPoint && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-[260] flex w-56 items-center gap-3 rounded-2xl border border-accent-200 bg-white p-3 shadow-2xl shadow-accent-900/15"
        style={{ left: Math.max(8, Math.min(dragPoint.x + 16, window.innerWidth - 232)), top: Math.max(8, Math.min(dragPoint.y + 16, window.innerHeight - 76)), transform: 'rotate(-3deg)' }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100">{dragNode.url ? <img src={dragNode.url} alt="" className="h-full w-full object-cover" /> : <Layers className="h-5 w-5 text-accent-600" />}</span>
        <span className="min-w-0"><span className="block truncate text-xs font-bold text-ink-800">{dragNode.label}</span><span className="mt-1 block text-[10px] text-accent-600">{dragOverId ? '松开调整图层顺序' : '拖至目标图层'}</span></span>
      </div>, document.body)}
    </>
  );
};

export default LayersPanel;
