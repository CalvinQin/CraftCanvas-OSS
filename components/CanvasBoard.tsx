import React, { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { CanvasNodeData, GenRun, NodePin } from '../types';
import { ENGINES } from '../services/engine';
import type { IdentifiedElement } from '../services/geminiService';
import {
  Loader2, Download, Maximize2, RefreshCw, Trash2, Plus, Minus, Frame, UploadCloud,
  MousePointer2, Hand, Sparkles, Shuffle, ZoomIn, Scissors, MoveHorizontal, Pin,
  ImagePlus, Copy, Layers, X, Send, ListPlus, Play, MessageSquareText, MoreHorizontal,
  MousePointerClick, Type, PenTool, Eraser, Move, Image as ImageIcon,
  LayoutGrid, Square, Pencil, Images, Clapperboard, WandSparkles, Check,
  Circle, Slash, ArrowUpRight, Triangle, Star, Lock, LockOpen,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react';
import Tip from './Tip'; // 悬浮中文提示（portal 版防遮挡）
import { useMenuNavigation } from '../services/useMenuNavigation';

// 画板标注（纯前端矢量圈注，不调 AI）
type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'polygon' | 'star';
export type Annotation =
  | { id: string; kind: ShapeKind; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'draw'; points: { x: number; y: number }[] }
  | { id: string; kind: 'text'; x: number; y: number; text: string }
  // 引线标注：(x,y)=指向的目标点，(tx,ty)=文字框位置，一条引线连接二者
  | { id: string; kind: 'label'; x: number; y: number; tx: number; ty: number; text: string };

export interface RestorePayload {
  view: { x: number; y: number; k: number } | null;
  annotations: Annotation[];
  fitIfNoView: boolean;
}

const SHAPE_MENU: { kind: ShapeKind | 'label'; label: string; hotkey: string }[] = [
  { kind: 'rect', label: '矩形', hotkey: 'R' },
  { kind: 'line', label: '线条', hotkey: 'L' },
  { kind: 'arrow', label: '箭头', hotkey: '⇧L' },
  { kind: 'ellipse', label: '椭圆', hotkey: 'O' },
  { kind: 'polygon', label: '多边形', hotkey: '' },
  { kind: 'star', label: '星形', hotkey: '' },
  { kind: 'label', label: '引线标注', hotkey: '' },
];

function polygonPoints(x: number, y: number, w: number, h: number, sides: number): string {
  const cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push(`${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`);
  }
  return pts.join(' ');
}
function starPoints(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2, cy = y + h / 2, rx = Math.abs(w) / 2, ry = Math.abs(h) / 2;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const f = i % 2 === 0 ? 1 : 0.42;
    pts.push(`${cx + rx * f * Math.cos(a)},${cy + ry * f * Math.sin(a)}`);
  }
  return pts.join(' ');
}

const SHAPE_ICONS: Record<ShapeKind, React.ReactNode> = {
  rect: <Square className="h-4 w-4" />,
  line: <Slash className="h-4 w-4" />,
  arrow: <ArrowUpRight className="h-4 w-4" />,
  ellipse: <Circle className="h-4 w-4" />,
  polygon: <Triangle className="h-4 w-4" />,
  star: <Star className="h-4 w-4" />,
};

interface Transform { x: number; y: number; k: number }
interface Rect { x: number; y: number; w: number; h: number }

export interface CanvasBoardHandle {
  flyToRect(rect: Rect): void;
  flyToNode(nodeId: string): void;
  fitAll(): void;
  /** 屏幕坐标 → 世界坐标；不在画板范围内返回 null */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null;
  /** 当前视口中心的世界坐标 */
  getCenterWorld(): { x: number; y: number };
  /** 读取/恢复视图变换（持久化用） */
  getViewTransform(): { x: number; y: number; k: number };
  setViewTransform(t: { x: number; y: number; k: number }): void;
  /** 读取/恢复画布标注层（持久化用；标注是项目数据，刷新不应丢失） */
  getAnnotations(): Annotation[];
  setAnnotations(list: Annotation[]): void;
  /** 取与某节点图片区域相交的标注，坐标归一化到该图片区域 [0,1]（生成时烧图给 AI 用） */
  getNodeAnnotations(nodeId: string): Annotation[];
}

type ArmedMode = 'pin' | 'element' | 'text' | 'erase' | 'move';

interface CanvasBoardProps {
  nodes: CanvasNodeData[];
  runs: GenRun[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onMoveNodes: (ids: string[], dx: number, dy: number) => void;
  onPreview: (nodeId: string) => void;
  onRetry: (nodeId: string) => void;
  onDelete: (ids: string[]) => void;
  onDownloadNode: (nodeId: string) => void;
  onDownloadJpg: (nodeId: string) => void;
  onDownloadPdf: (nodeId: string) => void;
  onDecomposeLayers: (nodeId: string) => void;
  /** 多选对齐 / 分布 */
  onAlign: (type: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
  onDistribute: (axis: 'h' | 'v') => void;
  /** 文本一等元素 */
  onCreateText: (at: { x: number; y: number }) => void;
  onUpdateNodeText: (nodeId: string, text: string) => void;
  /** Resize 手柄 / 属性精确输入 */
  onSetNodeFrame: (nodeId: string, frame: { x?: number; y?: number; w?: number; h?: number; fontSize?: number; opacity?: number }) => void;
  onReplaceImage: (nodeId: string) => void;
  onExportSelection: () => void;
  onCutSelection: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: (nodeId: string) => void;
  onToggleHide: (nodeId: string) => void;
  onMoveLayerStep: (nodeId: string, dir: 'up' | 'down') => void;
  onRevealInLayers: (nodeId: string) => void;
  onTransformNode: (nodeId: string, op: 'rot90' | 'flipH' | 'flipV') => void;
  onCopyStyle: (nodeId: string) => void;
  onPasteStyle: (ids: string[]) => void;
  canvasBg: string | null;
  onSetCanvasBg: (color: string | null) => void;
  /** 图层面板是否打开（打开时顶部居中工具条右移，避免被面板遮挡） */
  leftPanelOpen?: boolean;
  /** Explicit layout commands animate; ordinary pointer drags retain direct positioning. */
  layoutMotionKey?: number;
  /** 标注层变化时通知（App 据此触发自动保存） */
  onAnnotationsChange?: () => void;
  /** 图片自然尺寸就绪：App 据此把节点高度贴合图片比例（消除白底相框） */
  onImageNaturalSize: (nodeId: string, naturalW: number, naturalH: number) => void;
  /** 恢复视图+标注（由 CanvasBoard 自身在 mount 后应用，StrictMode 安全） */
  restorePayload: RestorePayload | null;
  onDownloadRun: (runId: string) => void;
  onUploadClick: () => void;
  hasRefs: boolean;
  onVariation: (nodeId: string) => void;
  onUpscale: (nodeId: string) => void;
  onCutout: (nodeId: string) => void;
  onOutpaint: (nodeId: string) => void;
  onUseAsRef: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onExportPsd: (nodeId: string) => void;
  onExportSvg: (nodeId: string) => void;
  onUpdatePins: (nodeId: string, pins: NodePin[]) => void;
  onRunPins: (nodeId: string, pins: NodePin[]) => void;
  /** Frame 独立子对话入口 */
  onOpenRunChat: (runId: string) => void;
  /** Touch Edit：识别点击处元素 */
  onIdentifyElement: (nodeId: string, xPct: number, yPct: number, focus: 'element' | 'text') => Promise<IdentifiedElement | null>;
  /** Touch Edit：执行直改 */
  onTouchEdit: (nodeId: string, xPct: number, yPct: number, element: string, instruction: string) => void;
  /** 底部工具坞 */
  onArrange: () => void;
  /** 拖动/删除等修改前推入撤销历史 */
  onBeforeMove: () => void;
  onBringToFront: (ids: string[]) => void;
  onSendToBack: (ids: string[]) => void;
  onCopySelection: () => void;
  onPasteClipboard: () => void;
  onSelectAll: () => void;
  onTextToImage: () => void;
  onImageToImage: () => void;
  onImageToVideo: () => void;
}

const MIN_K = 0.12;
const MAX_K = 4;
const DOT_GAP = 26;
const NODE_FOOTER = 44;
const FRAME_PAD = 22;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const uid = () => Math.random().toString(36).slice(2, 9);

// 触点换色快捷色板
const RECOLOR_SWATCHES: { name: string; en: string; hex: string }[] = [
  { name: '黑', en: 'black', hex: '#18181B' },
  { name: '白', en: 'pure white', hex: '#FFFFFF' },
  { name: '红', en: 'vivid red', hex: '#DC2626' },
  { name: '蓝', en: 'royal blue', hex: '#2563EB' },
  { name: '金', en: 'metallic gold', hex: '#D4A017' },
  { name: '青', en: 'teal', hex: '#0D9488' },
];

const MOTION_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return reduced;
}

// An indeterminate indicator describes waiting without inventing completion percentages.
const ProcessingOverlay: React.FC<{ label: string; reducedMotion: boolean }> = ({ label, reducedMotion }) => {
  return (
    <div role="status" aria-label={`${label}，处理中`} className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden bg-ink-100">
      {!reducedMotion && <div aria-hidden="true" className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />}
      <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-100 bg-white shadow-lg shadow-accent-500/10">
        <Loader2 aria-hidden="true" className={`h-7 w-7 text-accent-600 ${reducedMotion ? '' : 'animate-spin'}`} />
      </div>
      <p className="relative z-10 mt-4 text-[11px] font-bold uppercase tracking-widest text-ink-500">{label}</p>
      <p className="relative z-10 mt-2 text-[10px] text-ink-400">处理中 · 完成后自动入板</p>
      <div aria-hidden="true" className="relative z-10 mt-3 flex gap-1.5"><span className="h-1 w-6 rounded-full bg-accent-300" /><span className="h-1 w-6 rounded-full bg-accent-200" /><span className="h-1 w-6 rounded-full bg-accent-100" /></div>
    </div>
  );
};

const CanvasFrame: React.FC<{ rect: Rect; reducedMotion: boolean }> = ({ rect, reducedMotion }) => {
  const borderRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const animation = borderRef.current?.animate([
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 560, easing: MOTION_EASE });
    return () => animation?.cancel();
  }, [reducedMotion]);
  return <div ref={borderRef} data-layout-chrome className="pointer-events-none absolute rounded-3xl border-2 border-dashed border-ink-300/70" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />;
};

const DerivationLink: React.FC<{ path: string; reducedMotion: boolean }> = ({ path, reducedMotion }) => {
  const pathRef = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const element = pathRef.current;
    if (reducedMotion || !element) return;
    const length = element.getTotalLength();
    const animation = element.animate([
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: length, opacity: 0 },
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0, opacity: 1 },
    ], { duration: 680, easing: MOTION_EASE });
    return () => animation?.cancel();
  }, [reducedMotion]);
  return <path ref={pathRef} d={path} fill="none" stroke="#6E56CF" strokeWidth={1.5} strokeOpacity={0.45} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />;
};


// Lovart 式快捷编辑按钮（图标+文字）
const QuickButton: React.FC<{
  tip: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
  iconOnly?: boolean;
  icon: React.ReactNode;
  label?: string;
  menuOpen?: boolean;
  menuId?: string;
}> = ({ tip, onClick, danger, accent, iconOnly, icon, label, menuOpen, menuId }) => (
  <Tip label={tip}>
    <button
      onClick={onClick}
      aria-label={tip}
      aria-haspopup={menuOpen === undefined ? undefined : 'menu'}
      aria-expanded={menuOpen}
      aria-controls={menuId}
      className={`flex h-9 items-center gap-1.5 rounded-lg text-[12px] font-bold transition-colors ${iconOnly ? 'w-9 justify-center' : 'px-2.5'} ${
        danger ? 'text-ink-500 hover:bg-red-50 hover:text-red-500'
          : accent ? 'bg-amber-500/90 text-white hover:bg-amber-500'
          : 'text-ink-700 hover:bg-ink-100 hover:text-accent-700'
      }`}
    >
      {icon}
      {!iconOnly && label}
    </button>
  </Tip>
);

const CanvasNode: React.FC<{
  node: CanvasNodeData;
  selected: boolean;
  reducedMotion: boolean;
  entranceDelay: number;
  armed: ArmedMode | null;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onPlacePoint: (nodeId: string, xPct: number, yPct: number, mode: ArmedMode) => void;
  onPreview: (id: string) => void;
  onImageDblClick: (id: string) => void;
  onRetry: (id: string) => void;
  onStartEditText: (id: string) => void;
  onNaturalSize: (id: string, w: number, h: number) => void;
}> = React.memo(({ node, selected, reducedMotion, entranceDelay, armed, onPointerDown, onPlacePoint, onPreview, onImageDblClick, onRetry, onStartEditText, onNaturalSize }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const animation = cardRef.current?.animate([
      { opacity: 0, transform: 'translateY(18px) scale(0.97)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 440, delay: entranceDelay, fill: 'backwards', easing: MOTION_EASE });
    return () => animation?.cancel();
  }, [node.id, reducedMotion]);
  useLayoutEffect(() => {
    if (!node.url || reducedMotion) return;
    const animation = revealRef.current?.animate([
      { opacity: 0, transform: 'translateY(10px) scale(1.035)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 560, easing: MOTION_EASE });
    return () => animation?.cancel();
  }, [node.url, reducedMotion]);
  // 文本一等元素：透明卡片渲染文字，双击进入编辑
  if (node.kind === 'text') {
    return (
      <div
        data-node-id={node.id}
        className="absolute select-none"
        style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h, opacity: node.opacity ?? 1 }}
        onPointerDown={(e) => onPointerDown(e, node.id)}
        onDoubleClick={(e) => { e.stopPropagation(); onStartEditText(node.id); }}
      >
        <div data-node-layout className="h-full w-full" style={{ minHeight: node.h }}>
        <div ref={cardRef} data-node-motion className={`flex h-full w-full items-center justify-center rounded-xl p-2 transition-shadow ${
          selected ? 'cursor-grab ring-2 ring-accent-600 active:cursor-grabbing' : 'cursor-grab ring-1 ring-transparent hover:ring-ink-200 active:cursor-grabbing'
        }`} style={{ minHeight: node.h }}>
        <p
          className="w-full whitespace-pre-wrap break-words text-center font-bold leading-snug"
          style={{ fontSize: node.fontSize ?? 32, color: node.textColor ?? '#18181b' }}
        >
          {node.text || '双击编辑文字'}
        </p>
        </div>
        </div>
      </div>
    );
  }
  return (
    <div
      data-node-id={node.id}
      className="absolute select-none"
      style={{ left: node.x, top: node.y, width: node.w, height: node.h, opacity: node.opacity ?? 1 }}
      onPointerDown={(e) => {
        if (armed && node.url && e.button === 0) {
          e.stopPropagation();
          // 图片区域在标题栏（顶部 NODE_FOOTER 高）之下，据此换算百分比
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const headerPx = rect.height * (NODE_FOOTER / node.h);
          const imgH = rect.height - headerPx;
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const yPct = ((e.clientY - rect.top - headerPx) / imgH) * 100;
          onPlacePoint(node.id, clamp(xPct, 0, 100), clamp(yPct, 0, 100), armed);
          return;
        }
        onPointerDown(e, node.id);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (node.url) onImageDblClick(node.id); }}
    >
      <div data-node-layout className="h-full w-full">
      <div
        ref={cardRef}
        data-node-motion
        className={`flex h-full w-full flex-col overflow-hidden rounded-xl transition-shadow ${
          armed === 'pin' ? 'cursor-crosshair ring-2 ring-amber-500' :
          armed ? 'cursor-crosshair ring-2 ring-accent-500' :
          selected ? 'cursor-grab ring-2 ring-accent-600 shadow-xl shadow-accent-600/10 active:cursor-grabbing' :
          'cursor-grab ring-1 ring-ink-900/5 shadow-sm hover:shadow-lg active:cursor-grabbing'
        }`}
      >
        {/* 标题栏（顶部，图标+标题，Lovart 式）——高度须与 NODE_FOOTER 一致，供图钉/标注坐标换算 */}
        <div className="flex shrink-0 items-center gap-1.5 bg-white px-3" style={{ height: NODE_FOOTER }}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-ink-100 text-ink-400">
            {node.refId ? <ImagePlus className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
          </span>
          <span className="truncate text-[11px] font-bold text-ink-500">{node.label}</span>
          {(node.pins?.length ?? 0) > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-600">
              <Pin className="h-2.5 w-2.5" />{node.pins!.length}
            </span>
          )}
        </div>
        <div className="relative min-h-0 flex-1 bg-ink-50">
          {node.status === 'processing' && <ProcessingOverlay label={node.label} reducedMotion={reducedMotion} />}
          {node.status === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-red-50/60 p-4">
              <p className="text-center text-xs font-bold text-red-500">生成失败</p>
              {node.errorMsg && <p className="line-clamp-3 max-w-full text-center text-[10px] leading-relaxed text-red-400">{node.errorMsg}</p>}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRetry(node.id)}
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-ink-700 shadow-sm transition-all hover:text-accent-700 hover:shadow"
              >
                <RefreshCw className="h-3 w-3" /> 重试
              </button>
            </div>
          )}
          {node.url && !node.layers?.length && (
            <img
              ref={revealRef}
              data-node-motion
              src={node.url}
              alt={node.label}
              draggable={false}
              onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) onNaturalSize(node.id, im.naturalWidth, im.naturalHeight); }}
              className="h-full w-full object-contain"
              style={node.label.includes('抠图') ? {
                backgroundImage: 'repeating-conic-gradient(#efedea 0% 25%, #ffffff 0% 50%)',
                backgroundSize: '20px 20px',
              } : undefined}
            />
          )}
          {/* 图片内部图层：按可见层实时叠加合成（底=数组首层） */}
          {node.layers && node.layers.length > 0 && (
            <div
              className="absolute inset-0 animate-in fade-in duration-300"
              style={{
                backgroundImage: 'repeating-conic-gradient(#efedea 0% 25%, #ffffff 0% 50%)',
                backgroundSize: '20px 20px',
              }}
            >
              {node.layers.filter(l => !l.hidden).map(l => (
                <img
                  key={l.id}
                  src={l.url}
                  alt={l.name}
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              ))}
              {node.layers.every(l => l.hidden) && (
                <p className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-ink-400">所有图层已隐藏</p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
});
CanvasNode.displayName = 'CanvasNode';

interface PinDraft { nodeId: string; xPct: number; yPct: number; editingPinId?: string }
interface TouchDraft {
  nodeId: string;
  xPct: number;
  yPct: number;
  focus: 'element' | 'text';
  intent?: 'erase' | 'move'; // 橡皮=识别后自动移除；移动对象=聚焦自由指令
  status: 'identifying' | 'ready' | 'failed';
  element?: string;
  text?: string | null;
}

const CanvasBoard = forwardRef<CanvasBoardHandle, CanvasBoardProps>(({
  nodes, runs, selectedIds, onSelectionChange, onMoveNodes,
  onPreview, onRetry, onDelete, onDownloadNode, onDownloadJpg, onDownloadPdf, onDecomposeLayers, onAlign, onDistribute, onCreateText, onUpdateNodeText, onSetNodeFrame, onReplaceImage, onExportSelection, onCutSelection, onGroup, onUngroup, onToggleLock, onToggleHide, onMoveLayerStep, onRevealInLayers, onTransformNode, onCopyStyle, onPasteStyle, canvasBg, onSetCanvasBg, leftPanelOpen, onAnnotationsChange, onImageNaturalSize, restorePayload, onDownloadRun, onUploadClick, hasRefs,
  onVariation, onUpscale, onCutout, onOutpaint, onUseAsRef, onDuplicate, onExportPsd, onExportSvg,
  onUpdatePins, onRunPins, onOpenRunChat, onIdentifyElement, onTouchEdit,
  onArrange, onTextToImage, onImageToImage, onImageToVideo,
  onBeforeMove, onBringToFront, onSendToBack, onCopySelection, onPasteClipboard, onSelectAll, layoutMotionKey = 0,
}, ref) => {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const tRef = useRef<Transform>({ x: 140, y: 110, k: 0.9 });
  const rafRef = useRef<number | null>(null);
  const flyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutAnimationsRef = useRef<Animation[]>([]);
  const layoutSnapshotRef = useRef({ key: layoutMotionKey, positions: new Map<string, { x: number; y: number }>() });
  const cancelLayoutMotion = useCallback(() => {
    layoutAnimationsRef.current.forEach(animation => animation.cancel());
    layoutAnimationsRef.current = [];
  }, []);
  useLayoutEffect(() => {
    const previous = layoutSnapshotRef.current;
    if (previous.key !== layoutMotionKey) {
      cancelLayoutMotion();
      if (!reducedMotion) {
        let index = 0;
        nodes.forEach(node => {
          const from = previous.positions.get(node.id);
          if (!from || node.hidden || (from.x === node.x && from.y === node.y)) return;
          const visual = worldRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"] [data-node-layout]`);
          if (!visual) return;
          // Animate a visual child: the world position and pointer coordinate element stay final.
          layoutAnimationsRef.current.push(visual.animate([
            { transform: `translate(${from.x - node.x}px, ${from.y - node.y}px)` },
            { transform: 'translate(0, 0)' },
          ], { duration: 420, delay: Math.min(index++ * 24, 120), easing: MOTION_EASE, fill: 'backwards' }));
        });
        if (index) worldRef.current?.querySelectorAll<HTMLElement | SVGElement>('[data-layout-chrome]').forEach(element => {
          layoutAnimationsRef.current.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 280, fill: 'backwards' }));
        });
      }
    }
    if (reducedMotion) cancelLayoutMotion();
    layoutSnapshotRef.current = { key: layoutMotionKey, positions: new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }])) };
  }, [nodes, layoutMotionKey, reducedMotion, cancelLayoutMotion]);
  useEffect(() => cancelLayoutMotion, [cancelLayoutMotion]);

  const [view, setView] = useState<Transform>({ ...tRef.current });
  const [tool, setTool] = useState<'select' | 'hand' | 'pin' | 'shape' | 'draw' | 'text'>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind | 'label'>('rect');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeKindRef = useRef(shapeKind);
  shapeKindRef.current = shapeKind;
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null); // 选中的标注（可 Delete 删除）
  // 标注世界坐标 bbox（选中高亮框 + 删除按钮锚点用）
  const annBBox = (a: Annotation) => {
    if (a.kind === 'draw') {
      const xs = a.points.map(p => p.x), ys = a.points.map(p => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    if (a.kind === 'text') return { x0: a.x, y0: a.y - 20, x1: a.x + 60, y1: a.y + 6 };
    if (a.kind === 'label') return { x0: Math.min(a.x, a.tx), y0: Math.min(a.y, a.ty - 18), x1: Math.max(a.x, a.tx + 70), y1: Math.max(a.y, a.ty) };
    return { x0: Math.min(a.x, a.x + a.w), y0: Math.min(a.y, a.y + a.h), x1: Math.max(a.x, a.x + a.w), y1: Math.max(a.y, a.y + a.h) };
  };
  // 镜像给 imperative handle 读取（持久化用），并在变化时通知 App 触发自动保存
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const onAnnChangeRef = useRef(onAnnotationsChange);
  onAnnChangeRef.current = onAnnotationsChange;
  useEffect(() => { onAnnChangeRef.current?.(); }, [annotations]);
  const [drawing, setDrawing] = useState<Annotation | null>(null);
  const [annTextDraft, setAnnTextDraft] = useState<{ x: number; y: number } | null>(null);
  const [annTextValue, setAnnTextValue] = useState('');
  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // 右键菜单（屏幕坐标；nodeId 为空表示画板空白处）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  // 属性条 W/H 锁定比例（§10.1）
  const [ratioLock, setRatioLock] = useState(false);
  // 属性条 ↑↓ 步进：600ms 内连续步进合并为一次撤销历史；提交后 input 因 key 重挂需恢复焦点
  const propNudgeTsRef = useRef(0);
  const propNudgeHistory = useCallback(() => {
    if (Date.now() - propNudgeTsRef.current > 600) onBeforeMove();
    propNudgeTsRef.current = Date.now();
  }, [onBeforeMove]);
  const refocusProp = (id: string) => setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>(`input[data-prop="${id}"]`);
    el?.focus();
    el?.select();
  }, 0);
  /** 数字输入通用键处理：Enter 提交；↑↓ 步进（Shift=10）后立即提交并保焦点 */
  const numericKeys = (
    e: React.KeyboardEvent,
    propId: string,
    commit: (v: number) => void,
    opts?: { viaHistory?: boolean },
  ) => {
    const input = e.target as HTMLInputElement;
    if (e.key === 'Enter') {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) { onBeforeMove(); commit(v); }
      input.blur();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseFloat(input.value);
      if (Number.isNaN(cur)) return;
      const v = cur + (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      if (opts?.viaHistory !== false) propNudgeHistory();
      commit(v);
      refocusProp(propId);
    }
  };
  // 尺寸匹配提示（§7.3）：resize 中 W/H 命中其他节点尺寸时吸附并提示
  const [sizeMatchTip, setSizeMatchTip] = useState<string | null>(null);
  // 容器宽度（响应式：窄画布时工具条策略不同）
  const [containerW, setContainerW] = useState(1200);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => setContainerW(el.clientWidth);
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    // 视口变化时 RO 偶发不回调（容器由 flex 撑开），补一层 window resize 兜底
    window.addEventListener('resize', sync);
    sync();
    return () => { ro.disconnect(); window.removeEventListener('resize', sync); };
  }, []);
  // 图层面板避让：仅在让开面板后仍有 ≥320px 可用宽度时才右移；
  // 否则（窄画布）放弃避让，宁可与面板叠放也不让工具条跑出画布
  const PANEL_EDGE = 280; // left-4 + w-64 + 8
  const avoidPanel = Boolean(leftPanelOpen) && containerW - PANEL_EDGE - 8 >= 320;
  const toolbarLeftEdge = avoidPanel ? PANEL_EDGE : 8;
  const toolbarMaxW = Math.max(200, containerW - toolbarLeftEdge - 8);
  // 顶部居中工具条右移半个面板宽 + 限宽（超出可横滑），避免被面板遮挡或溢出画布
  const centerBarStyle = { marginLeft: avoidPanel ? 136 : 0, maxWidth: toolbarMaxW };
  const centerBarCls = 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
  // 快捷编辑条实测宽度（用于水平夹紧；随语言/按钮数变化，不能用固定估值）
  const [quickBarW, setQuickBarW] = useState(760);
  const quickBarObserverRef = useRef<ResizeObserver | null>(null);
  const quickBarRef = useCallback((el: HTMLDivElement | null) => {
    quickBarObserverRef.current?.disconnect();
    quickBarObserverRef.current = null;
    if (!el) return;
    const measure = () => setQuickBarW(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    quickBarObserverRef.current = observer;
  }, []);
  // 进入组内编辑（§7.2）：双击组成员进入，组内点击选单个成员；选中离开该组即自动退出
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  useEffect(() => {
    if (!editingGroupId) return;
    const stillInGroup = [...selectedIds].some(id => nodesRef.current.find(n => n.id === id)?.groupId === editingGroupId);
    if (!stillInGroup) setEditingGroupId(null);
  }, [selectedIds, editingGroupId]);
  // 拖动吸附辅助线（世界坐标；Alt 按住时临时关闭吸附）
  const [snapGuides, setSnapGuides] = useState<{ axis: 'v' | 'h'; pos: number }[]>([]);

  // ---------- 标尺 + 参考线（§7.1）----------
  // v = 垂直参考线（世界 x）；h = 水平参考线（世界 y）。localStorage 持久化。
  const [rulersOn, setRulersOn] = useState<boolean>(() => localStorage.getItem('craftcanvas_rulers') !== 'off');
  const [guides, setGuides] = useState<{ id: string; axis: 'v' | 'h'; pos: number }[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('craftcanvas_guides') ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  const guidesRef = useRef(guides);
  guidesRef.current = guides;
  useEffect(() => { try { localStorage.setItem('craftcanvas_guides', JSON.stringify(guides)); } catch { /* 忽略 */ } }, [guides]);
  useEffect(() => { localStorage.setItem('craftcanvas_rulers', rulersOn ? 'on' : 'off'); }, [rulersOn]);
  const topRulerRef = useRef<HTMLCanvasElement>(null);
  const leftRulerRef = useRef<HTMLCanvasElement>(null);
  const [panning, setPanning] = useState(false);
  const [armedNode, setArmedNode] = useState<{ nodeId: string; mode: ArmedMode } | null>(null);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pinText, setPinText] = useState('');
  const [touchDraft, setTouchDraft] = useState<TouchDraft | null>(null);
  const [touchTextValue, setTouchTextValue] = useState('');
  const [touchCustomValue, setTouchCustomValue] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useMenuNavigation(Boolean(ctxMenu), contextMenuRef, () => setCtxMenu(null));
  useMenuNavigation(shapeMenuOpen, shapeMenuRef, () => setShapeMenuOpen(false));
  useMenuNavigation(moreOpen, moreMenuRef, () => setMoreOpen(false));

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  const applyTransform = useCallback((withTransition = false) => {
    const t = tRef.current;
    const world = worldRef.current;
    const bg = bgRef.current;
    if (!world || !bg) return;
    if (flyTimerRef.current) clearTimeout(flyTimerRef.current);
    if (withTransition && !reducedMotion) {
      world.style.transition = 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      bg.style.transition = 'background-position 0.55s cubic-bezier(0.22, 1, 0.36, 1), background-size 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      flyTimerRef.current = setTimeout(() => {
        world.style.transition = '';
        bg.style.transition = '';
        setView({ ...tRef.current });
      }, 580);
    } else {
      world.style.transition = '';
      bg.style.transition = '';
    }
    world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    const gap = DOT_GAP * t.k;
    bg.style.backgroundSize = `${gap}px ${gap}px`;
    bg.style.backgroundPosition = `${t.x}px ${t.y}px`;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setView({ ...tRef.current });
      });
    }
  }, [reducedMotion]);

  useEffect(() => { applyTransform(); }, [applyTransform]);
  useEffect(() => () => { if (flyTimerRef.current) clearTimeout(flyTimerRef.current); }, []);

  const zoomAt = useCallback((sx: number, sy: number, factor: number, transition = false) => {
    const t = tRef.current;
    const k2 = clamp(t.k * factor, MIN_K, MAX_K);
    const wx = (sx - t.x) / t.k;
    const wy = (sy - t.y) / t.k;
    tRef.current = { k: k2, x: sx - wx * k2, y: sy - wy * k2 };
    applyTransform(transition);
  }, [applyTransform]);

  const fitRect = useCallback((rect: Rect, transition = true) => {
    const el = containerRef.current;
    if (!el) return;
    const { clientWidth: cw, clientHeight: ch } = el;
    const pad = 90;
    const k = clamp(Math.min((cw - pad * 2) / rect.w, (ch - pad * 2) / rect.h, 1.15), MIN_K, MAX_K);
    tRef.current = {
      k,
      x: cw / 2 - (rect.x + rect.w / 2) * k,
      y: ch / 2 - (rect.y + rect.h / 2) * k,
    };
    applyTransform(transition);
  }, [applyTransform]);

  const removeAnn = useCallback((id: string) => {
    setAnnotations(a => a.filter(x => x.id !== id));
    setSelectedAnnId(cur => (cur === id ? null : cur));
  }, []);
  const selectedAnnIdRef = useRef(selectedAnnId);
  selectedAnnIdRef.current = selectedAnnId;
  // 选中标注时清空节点选择（互斥），避免 Delete 同时删两者
  const selectAnn = useCallback((id: string) => { setSelectedAnnId(id); onSelectionChange(new Set()); }, [onSelectionChange]);
  // 选中节点后清掉标注选择
  useEffect(() => { if (selectedIds.size > 0) setSelectedAnnId(null); }, [selectedIds]);
  const commitAnnText = useCallback(() => {
    if (annTextDraft && annTextValue.trim()) {
      // 引线标注：点击点为目标(x,y)，文字框放在右上方(tx,ty)，一条引线连接——指向性更强
      const k = tRef.current.k;
      const dx = 58 / k, dy = 42 / k; // 屏幕约 58×42px 的引线偏移
      setAnnotations(a => [...a, {
        id: uid(), kind: 'label',
        x: annTextDraft.x, y: annTextDraft.y,
        tx: annTextDraft.x + dx, ty: annTextDraft.y - dy,
        text: annTextValue.trim(),
      }]);
    }
    setAnnTextDraft(null);
    setAnnTextValue('');
  }, [annTextDraft, annTextValue]);

  // 屏幕坐标 → 世界坐标（绘制标注、落点用）
  const s2w = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    const t = tRef.current;
    const rect = el ? el.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
  }, []);

  const nodesBBox = useCallback((list: CanvasNodeData[]): Rect | null => {
    if (list.length === 0) return null;
    const minX = Math.min(...list.map(n => n.x));
    const minY = Math.min(...list.map(n => n.y));
    const maxX = Math.max(...list.map(n => n.x + n.w));
    const maxY = Math.max(...list.map(n => n.y + n.h));
    return { x: minX, y: minY - 48, w: maxX - minX, h: maxY - minY + 48 };
  }, []);

  // 恢复视图+标注（应用一次到本实例，避免 StrictMode 命令式 ref 时序坑）
  const restoreAppliedRef = useRef(false);
  useEffect(() => {
    if (!restorePayload || restoreAppliedRef.current) return;
    restoreAppliedRef.current = true;
    if (restorePayload.annotations.length) setAnnotations(restorePayload.annotations);
    if (restorePayload.view) { tRef.current = { ...restorePayload.view }; applyTransform(); }
    else if (restorePayload.fitIfNoView) { const box = nodesBBox(nodesRef.current); if (box) fitRect(box); }
  }, [restorePayload, applyTransform, nodesBBox, fitRect]);

  useImperativeHandle(ref, () => ({
    flyToRect: (rect) => fitRect(rect),
    flyToNode: (nodeId) => {
      const n = nodesRef.current.find(x => x.id === nodeId);
      if (n) fitRect({ x: n.x - n.w * 0.35, y: n.y - n.h * 0.35, w: n.w * 1.7, h: n.h * 1.7 });
    },
    fitAll: () => {
      const box = nodesBBox(nodesRef.current);
      if (box) fitRect(box);
    },
    screenToWorld: (clientX, clientY) => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const t = tRef.current;
      return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
    },
    getCenterWorld: () => {
      const el = containerRef.current;
      const t = tRef.current;
      if (!el) return { x: 0, y: 0 };
      return { x: (el.clientWidth / 2 - t.x) / t.k, y: (el.clientHeight / 2 - t.y) / t.k };
    },
    getViewTransform: () => ({ ...tRef.current }),
    setViewTransform: (t) => { tRef.current = { ...t }; applyTransform(); },
    getAnnotations: () => annotationsRef.current,
    setAnnotations: (list) => setAnnotations(list),
    getNodeAnnotations: (nodeId) => {
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (!node) return [];
      // 图片区域（世界坐标，在顶部标题栏 44px 之下）
      const R = { x: node.x, y: node.y + NODE_FOOTER, w: node.w, h: Math.max(1, node.h - NODE_FOOTER) };
      const nx = (wx: number) => (wx - R.x) / R.w;
      const ny = (wy: number) => (wy - R.y) / R.h;
      // 标注世界 bbox 与图片区域相交才算属于该节点
      const bboxOf = (a: Annotation): { x0: number; y0: number; x1: number; y1: number } => {
        if (a.kind === 'draw') {
          const xs = a.points.map(p => p.x), ys = a.points.map(p => p.y);
          return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        }
        if (a.kind === 'text') return { x0: a.x, y0: a.y - 20, x1: a.x + 40, y1: a.y };
        if (a.kind === 'label') return { x0: Math.min(a.x, a.tx), y0: Math.min(a.y, a.ty - 16), x1: Math.max(a.x, a.tx + 60), y1: Math.max(a.y, a.ty) };
        return { x0: Math.min(a.x, a.x + a.w), y0: Math.min(a.y, a.y + a.h), x1: Math.max(a.x, a.x + a.w), y1: Math.max(a.y, a.y + a.h) };
      };
      const intersects = (b: ReturnType<typeof bboxOf>) => b.x1 >= R.x && b.x0 <= R.x + R.w && b.y1 >= R.y && b.y0 <= R.y + R.h;
      // 归一化坐标到图片区域 [0,1]
      const norm = (a: Annotation): Annotation => {
        if (a.kind === 'draw') return { ...a, points: a.points.map(p => ({ x: nx(p.x), y: ny(p.y) })) };
        if (a.kind === 'text') return { ...a, x: nx(a.x), y: ny(a.y) };
        if (a.kind === 'label') return { ...a, x: nx(a.x), y: ny(a.y), tx: nx(a.tx), ty: ny(a.ty) };
        return { ...a, x: nx(a.x), y: ny(a.y), w: a.w / R.w, h: a.h / R.h };
      };
      return annotationsRef.current.filter(a => intersects(bboxOf(a))).map(norm);
    },
  }), [fitRect, nodesBBox, applyTransform]);

  // wheel：无修饰键平移，Ctrl/Cmd 缩放到光标；画板 UI 弹层内放行原生滚动
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-canvas-ui]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
      } else {
        tRef.current = { ...tRef.current, x: tRef.current.x - e.deltaX, y: tRef.current.y - e.deltaY };
        applyTransform();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, applyTransform]);

  const clearDrafts = useCallback(() => {
    setArmedNode(null);
    setPinDraft(null);
    setTouchDraft(null);
    setMoreOpen(false);
    setShapeMenuOpen(false);
    setCtxMenu(null);
  }, []);

  // 右键菜单：节点上=节点操作；空白处=画板操作
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nodeEl = (e.target as HTMLElement)?.closest?.('[data-node-id]') as HTMLElement | null;
    const nodeId = nodeEl?.dataset.nodeId;
    if (nodeId && !selectedRef.current.has(nodeId)) {
      onSelectionChange(new Set([nodeId]));
    }
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId });
  }, [onSelectionChange]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [ctxMenu]);

  // 快捷键：空格抓手 / V·H·P 工具 / Esc 退出
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) =>
      (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable], [role="dialog"], [role="menu"], button, a');
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // 选中的标注：Delete/Backspace 删除（节点选择已互斥清空，不会误删节点）
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnIdRef.current) {
        e.preventDefault();
        removeAnn(selectedAnnIdRef.current);
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true); return; }
      // ⌘0 适配全部 / ⌘1 100% / ⌘± 缩放（阻止浏览器页面缩放）
      if (e.metaKey || e.ctrlKey) {
        const el = containerRef.current;
        if (e.key === '0') {
          e.preventDefault();
          const box = nodesBBox(nodesRef.current);
          if (box) fitRect(box);
          return;
        }
        if (e.key === '1' && el) {
          e.preventDefault();
          // 以视口中心为锚点缩放到 100%
          const t = tRef.current;
          const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
          const wx = (cx - t.x) / t.k, wy = (cy - t.y) / t.k;
          tRef.current = { k: 1, x: cx - wx, y: cy - wy };
          applyTransform(true);
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          const sel = nodesRef.current.filter(n => selectedRef.current.has(n.id));
          const box = nodesBBox(sel);
          if (box) fitRect(box);
          return;
        }
        if ((e.key === '=' || e.key === '+') && el) { e.preventDefault(); zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1.25, true); return; }
        if (e.key === '-' && el) { e.preventDefault(); zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1 / 1.25, true); return; }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'h' || e.key === 'H') setTool('hand');
      if (e.key === 'p' || e.key === 'P') setTool('pin');
      // Tab = 对选中的成图进入「编辑元素」快捷编辑（对齐 Lovart「快捷编辑 Tab」）
      if (e.key === 'Tab') {
        const ids = [...selectedRef.current];
        if (ids.length === 1) {
          const n = nodesRef.current.find(x => x.id === ids[0]);
          if (n?.url && n.status === 'completed') { e.preventDefault(); setArmedNode({ nodeId: n.id, mode: 'element' }); }
        }
      }
      if (e.key === 'Escape') { clearDrafts(); setAnnTextDraft(null); setSelectedAnnId(null); setTool(t => (t === 'select' || t === 'hand' ? t : 'select')); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [clearDrafts, nodesBBox, fitRect, applyTransform, zoomAt, removeAnn]);

  // 画板空白处按下：平移或框选；抓手/空格下原地点击命中节点仍可选中
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    setSelectedAnnId(null); // 点空白处取消标注选中

    // 绘制标注（形状/画笔/圈注要改的地方，追问重绘时可作 AI 指引）
    if (e.button === 0 && (tool === 'shape' || tool === 'draw' || tool === 'text')) {
      const start = s2w(e.clientX, e.clientY);
      // T 工具 = 创建文本元素节点（一等元素）；引线标注改由形状菜单进入
      if (tool === 'text') { onCreateText(start); setTool('select'); return; }
      // 形状菜单的「引线标注」：走原引线输入流程
      if (tool === 'shape' && shapeKindRef.current === 'label') { setAnnTextDraft(start); setAnnTextValue(''); return; }
      const id = uid();
      const sk = shapeKindRef.current as ShapeKind; // 'label' 已在上方分支 return
      // live 只可能是形状或画笔（文字已在上面 return），排除 text 便于类型收窄
      type LiveAnn = Extract<Annotation, { kind: ShapeKind }> | Extract<Annotation, { kind: 'draw' }>;
      let live: LiveAnn = tool === 'draw'
        ? { id, kind: 'draw', points: [start] }
        : { id, kind: sk, x: start.x, y: start.y, w: 0, h: 0 };
      setDrawing(live);
      const onMove = (ev: PointerEvent) => {
        const p = s2w(ev.clientX, ev.clientY);
        live = live.kind === 'draw'
          ? { id, kind: 'draw', points: [...live.points, p] }
          : { id, kind: live.kind, x: start.x, y: start.y, w: p.x - start.x, h: p.y - start.y };
        setDrawing(live);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDrawing(null);
        if (live.kind === 'draw') {
          const d = live;
          if (d.points.length >= 2) setAnnotations(a => [...a, d]);
        } else {
          // 形状：保留原始 x/y/w/h（line/arrow 需方向），渲染时按需 normalize
          const s = live;
          if (Math.abs(s.w) < 4 && Math.abs(s.h) < 4) return;
          setAnnotations(a => [...a, s]);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return;
    }

    clearDrafts();
    const el = containerRef.current;
    if (!el) return;
    const hitNodeEl = (e.target as HTMLElement)?.closest?.('[data-node-id]') as HTMLElement | null;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const isPan = e.button === 1 || tool === 'hand' || spaceDown;
    const t0 = { ...tRef.current };
    let moved = false;

    if (isPan) setPanning(true);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (isPan) {
        tRef.current = { ...t0, x: t0.x + dx, y: t0.y + dy };
        applyTransform();
      } else {
        setMarquee({
          x0: startX - rect.left, y0: startY - rect.top,
          x1: ev.clientX - rect.left, y1: ev.clientY - rect.top,
        });
      }
    };

    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setPanning(false);
      setMarquee(null);
      if (cancelled) return;
      if (isPan) {
        if (!moved && hitNodeEl) {
          const id = hitNodeEl.dataset.nodeId!;
          onSelectionChange((ev.shiftKey || ev.metaKey || ev.ctrlKey) ? new Set([...selectedRef.current, id]) : new Set([id]));
        }
        return;
      }
      if (!moved) {
        onSelectionChange(new Set());
      } else {
        const t = tRef.current;
        const rx0 = (Math.min(startX, ev.clientX) - rect.left - t.x) / t.k;
        const ry0 = (Math.min(startY, ev.clientY) - rect.top - t.y) / t.k;
        const rx1 = (Math.max(startX, ev.clientX) - rect.left - t.x) / t.k;
        const ry1 = (Math.max(startY, ev.clientY) - rect.top - t.y) / t.k;
        const hit = nodesRef.current.filter(n => !n.hidden && n.x < rx1 && n.x + n.w > rx0 && n.y < ry1 && n.y + n.h > ry0);
        const next = (ev.shiftKey || ev.metaKey || ev.ctrlKey) ? new Set([...selectedRef.current, ...hit.map(n => n.id)]) : new Set(hit.map(n => n.id));
        onSelectionChange(next);
      }
    };

    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [tool, spaceDown, applyTransform, onSelectionChange, clearDrafts, s2w]);

  // 节点拖动（rAF 合帧）
  const onNodePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    if (tool === 'hand' || spaceDown) return;
    // 绘制标注工具下，图上按下也让事件冒泡到画板绘制（不拖动节点）
    if (tool === 'shape' || tool === 'draw' || tool === 'text') return;
    e.stopPropagation();
    setMoreOpen(false);

    // Shift / Cmd / Ctrl 点击 = 加选或取消选（多选）；普通点击 = 单选
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let dragIds: string[];
    if (additive) {
      const next = new Set<string>(selectedRef.current);
      if (next.has(id)) next.delete(id); else next.add(id);
      onSelectionChange(next);
      dragIds = [...next];
    } else if (selectedRef.current.has(id)) {
      dragIds = [...selectedRef.current];
    } else {
      // 组合（⌘G）：点击组内任一成员 → 选中整组；组内编辑模式下选单个成员
      const gid = nodesRef.current.find(n => n.id === id)?.groupId;
      dragIds = gid && gid !== editingGroupId ? nodesRef.current.filter(n => n.groupId === gid).map(n => n.id) : [id];
      onSelectionChange(new Set(dragIds));
    }

    // 锁定的节点可选中但不可拖动
    dragIds = dragIds.filter(did => !nodesRef.current.find(n => n.id === did)?.locked);
    if (dragIds.length === 0) return;

    let lastX = e.clientX;
    let lastY = e.clientY;
    let pendingDx = 0;
    let pendingDy = 0;
    let raf: number | null = null;
    let historyPushed = false; // 首次真实移动时推一次撤销历史
    let altDown = false; // Alt 按住 = 临时关闭吸附

    const dragSet = new Set(dragIds);

    const flush = () => {
      raf = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      // 智能吸附：拖动组 bbox 的边/中心与其他节点的边/中心对齐（阈值屏幕 6px）
      if (!altDown) {
        const k = tRef.current.k;
        const thresh = 6 / k;
        const moving = nodesRef.current.filter(n => dragSet.has(n.id));
        const statics = nodesRef.current.filter(n => !dragSet.has(n.id) && !n.hidden);
        if (moving.length && (statics.length || guidesRef.current.length)) {
          const L = Math.min(...moving.map(n => n.x)) + pendingDx;
          const R = Math.max(...moving.map(n => n.x + n.w)) + pendingDx;
          const T = Math.min(...moving.map(n => n.y)) + pendingDy;
          const B = Math.max(...moving.map(n => n.y + n.h)) + pendingDy;
          const CX = (L + R) / 2, CY = (T + B) / 2;
          let bestV: { d: number; line: number } | null = null;
          let bestH: { d: number; line: number } | null = null;
          for (const s of statics) {
            for (const line of [s.x, s.x + s.w / 2, s.x + s.w]) {
              for (const edge of [L, CX, R]) {
                const d = line - edge;
                if (Math.abs(d) < thresh && (!bestV || Math.abs(d) < Math.abs(bestV.d))) bestV = { d, line };
              }
            }
            for (const line of [s.y, s.y + s.h / 2, s.y + s.h]) {
              for (const edge of [T, CY, B]) {
                const d = line - edge;
                if (Math.abs(d) < thresh && (!bestH || Math.abs(d) < Math.abs(bestH.d))) bestH = { d, line };
              }
            }
          }
          // 参考线也是吸附候选
          for (const g of guidesRef.current) {
            if (g.axis === 'v') {
              for (const edge of [L, CX, R]) {
                const d = g.pos - edge;
                if (Math.abs(d) < thresh && (!bestV || Math.abs(d) < Math.abs(bestV.d))) bestV = { d, line: g.pos };
              }
            } else {
              for (const edge of [T, CY, B]) {
                const d = g.pos - edge;
                if (Math.abs(d) < thresh && (!bestH || Math.abs(d) < Math.abs(bestH.d))) bestH = { d, line: g.pos };
              }
            }
          }
          // 等间距吸附提示（§7.3）：移动组与左右（上下）最近静态节点的间距相等时吸附
          let eqTip: string | null = null;
          if (!bestV) {
            const overlapV = (o: CanvasNodeData) => o.y < B && o.y + o.h > T;
            const leftN = statics.filter(o => overlapV(o) && o.x + o.w <= L).sort((p, q) => (q.x + q.w) - (p.x + p.w))[0];
            const rightN = statics.filter(o => overlapV(o) && o.x >= R).sort((p, q) => p.x - q.x)[0];
            if (leftN && rightN) {
              const gl = L - (leftN.x + leftN.w), gr = rightN.x - R;
              if (Math.abs(gr - gl) < thresh * 2) { pendingDx += (gr - gl) / 2; eqTip = `等间距 ${Math.round((gl + gr) / 2)}`; }
            }
          }
          if (!bestH && !eqTip) {
            const overlapH = (o: CanvasNodeData) => o.x < R && o.x + o.w > L;
            const topN = statics.filter(o => overlapH(o) && o.y + o.h <= T).sort((p, q) => (q.y + q.h) - (p.y + p.h))[0];
            const botN = statics.filter(o => overlapH(o) && o.y >= B).sort((p, q) => p.y - q.y)[0];
            if (topN && botN) {
              const gt = T - (topN.y + topN.h), gb = botN.y - B;
              if (Math.abs(gb - gt) < thresh * 2) { pendingDy += (gb - gt) / 2; eqTip = `等间距 ${Math.round((gt + gb) / 2)}`; }
            }
          }
          setSizeMatchTip(eqTip);
          if (bestV) pendingDx += bestV.d;
          if (bestH) pendingDy += bestH.d;
          setSnapGuides([
            ...(bestV ? [{ axis: 'v' as const, pos: bestV.line }] : []),
            ...(bestH ? [{ axis: 'h' as const, pos: bestH.line }] : []),
          ]);
        }
      } else {
        setSnapGuides([]);
        setSizeMatchTip(null);
      }
      onMoveNodes(dragIds, pendingDx, pendingDy);
      pendingDx = 0;
      pendingDy = 0;
    };

    const onMove = (ev: PointerEvent) => {
      if (!historyPushed) { historyPushed = true; onBeforeMove(); }
      altDown = ev.altKey;
      const k = tRef.current.k;
      pendingDx += (ev.clientX - lastX) / k;
      pendingDy += (ev.clientY - lastY) / k;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (raf == null) raf = requestAnimationFrame(flush);
    };

    const cleanup = () => {
      if (raf != null) cancelAnimationFrame(raf);
      flush();
      setSnapGuides([]);
      setSizeMatchTip(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }, [tool, spaceDown, onSelectionChange, onMoveNodes, onBeforeMove]);

  // ---------- 图钉 & 触点放置 ----------
  const placePoint = useCallback(async (nodeId: string, xPct: number, yPct: number, mode: ArmedMode) => {
    setArmedNode(null);
    if (mode === 'pin') {
      setPinDraft({ nodeId, xPct, yPct });
      setPinText('');
      return;
    }
    // Touch Edit / 橡皮 / 移动对象：先识别元素
    const focus: 'element' | 'text' = mode === 'text' ? 'text' : 'element';
    const intent = mode === 'erase' ? 'erase' as const : mode === 'move' ? 'move' as const : undefined;
    setTouchDraft({ nodeId, xPct, yPct, focus, intent, status: 'identifying' });
    setTouchTextValue('');
    setTouchCustomValue('');
    const result = await onIdentifyElement(nodeId, xPct, yPct, focus);
    if (intent === 'erase' && result) {
      // 橡皮：识别成功即自动无痕移除
      setTouchDraft(null);
      onTouchEdit(nodeId, xPct, yPct, result.element, 'Remove it completely and seamlessly inpaint the area behind it.');
      return;
    }
    setTouchDraft(prev => {
      if (!prev || prev.nodeId !== nodeId) return prev;
      if (!result) return { ...prev, status: 'failed' };
      if (result.text) setTouchTextValue(result.text);
      return { ...prev, status: 'ready', element: result.element, text: result.text };
    });
  }, [onIdentifyElement, onTouchEdit]);

  const runTouch = useCallback((instruction: string) => {
    if (!touchDraft || !instruction.trim()) return;
    onTouchEdit(
      touchDraft.nodeId,
      touchDraft.xPct,
      touchDraft.yPct,
      touchDraft.element ?? 'the element at the pinned location',
      instruction.trim(),
    );
    setTouchDraft(null);
  }, [touchDraft, onTouchEdit]);

  const openExistingPin = useCallback((nodeId: string, pin: NodePin) => {
    setPinDraft({ nodeId, xPct: pin.xPct, yPct: pin.yPct, editingPinId: pin.id });
    setPinText(pin.text);
  }, []);

  const savePinToQueue = useCallback(() => {
    if (!pinDraft || !pinText.trim()) return;
    const node = nodesRef.current.find(n => n.id === pinDraft.nodeId);
    if (!node) return;
    const pins = [...(node.pins ?? [])];
    if (pinDraft.editingPinId) {
      const idx = pins.findIndex(p => p.id === pinDraft.editingPinId);
      if (idx >= 0) pins[idx] = { ...pins[idx], text: pinText.trim() };
    } else {
      pins.push({ id: uid(), xPct: pinDraft.xPct, yPct: pinDraft.yPct, text: pinText.trim() });
    }
    onUpdatePins(pinDraft.nodeId, pins);
    setPinDraft(null);
    setPinText('');
  }, [pinDraft, pinText, onUpdatePins]);

  const deleteDraftPin = useCallback(() => {
    if (!pinDraft?.editingPinId) { setPinDraft(null); return; }
    const node = nodesRef.current.find(n => n.id === pinDraft.nodeId);
    if (node) onUpdatePins(pinDraft.nodeId, (node.pins ?? []).filter(p => p.id !== pinDraft.editingPinId));
    setPinDraft(null);
    setPinText('');
  }, [pinDraft, onUpdatePins]);

  const runPinNow = useCallback(() => {
    if (!pinDraft || !pinText.trim()) return;
    onRunPins(pinDraft.nodeId, [{ id: pinDraft.editingPinId ?? uid(), xPct: pinDraft.xPct, yPct: pinDraft.yPct, text: pinText.trim() }]);
    if (pinDraft.editingPinId) {
      const node = nodesRef.current.find(n => n.id === pinDraft.nodeId);
      if (node) onUpdatePins(pinDraft.nodeId, (node.pins ?? []).filter(p => p.id !== pinDraft.editingPinId));
    }
    setPinDraft(null);
    setPinText('');
  }, [pinDraft, pinText, onRunPins, onUpdatePins]);

  // ---------- 投影 ----------
  const worldToScreen = useCallback((wx: number, wy: number) => ({
    x: view.x + wx * view.k,
    y: view.y + wy * view.k,
  }), [view]);

  // ---------- 标尺绘制（视图变化时重绘；step 取 1/2/5×10^n 使刻度间距 ≈60~150px）----------
  const RULER = 18;
  useEffect(() => {
    if (!rulersOn) return;
    const dpr = window.devicePixelRatio || 1;
    const { x: tx, y: ty, k } = view;
    const niceStep = () => {
      const raw = 80 / k;
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
      return 10 * pow;
    };
    const s = niceStep();
    const draw = (cv: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!cv) return;
      const len = horizontal ? (containerRef.current?.clientWidth ?? 800) : (containerRef.current?.clientHeight ?? 600);
      cv.width = (horizontal ? len : RULER) * dpr;
      cv.height = (horizontal ? RULER : len) * dpr;
      const ctx = cv.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(0, 0, horizontal ? len : RULER, horizontal ? RULER : len);
      ctx.strokeStyle = '#E4E4E7';
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '8.5px ui-sans-serif, system-ui';
      ctx.beginPath();
      const t0 = horizontal ? tx : ty;
      const start = Math.floor((-t0 / k) / s) * s;
      const end = (len - t0) / k;
      for (let w = start; w <= end; w += s) {
        const p = Math.round(t0 + w * k) + 0.5;
        if (horizontal) { ctx.moveTo(p, 4); ctx.lineTo(p, RULER); ctx.fillText(String(Math.round(w)), p + 3, 9); }
        else {
          ctx.moveTo(4, p); ctx.lineTo(RULER, p);
          ctx.save(); ctx.translate(9, p + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(String(Math.round(w)), 0, 0); ctx.restore();
        }
        // 次刻度
        for (let i = 1; i < 5; i++) {
          const mp = Math.round(t0 + (w + (s / 5) * i) * k) + 0.5;
          if (horizontal) { ctx.moveTo(mp, RULER - 4); ctx.lineTo(mp, RULER); }
          else { ctx.moveTo(RULER - 4, mp); ctx.lineTo(RULER, mp); }
        }
      }
      ctx.stroke();
    };
    draw(topRulerRef.current, true);
    draw(leftRulerRef.current, false);
  }, [view, rulersOn]);

  // 从标尺拖出参考线（PS 约定：上标尺→水平线，左标尺→垂直线）；拖回标尺删除
  const startGuideDrag = useCallback((axis: 'v' | 'h', e: React.PointerEvent, existingId?: string) => {
    e.stopPropagation();
    e.preventDefault();
    const id = existingId ?? 'guide_' + Math.random().toString(36).slice(2, 9);
    const toWorld = (ev: { clientX: number; clientY: number }) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const t = tRef.current;
      return axis === 'v' ? ((ev.clientX - rect.left) - t.x) / t.k : ((ev.clientY - rect.top) - t.y) / t.k;
    };
    if (!existingId) setGuides(prev => [...prev, { id, axis, pos: toWorld(e) }]);
    const onMove = (ev: PointerEvent) => {
      const pos = toWorld(ev);
      setGuides(prev => prev.map(g => (g.id === id ? { ...g, pos } : g)));
    };
    const onUp = (ev: PointerEvent) => {
      // 拖回标尺范围 = 删除
      const rect = containerRef.current!.getBoundingClientRect();
      const inRuler = axis === 'v' ? ev.clientX - rect.left < RULER : ev.clientY - rect.top < RULER;
      if (inRuler) setGuides(prev => prev.filter(g => g.id !== id));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const singleNode = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    return nodes.find(n => selectedIds.has(n.id)) ?? null;
  }, [selectedIds, nodes]);

  // 选中图的原始像素尺寸（Lovart 式标题行右侧展示）
  const [dims, setDims] = useState<string | null>(null);
  useEffect(() => {
    setDims(null);
    if (!singleNode?.url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setDims(`${img.naturalWidth} × ${img.naturalHeight}`); };
    img.src = singleNode.url;
    return () => { alive = false; };
  }, [singleNode?.id, singleNode?.url]);

  const pinDraftNode = pinDraft ? nodes.find(n => n.id === pinDraft.nodeId) : null;
  const touchDraftNode = touchDraft ? nodes.find(n => n.id === touchDraft.nodeId) : null;

  // Frame（批次分组）：虚线框 + 头部
  const frames = useMemo(() => {
    return runs.map(run => {
      const runNodes = nodes.filter(n => n.runId === run.id);
      if (runNodes.length === 0) return null;
      const minX = Math.min(...runNodes.map(n => n.x));
      const minY = Math.min(...runNodes.map(n => n.y));
      const maxX = Math.max(...runNodes.map(n => n.x + n.w));
      const maxY = Math.max(...runNodes.map(n => n.y + n.h));
      const done = runNodes.filter(n => n.status === 'completed').length;
      return {
        run,
        x: minX - FRAME_PAD,
        y: minY - FRAME_PAD,
        w: maxX - minX + FRAME_PAD * 2,
        h: maxY - minY + FRAME_PAD * 2,
        done,
        total: runNodes.length,
      };
    }).filter(Boolean) as { run: GenRun; x: number; y: number; w: number; h: number; done: number; total: number }[];
  }, [runs, nodes]);

  const cursorClass = panning ? 'cursor-grabbing' : (tool === 'hand' || spaceDown) ? 'cursor-grab' : 'cursor-default';

  // 快捷编辑条：固定跟随选中图下方，视口内夹紧（不会跑丢）
  const barPos = useMemo(() => {
    if (!singleNode) return null;
    const el = containerRef.current;
    const anchor = worldToScreen(singleNode.x + singleNode.w / 2, singleNode.y + singleNode.h);
    const cw = el?.clientWidth ?? 1200;
    const ch = el?.clientHeight ?? 800;
    // 可用横向空间（面板避让仅在空间充足时生效，见 avoidPanel）
    const maxW = toolbarMaxW;
    const HALF = Math.min(quickBarW, maxW) / 2; // 实测条宽（受 maxW 限制）的一半
    const leftBound = toolbarLeftEdge + HALF;
    const rightBound = cw - 8 - HALF;
    return {
      // rightBound < leftBound 说明空间仍不足 → 靠右边界摆放，保证不溢出画布
      x: rightBound >= leftBound ? clamp(anchor.x, leftBound, rightBound) : rightBound,
      y: clamp(anchor.y + 12, 64, ch - 130),
      maxW,
    };
  }, [singleNode, worldToScreen, toolbarLeftEdge, toolbarMaxW, quickBarW]);

  const armedFor = (n: CanvasNodeData): ArmedMode | null => {
    if (armedNode?.nodeId === n.id) return armedNode.mode;
    if (tool === 'pin' && n.status === 'completed' && n.url) return 'pin';
    return null;
  };

  const dockBtn = (active: boolean) =>
    `flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${active ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-100'}`;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="创作画布"
      className={`absolute inset-0 overflow-hidden bg-paper focus-visible:outline-offset-[-3px] ${cursorClass}`}
      style={canvasBg ? { backgroundColor: canvasBg } : undefined}
      onPointerDownCapture={event => {
        cancelLayoutMotion();
        (event.target as Element).closest('[data-node-id]')?.querySelectorAll('[data-node-motion]').forEach(element => {
          element.getAnimations().forEach(animation => animation.cancel());
        });
        // Returning to the canvas restores shortcuts after a toolbar/menu action.
        if (!(event.target as HTMLElement).closest('button, a, input, textarea, [contenteditable], [data-canvas-ui], [role="menu"]')) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={onContextMenu}
    >
      <div ref={bgRef} className="canvas-dots pointer-events-none absolute inset-0" />

      {/* 世界层 */}
      <div ref={worldRef} className="absolute left-0 top-0" style={{ transformOrigin: '0 0' }}>
        {/* Frame 虚线框 + 头部（Lovart 式） */}
        {frames.map(({ run, x, y, w, h, done, total }) => (
          <React.Fragment key={run.id}>
            <CanvasFrame rect={{ x, y, w, h }} reducedMotion={reducedMotion} />
            <div data-layout-chrome className="absolute flex items-center gap-2.5 whitespace-nowrap" style={{ left: x + 4, top: y - 34 }}>
              <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-ink-400">
                <Frame className="h-3.5 w-3.5" />
                {run.title}
              </span>
              <span className="rounded-md bg-ink-200/70 px-1.5 py-0.5 text-[10px] font-bold text-ink-500">{done}/{total}</span>
              {run.mode !== 'assets' && (
                <>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onOpenRunChat(run.id)}
                    aria-label="在此框架内独立对话（生成结果落入本框架）"
                    className="flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-accent-700 shadow-sm transition-colors hover:bg-accent-50"
                  >
                    <MessageSquareText className="h-3 w-3" /> 对话
                  </button>
                  {done > 0 && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onDownloadRun(run.id)}
                      aria-label="打包下载本框架全部成图"
                      className="flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-ink-500 shadow-sm transition-colors hover:text-accent-700"
                    >
                      <Download className="h-3 w-3" /> 打包
                    </button>
                  )}
                </>
              )}
            </div>
          </React.Fragment>
        ))}
        {/* 拖动吸附辅助线 */}
        {snapGuides.length > 0 && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {snapGuides.map((g, i) => g.axis === 'v'
              ? <line key={i} x1={g.pos} y1={-100000} x2={g.pos} y2={100000} stroke="#F43F5E" strokeWidth={1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              : <line key={i} x1={-100000} y1={g.pos} x2={100000} y2={g.pos} stroke="#F43F5E" strokeWidth={1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
          </svg>
        )}

        {/* 派生关联连接线：从源图右缘曲线连到衍生图左缘（放在节点下方） */}
        <svg data-layout-chrome className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
          {nodes.map(n => {
            if (!n.parentId || n.hidden) return null;
            const p = nodes.find(x => x.id === n.parentId);
            if (!p || p.hidden) return null;
            const x1 = p.x + p.w, y1 = p.y + NODE_FOOTER + (p.h - NODE_FOOTER) / 2;
            const x2 = n.x, y2 = n.y + NODE_FOOTER + (n.h - NODE_FOOTER) / 2;
            const mx = (x1 + x2) / 2;
            return (
              <DerivationLink key={'link_' + n.id} path={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} reducedMotion={reducedMotion} />
            );
          })}
        </svg>
        {nodes.filter(n => !n.hidden).map((n, index) => (
          <CanvasNode
            key={n.id}
            node={n}
            selected={selectedIds.has(n.id)}
            reducedMotion={reducedMotion}
            entranceDelay={Math.min((index % 9) * 28, 168)}
            armed={armedFor(n)}
            onPointerDown={onNodePointerDown}
            onPlacePoint={placePoint}
            onPreview={onPreview}
            onImageDblClick={(id) => {
              const target = nodesRef.current.find(x => x.id === id);
              // 双击组成员：先进入组内编辑；已在组内（或无组）→ 预览大图
              if (target?.groupId && target.groupId !== editingGroupId) {
                setEditingGroupId(target.groupId);
                onSelectionChange(new Set([id]));
              } else {
                onPreview(id);
              }
            }}
            onRetry={onRetry}
            onStartEditText={(id) => {
              const n = nodesRef.current.find(x => x.id === id);
              setEditingTextId(id);
              setEditingTextValue(n?.text ?? '');
            }}
            onNaturalSize={onImageNaturalSize}
          />
        ))}

        {/* 文本元素编辑覆盖（世界层，随缩放；⌘Enter/点外提交，Esc 取消） */}
        {editingTextId && (() => {
          const n = nodes.find(x => x.id === editingTextId);
          if (!n) return null;
          const commit = () => {
            onUpdateNodeText(n.id, editingTextValue.trim() || '双击编辑文字');
            setEditingTextId(null);
          };
          return (
            <textarea
              data-canvas-ui
              autoFocus
              value={editingTextValue}
              onChange={(e) => setEditingTextValue(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={commit}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') setEditingTextId(null);
              }}
              className="absolute resize-none rounded-xl border-2 border-accent-500 bg-white/95 p-2 text-center font-bold leading-snug shadow-xl outline-none"
              style={{ left: n.x, top: n.y, width: n.w, height: Math.max(n.h, 80), fontSize: n.fontSize ?? 32, color: n.textColor ?? '#18181b' }}
            />
          );
        })()}

        {/* 标注层（形状/画笔/文字，矢量圈注；点击选中、Delete/双击删除；描边像素宽恒定） */}
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ pointerEvents: 'none' }}>
          {[...annotations, ...(drawing ? [drawing] : [])].map(a => {
            const live = a.id === (drawing?.id);
            const sel = a.id === selectedAnnId;
            const col = sel ? '#6E56CF' : '#EF4444';
            // 可见几何 + 一层加粗透明命中层（让细线也易点选）；draw 时不挂命中
            const hit = live ? {} : {
              onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); selectAnn(a.id); },
              onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); removeAnn(a.id); },
              style: { pointerEvents: 'stroke' as const, cursor: 'pointer' },
            };
            const hitStroke = { fill: 'none', stroke: 'transparent', strokeWidth: 16, vectorEffect: 'non-scaling-stroke' as const, ...hit };
            const vis = { fill: 'none', stroke: col, strokeWidth: sel ? 3 : 2, vectorEffect: 'non-scaling-stroke' as const, style: { pointerEvents: 'none' as const } };

            let geom: React.ReactNode = null;
            if (a.kind === 'draw') {
              const pts = a.points.map(p => `${p.x},${p.y}`).join(' ');
              geom = <><polyline points={pts} {...vis} strokeWidth={sel ? 3.5 : 2.5} strokeLinejoin="round" strokeLinecap="round" /><polyline points={pts} {...hitStroke} /></>;
            } else if (a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'polygon' || a.kind === 'star') {
              const rx = Math.min(a.x, a.x + a.w), ry = Math.min(a.y, a.y + a.h), rw = Math.abs(a.w), rh = Math.abs(a.h);
              if (a.kind === 'rect') geom = <><rect x={rx} y={ry} width={rw} height={rh} {...vis} /><rect x={rx} y={ry} width={rw} height={rh} {...hitStroke} /></>;
              else if (a.kind === 'ellipse') geom = <><ellipse cx={rx + rw / 2} cy={ry + rh / 2} rx={rw / 2} ry={rh / 2} {...vis} /><ellipse cx={rx + rw / 2} cy={ry + rh / 2} rx={rw / 2} ry={rh / 2} {...hitStroke} /></>;
              else { const pts = a.kind === 'star' ? starPoints(rx, ry, rw, rh) : polygonPoints(rx, ry, rw, rh, 3); geom = <><polygon points={pts} strokeLinejoin="round" {...vis} /><polygon points={pts} {...hitStroke} /></>; }
            } else if (a.kind === 'line' || a.kind === 'arrow') {
              const x2 = a.x + a.w, y2 = a.y + a.h;
              const mainVis = <line x1={a.x} y1={a.y} x2={x2} y2={y2} strokeLinecap="round" {...vis} />;
              const mainHit = <line x1={a.x} y1={a.y} x2={x2} y2={y2} {...hitStroke} />;
              if (a.kind === 'line') geom = <>{mainVis}{mainHit}</>;
              else {
                const ang = Math.atan2(y2 - a.y, x2 - a.x), ah = Math.max(10, Math.hypot(a.w, a.h) * 0.18);
                const wing = `${x2},${y2} ${x2 - ah * Math.cos(ang - 0.5)},${y2 - ah * Math.sin(ang - 0.5)} ${x2 - ah * Math.cos(ang + 0.5)},${y2 - ah * Math.sin(ang + 0.5)}`;
                geom = <>{mainVis}<polygon points={wing} fill={col} stroke={col} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />{mainHit}</>;
              }
            } else if (a.kind === 'label') {
              geom = <>
                <line x1={a.tx} y1={a.ty} x2={a.x} y2={a.y} stroke={col} strokeWidth={sel ? 2 : 1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
                <circle cx={a.x} cy={a.y} r={4} fill={col} style={{ pointerEvents: 'none' }} />
                <text x={a.tx} y={a.ty - 4} fill={col} fontSize={16} fontWeight={700} style={{ pointerEvents: 'all', cursor: 'pointer' }} {...hit}>{a.text}</text>
                <line x1={a.tx} y1={a.ty} x2={a.x} y2={a.y} {...hitStroke} />
              </>;
            } else {
              geom = <text x={a.x} y={a.y} fill={col} fontSize={18} fontWeight={700} style={{ pointerEvents: 'all', cursor: 'pointer' }} {...hit}>{a.text}</text>;
            }
            return (
              <g key={a.id}>
                {sel && (() => { const b = annBBox(a); return <rect x={b.x0 - 6} y={b.y0 - 6} width={b.x1 - b.x0 + 12} height={b.y1 - b.y0 + 12} fill="none" stroke="#6E56CF" strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />; })()}
                {geom}
                {!live && <title>点击选中 · Delete 或双击删除</title>}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ===== 屏幕空间覆盖层 ===== */}
      <div className="pointer-events-none absolute inset-0 z-40">
        {/* 选中标注的删除按钮（右上角，屏幕空间） */}
        {selectedAnnId && (() => {
          const a = annotations.find(x => x.id === selectedAnnId);
          if (!a) return null;
          const b = annBBox(a);
          const p = worldToScreen(b.x1, b.y0);
          return (
            <Tip label="删除标注 (Delete)">
              <button
                data-canvas-ui
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeAnn(selectedAnnId)}
                className="pointer-events-auto absolute z-50 flex h-7 w-7 -translate-y-1/2 translate-x-2 items-center justify-center rounded-full border border-ink-200 bg-white text-red-500 shadow-lg transition-colors hover:bg-red-50"
                style={{ left: p.x, top: p.y }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tip>
          );
        })()}
        {/* Resize 四角手柄（单选；角拖拽等比缩放，Alt 自由比例；文本同步字号） */}
        {singleNode && !singleNode.locked && !armedNode && !pinDraft && !touchDraft && (['nw', 'ne', 'sw', 'se'] as const).map(corner => {
          const wx = corner.includes('w') ? singleNode.x : singleNode.x + singleNode.w;
          const wy = corner.includes('n') ? singleNode.y : singleNode.y + singleNode.h;
          const p = worldToScreen(wx, wy);
          const cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
          return (
            <div
              key={corner}
              data-canvas-ui
              className="pointer-events-auto absolute z-40 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-accent-600 bg-white shadow"
              style={{ left: p.x, top: p.y, cursor }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onBeforeMove(); // 入撤销历史
                const start = { x: singleNode.x, y: singleNode.y, w: singleNode.w, h: singleNode.h, fs: singleNode.fontSize };
                const anchorX = corner.includes('w') ? start.x + start.w : start.x; // 对角锚点
                const anchorY = corner.includes('n') ? start.y + start.h : start.y;
                const sx = e.clientX, sy = e.clientY;
                const id = singleNode.id;
                const isText = singleNode.kind === 'text';
                const onMove = (ev: PointerEvent) => {
                  const k = tRef.current.k;
                  const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
                  let w = Math.max(40, Math.abs((corner.includes('w') ? start.x + dx : start.x + start.w + dx) - anchorX));
                  let h = Math.max(40, Math.abs((corner.includes('n') ? start.y + dy : start.y + start.h + dy) - anchorY));
                  if (!ev.altKey) { // 默认等比（取较大变化轴）
                    const s = Math.max(w / start.w, h / start.h);
                    w = start.w * s; h = start.h * s;
                  }
                  // 尺寸匹配提示（§7.3）：W/H 接近其他节点尺寸时吸附并提示
                  const matchThresh = 6 / k;
                  const matches: string[] = [];
                  for (const o of nodesRef.current) {
                    if (o.id === id || o.hidden) continue;
                    if (Math.abs(o.w - w) < matchThresh) { w = o.w; matches.push(`W ${Math.round(o.w)} ≡ ${o.label.slice(0, 8)}`); break; }
                  }
                  for (const o of nodesRef.current) {
                    if (o.id === id || o.hidden) continue;
                    if (Math.abs(o.h - h) < matchThresh) { h = o.h; matches.push(`H ${Math.round(o.h)} ≡ ${o.label.slice(0, 8)}`); break; }
                  }
                  setSizeMatchTip(matches.length ? matches.join(' · ') : null);
                  const frame: { x: number; y: number; w: number; h: number; fontSize?: number } = {
                    x: corner.includes('w') ? anchorX - w : anchorX,
                    y: corner.includes('n') ? anchorY - h : anchorY,
                    w, h,
                  };
                  if (isText && start.fs) frame.fontSize = Math.max(10, Math.round(start.fs * (w / start.w)));
                  onSetNodeFrame(id, frame);
                };
                const onUp = () => {
                  setSizeMatchTip(null);
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                  window.removeEventListener('pointercancel', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
              }}
            />
          );
        })}

        {/* 尺寸匹配提示（resize 中命中其他节点尺寸时显示） */}
        {sizeMatchTip && (
          <div
            className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
            style={{ top: selectedIds.size >= 2 ? 168 : singleNode ? 120 : 80 }}
          >
            <div className="rounded-full bg-rose-500/90 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-xl backdrop-blur-md">
              尺寸匹配 · {sizeMatchTip}
            </div>
          </div>
        )}

        {/* 标尺（§7.1）：上标尺拖出水平参考线、左标尺拖出垂直参考线 */}
        {rulersOn && (
          <>
            <canvas
              ref={topRulerRef}
              className="pointer-events-auto absolute left-0 top-0 z-30 h-[18px] w-full cursor-row-resize"
              onPointerDown={(e) => startGuideDrag('h', e)}
              aria-label="拖动拖出水平参考线"
            />
            <canvas
              ref={leftRulerRef}
              className="pointer-events-auto absolute left-0 top-0 z-30 h-full w-[18px] cursor-col-resize"
              onPointerDown={(e) => startGuideDrag('v', e)}
              aria-label="拖动拖出垂直参考线"
            />
            <div className="absolute left-0 top-0 z-30 h-[18px] w-[18px] border-b border-r border-ink-200 bg-white" />
          </>
        )}
        {/* 参考线（可拖动；拖回标尺或双击删除） */}
        {guides.map(g => {
          const p = g.axis === 'v' ? view.x + g.pos * view.k : view.y + g.pos * view.k;
          return (
            <div
              key={g.id}
              data-canvas-ui
              className={`pointer-events-auto absolute z-20 ${g.axis === 'v' ? 'h-full w-[7px] -translate-x-1/2 cursor-col-resize' : 'w-full h-[7px] -translate-y-1/2 cursor-row-resize'}`}
              style={g.axis === 'v' ? { left: p, top: 0 } : { top: p, left: 0 }}
              onPointerDown={(e) => startGuideDrag(g.axis, e, g.id)}
              onDoubleClick={() => setGuides(prev => prev.filter(x => x.id !== g.id))}
              aria-label="参考线 · 拖动移动 · 拖回标尺或双击删除"
            >
              <div className={`${g.axis === 'v' ? 'mx-auto h-full w-px' : 'my-auto mt-[3px] h-px w-full'}`} style={{ backgroundColor: '#0EA5E9' }} />
            </div>
          );
        })}

        {/* 属性精确输入条（单选：X/Y/W/H，文本另有字号） */}
        {singleNode && !armedNode && !pinDraft && !touchDraft && (
          <div
            data-canvas-ui
            className={`pointer-events-auto absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-ink-200/70 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 ${centerBarCls}`}
            style={centerBarStyle}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {([['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h']] as const).map(([lab, key]) => (
              <React.Fragment key={key}>
                {/* 锁定比例开关放在 W 与 H 之间 */}
                {key === 'h' && (
                  <Tip label={ratioLock ? '解锁比例（W/H 独立修改）' : '锁定比例（改 W 同步 H）'}>
                    <button
                      onClick={() => setRatioLock(v => !v)}
                      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${ratioLock ? 'bg-accent-50 text-accent-600' : 'text-ink-300 hover:text-ink-600'}`}
                    >
                      {ratioLock ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                    </button>
                  </Tip>
                )}
                <label className="flex items-center gap-1 text-[10px] font-black text-ink-400">
                  {lab}
                  <input
                    key={`${singleNode.id}_${key}_${Math.round(singleNode[key])}`}
                    data-prop={key}
                    defaultValue={Math.round(singleNode[key])}
                    onKeyDown={(e) => numericKeys(e, key, (v) => {
                      const frame: { x?: number; y?: number; w?: number; h?: number } = { [key]: key === 'w' || key === 'h' ? Math.max(40, v) : v };
                      // 锁定比例：改 W 同步 H、改 H 同步 W
                      if (ratioLock && key === 'w') frame.h = Math.max(40, Math.round(Math.max(40, v) * (singleNode.h / singleNode.w)));
                      if (ratioLock && key === 'h') frame.w = Math.max(40, Math.round(Math.max(40, v) * (singleNode.w / singleNode.h)));
                      onSetNodeFrame(singleNode.id, frame);
                    })}
                    className="w-14 rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums text-ink-700 outline-none focus:border-accent-400"
                    aria-label={`${lab} · 回车提交 · ↑↓ 步进（Shift=10）`}
                  />
                </label>
              </React.Fragment>
            ))}
            <label className="flex items-center gap-1 text-[10px] font-black text-ink-400">
              透明
              <input
                key={`${singleNode.id}_op_${Math.round((singleNode.opacity ?? 1) * 100)}`}
                data-prop="op"
                defaultValue={Math.round((singleNode.opacity ?? 1) * 100)}
                onKeyDown={(e) => numericKeys(e, 'op', (v) => onSetNodeFrame(singleNode.id, { opacity: Math.max(0, Math.min(100, v)) / 100 }))}
                className="w-12 rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums text-ink-700 outline-none focus:border-accent-400"
                aria-label="不透明度 % · 回车提交 · ↑↓ 步进"
              />
            </label>
            {singleNode.kind === 'text' && (
              <label className="flex items-center gap-1 text-[10px] font-black text-ink-400">
                字号
                <input
                  key={`${singleNode.id}_fs_${singleNode.fontSize}`}
                  data-prop="fs"
                  defaultValue={singleNode.fontSize ?? 32}
                  onKeyDown={(e) => numericKeys(e, 'fs', (v) => onSetNodeFrame(singleNode.id, { fontSize: Math.max(8, Math.min(400, v)) }))}
                  className="w-12 rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums text-ink-700 outline-none focus:border-accent-400"
                  aria-label="字号 · 回车提交 · ↑↓ 步进"
                />
              </label>
            )}
          </div>
        )}

        {/* 多选公共属性条（§10.2）：批量 W/H/透明度，值不一致显示「多值」 */}
        {!singleNode && !armedNode && !pinDraft && !touchDraft && (() => {
          const selNodes = nodes.filter(n => selectedIds.has(n.id) && !n.locked);
          if (selNodes.length < 2) return null;
          const common = (get: (n: CanvasNodeData) => number) => {
            const v0 = Math.round(get(selNodes[0]));
            return selNodes.every(n => Math.round(get(n)) === v0) ? String(v0) : '';
          };
          const fields: Array<{ lab: string; ph: string; get: (n: CanvasNodeData) => number; apply: (n: CanvasNodeData, v: number) => { w?: number; h?: number; opacity?: number } }> = [
            { lab: 'W', ph: common(n => n.w) || '多值', get: n => n.w, apply: (n, v) => { const w = Math.max(40, v); return ratioLock ? { w, h: Math.max(40, Math.round(w * (n.h / n.w))) } : { w }; } },
            { lab: 'H', ph: common(n => n.h) || '多值', get: n => n.h, apply: (n, v) => { const h = Math.max(40, v); return ratioLock ? { h, w: Math.max(40, Math.round(h * (n.w / n.h))) } : { h }; } },
            { lab: '透明', ph: common(n => (n.opacity ?? 1) * 100) || '多值', get: n => (n.opacity ?? 1) * 100, apply: (_n, v) => ({ opacity: Math.max(0, Math.min(100, v)) / 100 }) },
          ];
          return (
            <div
              data-canvas-ui
              className={`pointer-events-auto absolute left-1/2 top-[6.75rem] z-40 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-2xl border border-ink-200/70 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 ${centerBarCls}`}
              style={centerBarStyle}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="text-[10px] font-black text-accent-600">已选 {selNodes.length}</span>
              {fields.map(f => (
                <label key={f.lab} className="flex items-center gap-1 text-[10px] font-black text-ink-400">
                  {f.lab}
                  <input
                    key={`multi_${f.lab}_${selNodes.map(n => n.id).join(',')}_${f.ph}`}
                    data-prop={`multi_${f.lab}`}
                    defaultValue={f.ph === '多值' ? '' : f.ph}
                    placeholder={f.ph === '多值' ? '多值' : undefined}
                    onKeyDown={(e) => numericKeys(e, `multi_${f.lab}`, (v) => selNodes.forEach(n => onSetNodeFrame(n.id, f.apply(n, v))))}
                    className="w-14 rounded-md border border-ink-200 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums text-ink-700 outline-none placeholder:text-ink-300 focus:border-accent-400"
                    aria-label={`批量 ${f.lab} · 回车应用 · ↑↓ 步进`}
                  />
                </label>
              ))}
              <Tip label={ratioLock ? '解锁比例' : '锁定比例（批量改 W/H 各自同比）'}>
                <button
                  onClick={() => setRatioLock(v => !v)}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${ratioLock ? 'bg-accent-50 text-accent-600' : 'text-ink-300 hover:text-ink-600'}`}
                >
                  {ratioLock ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                </button>
              </Tip>
            </div>
          );
        })()}

        {/* 选中节点信息行：图片节点标题已在卡片头部，这里只补充原始尺寸（右）；文本节点无头部则显示标题 */}
        {singleNode && (() => {
          const tl = worldToScreen(singleNode.x, singleNode.y);
          const isText = singleNode.kind === 'text';
          if (!isText && !dims) return null;
          return (
            <div
              className="absolute flex -translate-y-full items-center justify-between gap-3 whitespace-nowrap pb-1.5 text-[12px] font-bold text-accent-600"
              style={{ left: tl.x, top: tl.y, width: singleNode.w * view.k }}
            >
              {isText ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Type className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{singleNode.label}</span>
                </span>
              ) : <span />}
              {dims && <span className="shrink-0 tabular-nums text-accent-500/80">{dims}</span>}
            </div>
          );
        })()}

        {/* Lovart 式快捷编辑条（固定跟随选中图下方，图标+文字） */}
        {singleNode && barPos && !armedNode && !pinDraft && !touchDraft && (
          <div
            ref={quickBarRef}
            data-canvas-ui
            className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded-2xl border border-ink-200/70 bg-white/95 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in duration-150 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ left: barPos.x, top: barPos.y, maxWidth: barPos.maxW }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* 品牌章（Lovart 式「快捷编辑 Tab」入口标识） */}
            <span className="mr-1 flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-ink-900 px-2.5 py-1.5 text-[11px] font-black text-white">
              <Sparkles className="h-3.5 w-3.5 text-accent-300" />
              快捷编辑
              <kbd className="rounded bg-white/15 px-1 py-px text-[9px] font-bold text-white/80">Tab</kbd>
            </span>
            {singleNode.url && singleNode.status === 'completed' && (
              <>
                <QuickButton tip="AI 重渲为 4K 超清大图" icon={<ZoomIn className="h-4 w-4" />} label="HD 放大" onClick={() => onUpscale(singleNode.id)} />
                <QuickButton tip="白底抠图，生成透明底 PNG" icon={<Scissors className="h-4 w-4" />} label="去背景" onClick={() => onCutout(singleNode.id)} />
                <QuickButton tip="点哪擦哪：点击元素，AI 识别后自动无痕移除" icon={<Eraser className="h-4 w-4" />} label="橡皮工具" onClick={() => { setArmedNode({ nodeId: singleNode.id, mode: 'erase' }); setMoreOpen(false); }} />
                <QuickButton tip="点击图内任意元素，识别后直接修改（换色/移除/自由指令）" icon={<MousePointerClick className="h-4 w-4" />} label="编辑元素" onClick={() => { setArmedNode({ nodeId: singleNode.id, mode: 'element' }); setMoreOpen(false); }} />
                <QuickButton tip="点击图内文字，识别原文后直接改写（保持字体样式）" icon={<Type className="h-4 w-4" />} label="编辑文字" onClick={() => { setArmedNode({ nodeId: singleNode.id, mode: 'text' }); setMoreOpen(false); }} />
                <QuickButton tip="同一要求生成另一种构图/角度的版本" icon={<Shuffle className="h-4 w-4" />} label="多角度" onClick={() => onVariation(singleNode.id)} />
                <QuickButton tip="点击元素后描述移动位置，如：移到画面左下角" icon={<Move className="h-4 w-4" />} label="移动对象" onClick={() => { setArmedNode({ nodeId: singleNode.id, mode: 'move' }); setMoreOpen(false); }} />
                {(singleNode.pins?.length ?? 0) > 0 && (
                  <QuickButton accent tip={`一次执行全部 ${singleNode.pins!.length} 条批注`} icon={<Play className="h-4 w-4" />} label={`执行批注 ${singleNode.pins!.length}`} onClick={() => onRunPins(singleNode.id, singleNode.pins!)} />
                )}
                <div className="relative">
                  <QuickButton iconOnly tip="更多操作" icon={<MoreHorizontal className="h-4 w-4" />} menuOpen={moreOpen} menuId="canvas-more-menu" onClick={() => setMoreOpen(o => !o)} />
                  {moreOpen && (
                    <div ref={moreMenuRef} role="menu" id="canvas-more-menu" aria-label="图片更多操作" className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-2xl border border-ink-200/80 bg-white p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
                      {[
                        { icon: <Pin className="h-4 w-4" />, label: '快捷批注（标记修改点）', act: () => setArmedNode({ nodeId: singleNode.id, mode: 'pin' }) },
                        { icon: <MoveHorizontal className="h-4 w-4" />, label: '扩图为 16:9 横幅', act: () => onOutpaint(singleNode.id) },
                        { icon: <Layers className="h-4 w-4" />, label: '分解图层（画板内编辑）', act: () => onDecomposeLayers(singleNode.id) },
                        { icon: <Layers className="h-4 w-4" />, label: '分层 PSD 导出', act: () => onExportPsd(singleNode.id) },
                        { icon: <PenTool className="h-4 w-4" />, label: 'SVG 矢量导出', act: () => onExportSvg(singleNode.id) },
                        { icon: <Download className="h-4 w-4" />, label: '下载 JPG（白底）', act: () => onDownloadJpg(singleNode.id) },
                        { icon: <Download className="h-4 w-4" />, label: '导出 PDF', act: () => onDownloadPdf(singleNode.id) },
                        { icon: <ImagePlus className="h-4 w-4" />, label: '设为参考图', act: () => onUseAsRef(singleNode.id) },
                        { icon: <Copy className="h-4 w-4" />, label: '复制一份', act: () => onDuplicate(singleNode.id) },
                        { icon: <Maximize2 className="h-4 w-4" />, label: '预览大图', act: () => onPreview(singleNode.id) },
                      ].map(item => (
                        <button
                          role="menuitem"
                          key={item.label}
                          onClick={() => { setMoreOpen(false); item.act(); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold text-ink-700 transition-colors hover:bg-ink-100 hover:text-accent-700"
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))}
                      <div className="my-1 h-px bg-ink-100" />
                      <button
                        role="menuitem"
                        onClick={() => { setMoreOpen(false); onDelete([singleNode.id]); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold text-red-500 transition-colors hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        删除该节点
                      </button>
                    </div>
                  )}
                </div>
                <div className="mx-0.5 h-4 w-px bg-ink-200" />
                <QuickButton iconOnly tip="下载 PNG" icon={<Download className="h-4 w-4" />} onClick={() => onDownloadNode(singleNode.id)} />
              </>
            )}
            {singleNode.status === 'error' && (
              <>
                <QuickButton tip="按原提示词重新生成" icon={<RefreshCw className="h-4 w-4" />} label="重新生成" onClick={() => onRetry(singleNode.id)} />
                <QuickButton iconOnly danger tip="删除该节点" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete([singleNode.id])} />
              </>
            )}
            {singleNode.status === 'processing' && (
              <QuickButton iconOnly danger tip="删除该节点" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete([singleNode.id])} />
            )}
          </div>
        )}

        {/* 批注图钉标记 */}
        {singleNode?.pins?.map((pin, i) => {
          const imgH = singleNode.h - NODE_FOOTER;
          const pos = worldToScreen(
            singleNode.x + (pin.xPct / 100) * singleNode.w,
            singleNode.y + NODE_FOOTER + (pin.yPct / 100) * imgH,
          );
          return (
            <Tip key={pin.id} label={pin.text.length > 24 ? pin.text.slice(0, 24) + '…' : pin.text}>
              <button
                data-canvas-ui
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => openExistingPin(singleNode.id, pin)}
                className="pointer-events-auto absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-[10px] font-black text-white shadow-lg transition-transform hover:scale-110"
                style={{ left: pos.x, top: pos.y }}
              >
                {i + 1}
              </button>
            </Tip>
          );
        })}

        {/* 图钉草稿弹层 */}
        {pinDraft && pinDraftNode && (() => {
          const imgH = pinDraftNode.h - NODE_FOOTER;
          const pos = worldToScreen(
            pinDraftNode.x + (pinDraft.xPct / 100) * pinDraftNode.w,
            pinDraftNode.y + NODE_FOOTER + (pinDraft.yPct / 100) * imgH,
          );
          return (
            <div data-canvas-ui className="pointer-events-auto absolute" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="absolute -left-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-500 shadow-lg animate-in zoom-in duration-200">
                <Pin className="h-3 w-3 text-white" />
              </div>
              <div className="absolute left-4 top-4 w-72 rounded-2xl border border-ink-200/80 bg-white p-3 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">
                    {pinDraft.editingPinId ? '编辑批注' : '快捷批注 · 标记此处'}
                  </p>
                  <button onClick={() => setPinDraft(null)} aria-label="取消" className="flex h-5 w-5 items-center justify-center rounded-full text-ink-300 hover:bg-ink-100 hover:text-ink-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <textarea
                  autoFocus
                  value={pinText}
                  onChange={(e) => setPinText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); savePinToQueue(); }
                    if (e.key === 'Escape') setPinDraft(null);
                  }}
                  placeholder="描述该位置要怎么改，如：把这里的按钮改成红色"
                  className="h-16 w-full resize-none rounded-lg border border-ink-200 bg-ink-100/50 p-2 text-xs leading-relaxed text-ink-700 outline-none transition-all placeholder:text-ink-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/15"
                />
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={savePinToQueue}
                    disabled={!pinText.trim()}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-black transition-all ${pinText.trim() ? 'bg-ink-900 text-white hover:bg-ink-700 active:scale-95' : 'cursor-not-allowed bg-ink-100 text-ink-300'}`}
                  >
                    <ListPlus className="h-3 w-3" /> {pinDraft.editingPinId ? '保存批注' : '加入队列'}
                  </button>
                  <button
                    onClick={runPinNow}
                    disabled={!pinText.trim()}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-black transition-all ${pinText.trim() ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600 active:scale-95' : 'cursor-not-allowed bg-ink-100 text-ink-300'}`}
                  >
                    <Send className="h-3 w-3" /> 立即修改
                  </button>
                  {pinDraft.editingPinId && (
                    <Tip label="删除该批注">
                      <button onClick={deleteDraftPin} className="flex h-full items-center justify-center rounded-lg px-2.5 text-ink-400 transition-colors hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tip>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Touch Edit 触点弹层 */}
        {touchDraft && touchDraftNode && (() => {
          const imgH = touchDraftNode.h - NODE_FOOTER;
          const pos = worldToScreen(
            touchDraftNode.x + (touchDraft.xPct / 100) * touchDraftNode.w,
            touchDraftNode.y + NODE_FOOTER + (touchDraft.yPct / 100) * imgH,
          );
          return (
            <div data-canvas-ui className="pointer-events-auto absolute" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="absolute -left-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-accent-600 shadow-lg animate-in zoom-in duration-200">
                <MousePointerClick className="h-3 w-3 text-white" />
              </div>
              <div className="absolute left-4 top-4 w-80 rounded-2xl border border-ink-200/80 bg-white p-3 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-accent-600">
                    Touch Edit · {touchDraft.intent === 'move' ? '移动对象' : touchDraft.intent === 'erase' ? '橡皮工具' : touchDraft.focus === 'text' ? '编辑文字' : '编辑元素'}
                  </p>
                  <button onClick={() => setTouchDraft(null)} aria-label="取消" className="flex h-5 w-5 items-center justify-center rounded-full text-ink-300 hover:bg-ink-100 hover:text-ink-500">
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {touchDraft.status === 'identifying' && (
                  <div className="flex items-center gap-2 py-4 text-xs text-ink-500">
                    <Loader2 className="h-4 w-4 animate-spin text-accent-600" />
                    正在识别该位置的元素…
                  </div>
                )}

                {touchDraft.status !== 'identifying' && (
                  <div className="space-y-2.5">
                    <p className="rounded-lg bg-ink-100/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-700">
                      {touchDraft.status === 'ready'
                        ? <>识别到：<span className="font-bold">{touchDraft.element}</span></>
                        : '未能自动识别（可直接用自由指令描述要改的内容）'}
                    </p>

                    {/* 改文字 */}
                    {touchDraft.text && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-ink-400">改文字（原文已填入）</label>
                        <div className="flex gap-1.5">
                          <input
                            autoFocus
                            value={touchTextValue}
                            onChange={(e) => setTouchTextValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                runTouch(`Replace the text "${touchDraft.text}" with "${touchTextValue}".`);
                              }
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-100/50 px-2.5 py-2 text-xs text-ink-700 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-500/10"
                          />
                          <Tip label="按新文字重绘，保持原字体样式">
                            <button
                              onClick={() => runTouch(`Replace the text "${touchDraft.text}" with "${touchTextValue}".`)}
                              disabled={!touchTextValue.trim() || touchTextValue === touchDraft.text}
                              className={`rounded-lg px-3 text-[11px] font-black transition-all ${touchTextValue.trim() && touchTextValue !== touchDraft.text ? 'bg-accent-600 text-white hover:bg-accent-700' : 'cursor-not-allowed bg-ink-100 text-ink-300'}`}
                            >
                              改字
                            </button>
                          </Tip>
                        </div>
                      </div>
                    )}

                    {/* 换色（移动对象模式下隐藏，聚焦位置指令） */}
                    {touchDraft.intent !== 'move' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-ink-400">一键换色</label>
                      <div className="flex gap-1.5">
                        {RECOLOR_SWATCHES.map(s => (
                          <Tip key={s.hex} label={`把该元素换成${s.name}色`}>
                            <button
                              onClick={() => runTouch(`Recolor it to ${s.en} (${s.hex}). Keep its shape, texture and lighting.`)}
                              className="h-7 w-7 rounded-full border-2 border-white shadow ring-1 ring-ink-200 transition-transform hover:scale-110"
                              style={{ backgroundColor: s.hex }}
                            />
                          </Tip>
                        ))}
                        <Tip label="将该元素无痕移除并补全背景">
                          <button
                            onClick={() => runTouch('Remove it completely and seamlessly inpaint the area behind it.')}
                            className="flex h-7 items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 text-[10px] font-black text-ink-500 transition-colors hover:border-red-200 hover:text-red-500"
                          >
                            <Eraser className="h-3 w-3" /> 移除
                          </button>
                        </Tip>
                      </div>
                    </div>
                    )}

                    {/* 自由指令 / 移动位置 */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-ink-400">
                        {touchDraft.intent === 'move' ? '移到哪里' : '自由指令'}
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          autoFocus={!touchDraft.text}
                          value={touchCustomValue}
                          onChange={(e) => setTouchCustomValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              runTouch(touchDraft.intent === 'move' ? `Move it: ${touchCustomValue}. Inpaint the area it leaves behind.` : touchCustomValue);
                            }
                          }}
                          placeholder={touchDraft.intent === 'move' ? '如：移到画面左下角、与主体水平对齐' : '如：改成磨砂金属质感'}
                          className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-100/50 px-2.5 py-2 text-xs text-ink-700 outline-none placeholder:text-ink-300 focus:border-accent-400 focus:ring-2 focus:ring-accent-500/10"
                        />
                        <Tip label={touchDraft.intent === 'move' ? '按描述移动该元素并补全原位置' : '按自由指令修改该元素'}>
                          <button
                            onClick={() => runTouch(touchDraft.intent === 'move' ? `Move it: ${touchCustomValue}. Inpaint the area it leaves behind.` : touchCustomValue)}
                            disabled={!touchCustomValue.trim()}
                            className={`rounded-lg px-3 text-[11px] font-black transition-all ${touchCustomValue.trim() ? 'bg-ink-900 text-white hover:bg-accent-700' : 'cursor-not-allowed bg-ink-100 text-ink-300'}`}
                          >
                            应用
                          </button>
                        </Tip>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (() => {
        const sel = [...selectedRef.current];
        const targetNode = ctxMenu.nodeId ? nodes.find(n => n.id === ctxMenu.nodeId) : null;
        const item = (label: string, act: () => void, opts?: { danger?: boolean; kbd?: string }) => (
          <button
            role="menuitem"
            key={label}
            onClick={() => { setCtxMenu(null); act(); }}
            className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-1.5 text-left text-xs font-bold transition-colors ${opts?.danger ? 'text-red-500 hover:bg-red-50' : 'text-ink-700 hover:bg-ink-100'}`}
          >
            {label}
            {opts?.kbd && <span className="text-[10px] font-medium text-ink-300">{opts.kbd}</span>}
          </button>
        );
        return (
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label={targetNode ? '画布对象操作' : '画布操作'}
            data-canvas-ui
            className="absolute z-[70] w-44 overflow-y-auto rounded-2xl border border-ink-200/80 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.min(ctxMenu.x, (containerRef.current?.clientWidth ?? 600) - 190),
              top: Math.max(8, Math.min(ctxMenu.y, (containerRef.current?.clientHeight ?? 600) - (targetNode ? 700 : 240))),
              // 矮视口下菜单可滚动而不溢出屏幕
              maxHeight: (containerRef.current?.clientHeight ?? 600) - 16,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {targetNode ? (
              <>
                {item('复制', onCopySelection, { kbd: '⌘C' })}
                {item('剪切', onCutSelection, { kbd: '⌘X' })}
                {item('原位复制', () => { onCopySelection(); onPasteClipboard(); }, { kbd: '⌘D' })}
                {sel.length > 1 && item('组合', onGroup, { kbd: '⌘G' })}
                {targetNode.groupId && item('取消组合', onUngroup, { kbd: '⌘⇧G' })}
                <div className="my-1 h-px bg-ink-100" />
                {item('置于顶层', () => onBringToFront(sel))}
                {item('上移一层', () => onMoveLayerStep(targetNode.id, 'up'))}
                {item('下移一层', () => onMoveLayerStep(targetNode.id, 'down'))}
                {item('置于底层', () => onSendToBack(sel))}
                <div className="my-1 h-px bg-ink-100" />
                {item(targetNode.locked ? '解锁' : '锁定', () => onToggleLock(targetNode.id))}
                {item(targetNode.hidden ? '显示' : '隐藏', () => onToggleHide(targetNode.id))}
                {item('在图层中定位', () => onRevealInLayers(targetNode.id))}
                <div className="my-1 h-px bg-ink-100" />
                {targetNode.url && targetNode.kind !== 'text' && (
                  <>
                    {item('旋转 90°', () => onTransformNode(targetNode.id, 'rot90'))}
                    {item('水平翻转', () => onTransformNode(targetNode.id, 'flipH'))}
                    {item('垂直翻转', () => onTransformNode(targetNode.id, 'flipV'))}
                    <div className="my-1 h-px bg-ink-100" />
                  </>
                )}
                {targetNode.url && targetNode.status === 'completed' && item('创建变体', () => onVariation(targetNode.id))}
                {item('复制样式', () => onCopyStyle(targetNode.id))}
                {item(`粘贴样式${sel.length > 1 ? ` (${sel.length})` : ''}`, () => onPasteStyle(sel))}
                <div className="my-1 h-px bg-ink-100" />
                {targetNode.url && targetNode.status === 'completed' && item('下载 PNG', () => onDownloadNode(targetNode.id))}
                {sel.length > 1 && item(`导出选中 ${sel.length} 张（ZIP）`, onExportSelection)}
                {targetNode.url && targetNode.kind !== 'text' && item('替换图片…', () => onReplaceImage(targetNode.id))}
                {targetNode.url && targetNode.status === 'completed' && item('设为参考图', () => onUseAsRef(targetNode.id))}
                {targetNode.url && targetNode.status === 'completed' && item('预览大图', () => onPreview(targetNode.id))}
                <div className="my-1 h-px bg-ink-100" />
                {item(`删除${sel.length > 1 ? ` ${sel.length} 项` : ''}`, () => onDelete(sel), { danger: true, kbd: '⌫' })}
              </>
            ) : (
              <>
                {item('粘贴', onPasteClipboard, { kbd: '⌘V' })}
                {item('全选', onSelectAll, { kbd: '⌘A' })}
                {item('适配视图', () => { const box = nodesBBox(nodesRef.current); if (box) fitRect(box); }, { kbd: '⌘0' })}
                {item(rulersOn ? '隐藏标尺' : '显示标尺', () => setRulersOn(v => !v))}
                {guides.length > 0 && item(`清除全部参考线 (${guides.length})`, () => setGuides([]))}
                <div className="my-1 h-px bg-ink-100" />
                <div className="px-3 pb-1 pt-1.5">
                  <p className="mb-1.5 text-[9.5px] font-black uppercase tracking-wider text-ink-300">画布背景</p>
                  <div className="flex items-center gap-1.5">
                    {([['#F5F5F7', '默认灰'], ['#FFFFFF', '纯白'], ['#F6F5F1', '暖纸'], ['#E8ECF1', '冷灰'], ['#1E1E20', '深空']] as const).map(([c, name]) => (
                      <button
                        key={c}
                        role="menuitemradio"
                        aria-label={name}
                        aria-checked={(canvasBg ?? '#F5F5F7') === c}
                        onClick={() => { setCtxMenu(null); onSetCanvasBg(c === '#F5F5F7' ? null : c); }}
                        className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${(canvasBg ?? '#F5F5F7') === c ? 'border-accent-500 ring-2 ring-accent-200' : 'border-ink-200'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* 框选矩形 */}
      {marquee && (
        <div
          className="pointer-events-none absolute z-40 rounded-sm border border-accent-500 bg-accent-500/10"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {/* 引线文字标注输入弹层：目标点圆点 + 右上文字框（预示引线布局）；回车或 ✓ 提交，Esc 取消 */}
      {annTextDraft && (() => {
        const pos = worldToScreen(annTextDraft.x, annTextDraft.y);
        return (
          <div data-canvas-ui className="pointer-events-none absolute z-50" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
            {/* 目标点 + 引线预览 */}
            <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow" />
            <svg className="absolute overflow-visible" width="1" height="1" style={{ left: 0, top: 0 }}>
              <line x1={0} y1={0} x2={58} y2={-42} stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 3" />
            </svg>
            <div className="pointer-events-auto absolute flex items-center gap-1 rounded-lg border-2 border-red-400 bg-white px-1.5 py-1 shadow-lg" style={{ left: 58, top: -58 }}>
              <input
                autoFocus
                value={annTextValue}
                onChange={(e) => setAnnTextValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commitAnnText(); }
                  if (e.key === 'Escape') { setAnnTextDraft(null); setAnnTextValue(''); }
                }}
                placeholder="输入标注文字"
                className="w-44 bg-transparent px-1 text-sm font-bold text-red-500 outline-none placeholder:text-ink-300"
              />
              <button onClick={commitAnnText} aria-label="确定" className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500 text-white transition-colors hover:bg-red-600">
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* 多选对齐 / 分布工具条（§7.3） */}
      {selectedIds.size >= 2 && !armedNode && !pinDraft && !touchDraft && tool === 'select' && (
        <div
          data-canvas-ui
          className={`absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-2xl border border-ink-200/70 bg-white/95 p-1.5 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 ${centerBarCls}`}
          style={centerBarStyle}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="mr-1 whitespace-nowrap px-1.5 text-[10px] font-black uppercase tracking-widest text-ink-400">对齐 {selectedIds.size}</span>
          <Tip label="左对齐"><button onClick={() => onAlign('left')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignStartVertical className="h-4 w-4" /></button></Tip>
          <Tip label="水平居中"><button onClick={() => onAlign('hcenter')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignCenterVertical className="h-4 w-4" /></button></Tip>
          <Tip label="右对齐"><button onClick={() => onAlign('right')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignEndVertical className="h-4 w-4" /></button></Tip>
          <div className="mx-0.5 h-4 w-px bg-ink-200" />
          <Tip label="顶部对齐"><button onClick={() => onAlign('top')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignStartHorizontal className="h-4 w-4" /></button></Tip>
          <Tip label="垂直居中"><button onClick={() => onAlign('vcenter')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignCenterHorizontal className="h-4 w-4" /></button></Tip>
          <Tip label="底部对齐"><button onClick={() => onAlign('bottom')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignEndHorizontal className="h-4 w-4" /></button></Tip>
          <div className="mx-0.5 h-4 w-px bg-ink-200" />
          <Tip label="水平均匀分布（需 ≥3）"><button onClick={() => onDistribute('h')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignHorizontalDistributeCenter className="h-4 w-4" /></button></Tip>
          <Tip label="垂直均匀分布（需 ≥3）"><button onClick={() => onDistribute('v')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-accent-700"><AlignVerticalDistributeCenter className="h-4 w-4" /></button></Tip>
        </div>
      )}

      {/* 模式提示条：按上方已占位的工具条（单选属性条 / 多选对齐+批量条）下移，避免相互遮挡 */}
      {(armedNode || tool === 'pin' || tool === 'shape' || tool === 'draw' || tool === 'text') && !pinDraft && !touchDraft && !annTextDraft && (
        <div
          className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
          style={{ top: selectedIds.size >= 2 ? 168 : singleNode ? 120 : 80 }}
        >
          <div className="flex items-center gap-2 rounded-full bg-ink-900/90 px-4 py-2 text-xs font-bold text-white shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2">
            {armedNode?.mode === 'element' ? <><MousePointerClick className="h-3.5 w-3.5 text-accent-300" />点击图内要修改的元素 · Esc 取消</>
              : armedNode?.mode === 'text' ? <><Type className="h-3.5 w-3.5 text-accent-300" />点击图内要改写的文字 · Esc 取消</>
              : armedNode?.mode === 'erase' ? <><Eraser className="h-3.5 w-3.5 text-red-300" />橡皮工具：点击要擦除的元素，识别后自动无痕移除 · Esc 取消</>
              : armedNode?.mode === 'move' ? <><Move className="h-3.5 w-3.5 text-accent-300" />移动对象：点击要移动的元素 · Esc 取消</>
              : tool === 'shape' ? <><Square className="h-3.5 w-3.5 text-red-300" />{SHAPE_MENU.find(s => s.kind === shapeKind)?.label}标注：拖拽绘制圈出要改的区域 · 点选标注后 Delete 删除 · Esc/V 退出</>
              : tool === 'draw' ? <><Pencil className="h-3.5 w-3.5 text-red-300" />画笔标注：自由圈注要改的地方 · 点选标注后 Delete 删除 · Esc/V 退出</>
              : tool === 'text' ? <><Type className="h-3.5 w-3.5 text-accent-300" />文本元素：点击画板放置文字（可拖动/双击编辑） · Esc/V 退出</>
              : <><Pin className="h-3.5 w-3.5 text-amber-400" />批注模式：点击图片上要修改的位置 · Esc 退出</>}
          </div>
        </div>
      )}

      {/* 组内编辑提示条（同样避让属性条） */}
      {editingGroupId && (
        <div
          className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
          style={{ top: selectedIds.size >= 2 ? 168 : singleNode ? 120 : 80 }}
        >
          <div className="flex items-center gap-2 rounded-full bg-ink-900/90 px-4 py-2 text-xs font-bold text-white shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2">
            <Layers className="h-3.5 w-3.5 text-accent-300" />组内编辑：点击成员单独选中/拖动 · 点击空白处退出
          </div>
        </div>
      )}

      {/* 空画板引导 */}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto flex max-w-md flex-col items-center gap-5 rounded-3xl border border-ink-200/60 bg-white/70 px-12 py-12 text-center shadow-sm backdrop-blur-md">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-600 to-accent-800 shadow-lg shadow-accent-600/25">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-black tracking-tight text-ink-900">创意画板已就绪</h2>
              <p className="text-sm leading-relaxed text-ink-500">
                {hasRefs
                  ? '素材已就位 — 在右侧直接说出想要的画面，或选择工作流一键生成。'
                  : '拖拽 / 粘贴产品实拍图，或在右侧直接用文字描述想要的画面。'}
              </p>
            </div>
            {!hasRefs && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onUploadClick}
                className="flex items-center gap-2 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-accent-700 active:scale-95"
              >
                <UploadCloud className="h-4 w-4" /> 上传产品图
              </button>
            )}
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-ink-300">滚轮平移 · ⌘+滚轮缩放 · 空格拖拽</p>
          </div>
        </div>
      )}

      {/* 底部居中工具坞（Lovart 式） */}
      <div
        className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-ink-200/70 bg-white/95 p-1.5 shadow-lg backdrop-blur-md"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 选择 / 批注 / 上传 */}
        <Tip label="选择工具 (V)"><button onClick={() => setTool('select')} className={dockBtn(tool === 'select')}><MousePointer2 className="h-4 w-4" /></button></Tip>
        <Tip label="批注工具 (P)：点击任意图片标记修改点">
          <button onClick={() => setTool(t => (t === 'pin' ? 'select' : 'pin'))} className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${tool === 'pin' ? 'bg-amber-500 text-white' : 'text-ink-500 hover:bg-ink-100'}`}>
            <Pin className="h-4 w-4" />
          </button>
        </Tip>
        <Tip label="上传产品图 / 参考图"><button onClick={onUploadClick} className={dockBtn(false)}><UploadCloud className="h-4 w-4" /></button></Tip>
        <div className="mx-1 h-5 w-px bg-ink-200" />
        {/* 整理 / 矩形 / 画笔 / 文字 */}
        <Tip label="整理排列：把画板成图对齐为网格"><button onClick={onArrange} className={dockBtn(false)}><LayoutGrid className="h-4 w-4" /></button></Tip>
        <div className="relative">
          <Tip label="形状标注：框/圈需要修改的区域（追问重绘时可作为 AI 指引烧入图中）">
            <button aria-label="形状标注" aria-haspopup="menu" aria-expanded={shapeMenuOpen} aria-controls="canvas-shape-menu" onClick={() => setShapeMenuOpen(o => !o)} className={dockBtn(tool === 'shape')}>{SHAPE_ICONS[shapeKind]}</button>
          </Tip>
          {shapeMenuOpen && (
            <div ref={shapeMenuRef} role="menu" id="canvas-shape-menu" aria-label="形状标注选项" className="absolute bottom-full left-1/2 z-50 mb-2 w-44 -translate-x-1/2 rounded-2xl border border-ink-200/80 bg-white p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
              {SHAPE_MENU.map(s => (
                <button
                  key={s.kind}
                  role="menuitemradio"
                  aria-checked={shapeKind === s.kind && tool === 'shape'}
                  onClick={() => { setShapeKind(s.kind); setTool('shape'); setShapeMenuOpen(false); }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors ${shapeKind === s.kind && tool === 'shape' ? 'bg-accent-50/70 text-accent-700' : 'text-ink-700 hover:bg-ink-100'}`}
                >
                  {SHAPE_ICONS[s.kind]}
                  {s.label}
                  {s.hotkey && <span className="ml-auto text-[10px] text-ink-300">{s.hotkey}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <Tip label="画笔标注：自由圈注要改的地方（追问重绘时可作为 AI 指引烧入图中）"><button onClick={() => setTool(t => (t === 'draw' ? 'select' : 'draw'))} className={dockBtn(tool === 'draw')}><Pencil className="h-4 w-4" /></button></Tip>
        <Tip label="文本元素 (T)：点击画板添加可编辑文字；引线标注在形状菜单"><button onClick={() => setTool(t => (t === 'text' ? 'select' : 'text'))} className={dockBtn(tool === 'text')}><Type className="h-4 w-4" /></button></Tip>
        <div className="mx-1 h-5 w-px bg-ink-200" />
        {/* 图生图 / 图生视频 / 文生图 */}
        <Tip label="图生图：以参考图生成新图"><button onClick={onImageToImage} className={dockBtn(false)}><Images className="h-4 w-4" /></button></Tip>
        <Tip label="图生视频（需接入视频模型，暂未启用）"><button onClick={onImageToVideo} className={dockBtn(false)}><Clapperboard className="h-4 w-4" /></button></Tip>
        <Tip label="文生图：直接用文字描述生成"><button onClick={onTextToImage} className={dockBtn(false)}><WandSparkles className="h-4 w-4" /></button></Tip>
      </div>

      {/* 小地图（§7.1）：全部内容概览 + 当前视口框，点击/拖动跳转 */}
      {nodes.length > 0 && (() => {
        const el = containerRef.current;
        if (!el) return null;
        const MW = 168, MH = 112, PAD = 8;
        const list = nodes.filter(n => !n.hidden);
        if (list.length === 0) return null;
        const bx = Math.min(...list.map(n => n.x)) - 200;
        const by = Math.min(...list.map(n => n.y)) - 200;
        const br = Math.max(...list.map(n => n.x + n.w)) + 200;
        const bb = Math.max(...list.map(n => n.y + n.h)) + 200;
        const scale = Math.min((MW - PAD * 2) / (br - bx), (MH - PAD * 2) / (bb - by));
        const toMini = (wx: number, wy: number) => ({ x: PAD + (wx - bx) * scale, y: PAD + (wy - by) * scale });
        // 当前视口（世界坐标）
        const vp = { x: -view.x / view.k, y: -view.y / view.k, w: el.clientWidth / view.k, h: el.clientHeight / view.k };
        const vpM = toMini(vp.x, vp.y);
        const jumpTo = (clientX: number, clientY: number, rect: DOMRect) => {
          const wx = bx + (clientX - rect.left - PAD) / scale;
          const wy = by + (clientY - rect.top - PAD) / scale;
          const t = tRef.current;
          tRef.current = { k: t.k, x: el.clientWidth / 2 - wx * t.k, y: el.clientHeight / 2 - wy * t.k };
          applyTransform();
        };
        return (
          <div
            data-canvas-ui
            className="absolute bottom-[72px] left-4 z-40 cursor-crosshair overflow-hidden rounded-xl border border-ink-200/70 bg-white/95 shadow-lg backdrop-blur-md"
            style={{ width: MW, height: MH }}
            aria-label="小地图：点击或拖动跳转视口"
            onPointerDown={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              jumpTo(e.clientX, e.clientY, rect);
              const onMove = (ev: PointerEvent) => jumpTo(ev.clientX, ev.clientY, rect);
              const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            }}
          >
            <svg width={MW} height={MH}>
              {list.map(n => {
                const p = toMini(n.x, n.y);
                return <rect key={n.id} x={p.x} y={p.y} width={Math.max(2, n.w * scale)} height={Math.max(2, n.h * scale)}
                  fill={selectedIds.has(n.id) ? '#6E56CF' : '#d4d4d8'} rx={1} />;
              })}
              <rect x={vpM.x} y={vpM.y} width={Math.max(6, vp.w * scale)} height={Math.max(6, vp.h * scale)}
                fill="rgba(110,86,207,0.08)" stroke="#6E56CF" strokeWidth={1.5} rx={2} />
            </svg>
          </div>
        );
      })()}

      {/* 左下缩放（Lovart 式角落缩放） */}
      <div
        className="absolute bottom-4 left-4 z-40 flex items-center gap-0.5 rounded-2xl border border-ink-200/70 bg-white/95 p-1.5 shadow-lg backdrop-blur-md"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Tip label="缩小画板视图">
          <button
            onClick={() => { const el = containerRef.current!; zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1 / 1.25, true); }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100"
          >
            <Minus className="h-4 w-4" />
          </button>
        </Tip>
        <span className="w-12 text-center text-[11px] font-bold tabular-nums text-ink-700">{Math.round(view.k * 100)}%</span>
        <Tip label="放大画板视图">
          <button
            onClick={() => { const el = containerRef.current!; zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1.25, true); }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </Tip>
        <div className="mx-1 h-4 w-px bg-ink-200" />
        <Tip label="缩放至恰好容纳全部内容">
          <button
            onClick={() => { const box = nodesBBox(nodesRef.current); if (box) fitRect(box); }}
            className="flex h-8 items-center justify-center rounded-lg px-2 text-[11px] font-bold text-ink-500 transition-colors hover:bg-ink-100"
          >
            适配
          </button>
        </Tip>
      </div>
    </div>
  );
});
CanvasBoard.displayName = 'CanvasBoard';

export default CanvasBoard;
