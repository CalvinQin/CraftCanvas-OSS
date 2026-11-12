import { selectedTemplate } from './services/templates';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ProductImage, CanvasNodeData, GenRun, ChatMessage, GenerationMode, NodePin } from './types';
import { EngineId, ENGINES, generateWithEngine, GenerateOptions } from './services/engine';
import type { GptQuality } from './services/openaiService';
import { analyzeImageForComponents, hasGeminiKey, identifyElementAt, IdentifiedElement } from './services/geminiService';
import { hasOpenAIKey } from './services/openaiService';
import { friendlyErrorMessage } from './services/errors';
import {
  buildAnglePrompt, buildLayoutPrompt, buildNineGridPrompt, buildRefinePrompt,
  buildChatPrompt, buildAnnotationsPrompt, buildAnnotatedRefinePrompt, buildLayerPrompt, buildTouchEditPrompt,
  buildVariationPrompt, buildUpscalePrompt, buildOutpaintPrompt,
  ANGLE_LABELS, LAYOUT_LABELS, NINE_GRID_LABELS,
  ProductAngle, LayoutType, NineGridSlot,
} from './services/prompts';
import { cutoutToTransparentPng, exportLayeredPsd, assembleMultiLayerPsd, exportSvgVector, downloadBlob, downloadDataUrl, dataUrlToJpg, exportPdf, transformImageDataUrl, burnAnnotationsOntoImage } from './services/imageTools';
import { saveProject, loadProject, ProjectConflictError } from './services/persistence';
import CanvasBoard, { CanvasBoardHandle, RestorePayload } from './components/CanvasBoard';
import LayersPanel from './components/LayersPanel';
import CommandPalette, { Command } from './components/CommandPalette';
import ChatPanel from './components/ChatPanel';
import { Toaster, toast } from './components/Toast';
import { LogoMark, BrandWordmark } from './components/Logo';
import Tip from './components/Tip';
import { useDialogFocus } from './services/useDialogFocus';
import { X, Download, PanelRightClose, PanelRightOpen, UploadCloud, Keyboard, Layers as LayersIcon } from 'lucide-react';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '_');

// 画板批次排布参数（世界坐标）
const CELL = 320;
const GAP = 28;
const COLS = 3;
const BATCH_SPACING = 100;
const NODE_FOOTER = 44;
// 上传素材列（画板左侧独立列）
const ASSET_W = 210;
const ASSET_H = ASSET_W + NODE_FOOTER;
const ASSET_X = -(ASSET_W + 190);
const ASSETS_RUN_ID = 'run_assets';

const MODE_LABELS: Record<GenerationMode, string> = {
  chat: '自由创作',
  angle: '单品多角度',
  layout: '多组件重排',
  nine: '一键九图',
};

// 读取文件并压缩到最长边 1536px；PNG 源保持 PNG 编码（防透明区变黑）
async function fileToDataUrl(file: File): Promise<string> {
  const raw: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = raw;
    });
    const MAX = 1536;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    if (scale >= 1) return raw;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return file.type === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return raw;
  }
}

interface TaskSpec { label: string; prompt: string }

function buildTaskSpecs(mode: GenerationMode, itemsDesc: string, custom: string, specText: string, hasRefs: boolean): TaskSpec[] {
  if (mode === 'chat') {
    const short = custom.trim().length > 14 ? custom.trim().slice(0, 14) + '…' : custom.trim();
    return [{ label: short || '自由创作', prompt: buildChatPrompt(custom, hasRefs, itemsDesc) }];
  }
  if (mode === 'angle') {
    const angles: ProductAngle[] = ['FRONT', 'PERSPECTIVE_3D', 'SIDE', 'BACK', 'TOP', 'DETAIL'];
    return angles.map(a => ({ label: ANGLE_LABELS[a], prompt: buildAnglePrompt(a, itemsDesc, custom) }));
  }
  if (mode === 'layout') {
    const layouts: LayoutType[] = ['LAYOUT_1', 'LAYOUT_2', 'LAYOUT_3', 'LAYOUT_4', 'LAYOUT_5', 'LAYOUT_6'];
    return layouts.map(l => ({ label: LAYOUT_LABELS[l], prompt: buildLayoutPrompt(l, itemsDesc, custom) }));
  }
  const slots: NineGridSlot[] = [
    'DETAIL_1', 'DETAIL_2', 'DETAIL_3',
    'SCENE_1', 'SCENE_2', 'SCENE_3',
    'PARAM_1', 'PARAM_2', 'PARAM_3',
  ];
  return slots.map(s => ({ label: NINE_GRID_LABELS[s], prompt: buildNineGridPrompt(s, itemsDesc, custom, specText) }));
}

const App: React.FC = () => {
  const [refImages, setRefImages] = useState<ProductImage[]>([]);
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
  const [runs, setRuns] = useState<GenRun[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<GenerationMode>(() => selectedTemplate()?.mode || 'chat');
  // 引擎与质量持久化（刷新后保持用户选择；否则会静默回落到默认引擎，
  // 中国网络下 Gemini 直连被地域拒绝 → 用户以为选了 GPT 却报错）
  const [engine, setEngine] = useState<EngineId>(() => {
    const saved = localStorage.getItem('craftcanvas_engine');
    return saved && saved in ENGINES ? (saved as EngineId) : 'gemini-flash';
  });
  const [gptQuality, setGptQuality] = useState<GptQuality>(() => {
    const saved = localStorage.getItem('craftcanvas_gpt_quality');
    return saved === 'low' || saved === 'medium' || saved === 'high' ? saved : 'low';
  });
  useEffect(() => { localStorage.setItem('craftcanvas_engine', engine); }, [engine]);
  useEffect(() => { localStorage.setItem('craftcanvas_gpt_quality', gptQuality); }, [gptQuality]);
  const [specText, setSpecText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  // Frame 独立子对话作用域
  const [scope, setScope] = useState<{ runId: string; title: string } | null>(null);
  // 自动保存状态（顶栏提示）与快捷键弹窗
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [layoutMotionKey, setLayoutMotionKey] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [canvasBg, setCanvasBg] = useState<string | null>(null); // 画布背景色（null=默认灰）
  const [annBump, setAnnBump] = useState(0); // 标注层变化计数（标注存在 CanvasBoard 内，用它触发自动保存）
  const [restorePayload, setRestorePayload] = useState<RestorePayload | null>(null); // 恢复视图+标注（CanvasBoard 自身应用）
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState('');
  const importProjectInputRef = useRef<HTMLInputElement>(null);
  const previewDialogRef = useRef<HTMLDivElement>(null);
  const shortcutsDialogRef = useRef<HTMLDivElement>(null);
  const gateDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(Boolean(previewUrl), previewDialogRef);
  useDialogFocus(shortcutsOpen, shortcutsDialogRef);
  useDialogFocus(!projectLoaded, gateDialogRef);

  const canvasRef = useRef<CanvasBoardHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextYRef = useRef(0);
  const assetsYRef = useRef(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const refsRef = useRef(refImages);
  refsRef.current = refImages;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const gptQualityRef = useRef(gptQuality);
  gptQualityRef.current = gptQuality;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  // 撤销/重做历史栈（节点数组快照，结构共享，最多 50 步）
  const historyRef = useRef<{ past: CanvasNodeData[][]; future: CanvasNodeData[][] }>({ past: [], future: [] });
  // 内部剪贴板（画板节点复制粘贴）与系统图片粘贴的协调时间戳
  const clipboardRef = useRef<CanvasNodeData[]>([]);
  const lastFilePasteTsRef = useRef(0);
  const restoredRef = useRef(false);
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;
  const nudgeHistoryTsRef = useRef(0); // 方向键微调：600ms 内连续按只入一次历史

  // ---------- 通用更新工具 ----------
  const patchNode = useCallback((id: string, patch: Partial<CanvasNodeData>) => {
    setNodes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // ---------- 撤销 / 重做 ----------
  const pushHistory = useCallback(() => {
    const h = historyRef.current;
    h.past.push(nodesRef.current);
    if (h.past.length > 50) h.past.shift();
    h.future = [];
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) { toast.info('没有可撤销的操作'); return; }
    h.future.push(nodesRef.current);
    setNodes(prev);
    setSelectedIds(new Set());
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) { toast.info('没有可重做的操作'); return; }
    h.past.push(nodesRef.current);
    setNodes(next);
    setSelectedIds(new Set());
  }, []);

  // ---------- 复制 / 粘贴 / 原位复制（画板节点内部剪贴板） ----------
  const copySelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    if (sel.size === 0) return false;
    clipboardRef.current = nodesRef.current.filter(n => sel.has(n.id));
    toast.info(`已复制 ${sel.size} 个节点`, '⌘V 粘贴');
    return true;
  }, []);

  // ---------- 复制 / 粘贴样式（§7.2）----------
  const styleClipboardRef = useRef<{ opacity?: number; fontSize?: number; textColor?: string } | null>(null);

  const copyNodeStyle = useCallback((id: string) => {
    const n = nodesRef.current.find(x => x.id === id);
    if (!n) return;
    styleClipboardRef.current = { opacity: n.opacity, fontSize: n.fontSize, textColor: n.textColor };
    toast.info('已复制样式', '透明度' + (n.kind === 'text' ? ' · 字号 · 文字颜色' : '') + '，右键其他节点粘贴样式');
  }, []);

  const pasteNodeStyle = useCallback((ids: string[]) => {
    const style = styleClipboardRef.current;
    if (!style) { toast.info('还没有复制过样式', '先在某个节点右键「复制样式」'); return; }
    pushHistory();
    setNodes(prev => prev.map(n => {
      if (!ids.includes(n.id) || n.locked) return n;
      const patch: Partial<CanvasNodeData> = { opacity: style.opacity };
      if (n.kind === 'text') {
        if (style.fontSize) patch.fontSize = style.fontSize;
        if (style.textColor) patch.textColor = style.textColor;
      }
      return { ...n, ...patch };
    }));
    toast.success(`已粘贴样式到 ${ids.length} 个节点`, '⌘Z 可撤销');
  }, [pushHistory]);

  const cutSelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    if (sel.size === 0) return false;
    clipboardRef.current = nodesRef.current.filter(n => sel.has(n.id));
    pushHistory();
    deleteNodes([...sel]);
    toast.info(`已剪切 ${sel.size} 个节点`, '⌘V 粘贴 · ⌘Z 撤销');
    return true;
  }, [pushHistory]);

  const pasteClipboard = useCallback(() => {
    const items = clipboardRef.current;
    if (items.length === 0) return false;
    pushHistory();
    const copies = items.map((n, i) => ({
      ...n,
      id: 'node_' + uid(),
      x: n.x + 40 + i * 4,
      y: n.y + 40 + i * 4,
      label: `${n.label} 副本`,
      refId: undefined,
      pins: undefined,
      parentId: undefined,
    }));
    setNodes(prev => [...prev, ...copies]);
    setSelectedIds(new Set(copies.map(c => c.id)));
    return true;
  }, [pushHistory]);

  const duplicateSelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    if (sel.size === 0) return;
    pushHistory();
    const targets = nodesRef.current.filter(n => sel.has(n.id));
    const copies = targets.map(n => ({
      ...n, id: 'node_' + uid(), x: n.x + 32, y: n.y + 32,
      label: `${n.label} 副本`, refId: undefined, pins: undefined, parentId: undefined,
    }));
    setNodes(prev => [...prev, ...copies]);
    setSelectedIds(new Set(copies.map(c => c.id)));
  }, [pushHistory]);

  // ---------- 层级（渲染顺序 = 数组顺序） ----------
  const bringToFront = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    pushHistory();
    setNodes(prev => [...prev.filter(n => !idSet.has(n.id)), ...prev.filter(n => idSet.has(n.id))]);
  }, [pushHistory]);

  const sendToBack = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    pushHistory();
    setNodes(prev => [...prev.filter(n => idSet.has(n.id)), ...prev.filter(n => !idSet.has(n.id))]);
  }, [pushHistory]);

  // ---------- 多选对齐 / 分布（§7.3） ----------
  const alignNodes = useCallback((type: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const sel = selectedIdsRef.current;
    if (sel.size < 2) return;
    const targets = nodesRef.current.filter(n => sel.has(n.id) && !n.locked);
    if (targets.length < 2) return;
    const minX = Math.min(...targets.map(n => n.x));
    const maxR = Math.max(...targets.map(n => n.x + n.w));
    const minY = Math.min(...targets.map(n => n.y));
    const maxB = Math.max(...targets.map(n => n.y + n.h));
    const cx = (minX + maxR) / 2, cy = (minY + maxB) / 2;
    pushHistory();
    setNodes(prev => prev.map(n => {
      if (!sel.has(n.id) || n.locked) return n;
      switch (type) {
        case 'left': return { ...n, x: minX };
        case 'hcenter': return { ...n, x: cx - n.w / 2 };
        case 'right': return { ...n, x: maxR - n.w };
        case 'top': return { ...n, y: minY };
        case 'vcenter': return { ...n, y: cy - n.h / 2 };
        case 'bottom': return { ...n, y: maxB - n.h };
      }
    }));
    setLayoutMotionKey(key => key + 1);
  }, [pushHistory]);

  const distributeNodes = useCallback((axis: 'h' | 'v') => {
    const sel = selectedIdsRef.current;
    const targets = nodesRef.current.filter(n => sel.has(n.id) && !n.locked);
    if (targets.length < 3) { toast.info('至少选中 3 个节点才能均匀分布'); return; }
    pushHistory();
    const sorted = [...targets].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const sizeSum = sorted.reduce((s, n) => s + (axis === 'h' ? n.w : n.h), 0);
    const span = axis === 'h' ? (last.x + last.w - first.x) : (last.y + last.h - first.y);
    const gap = (span - sizeSum) / (sorted.length - 1);
    const pos = new Map<string, number>();
    let cursor = axis === 'h' ? first.x : first.y;
    for (const n of sorted) {
      pos.set(n.id, cursor);
      cursor += (axis === 'h' ? n.w : n.h) + gap;
    }
    setNodes(prev => prev.map(n => {
      const p = pos.get(n.id);
      if (p === undefined) return n;
      return axis === 'h' ? { ...n, x: p } : { ...n, y: p };
    }));
    setLayoutMotionKey(key => key + 1);
  }, [pushHistory]);

  // ---------- 图层重命名 / 替换图片 / 导出选区 ----------
  const renameNode = useCallback((id: string, label: string) => {
    if (!label.trim()) return;
    pushHistory();
    patchNode(id, { label: label.trim().slice(0, 40) });
  }, [pushHistory, patchNode]);

  const replaceTargetRef = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const requestReplaceImage = useCallback((nodeId: string) => {
    replaceTargetRef.current = nodeId;
    replaceInputRef.current?.click();
  }, []);

  const handleReplaceFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = replaceTargetRef.current;
    e.target.value = '';
    replaceTargetRef.current = null;
    if (!file || !nodeId || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      pushHistory();
      // 替换内容但保留位置/尺寸/历史派生关系；清掉旧图层分解（已失效）
      patchNode(nodeId, { url: dataUrl, layers: undefined, baseImage: undefined });
      toast.success('图片已替换', '位置与尺寸保持不变（⌘Z 可撤销）');
    } catch {
      toast.error('替换失败', '图片读取失败');
    }
  }, [pushHistory, patchNode]);

  // ---------- 缩放/精确位置（Resize 手柄与属性输入） ----------
  const setNodeFrame = useCallback((id: string, frame: { x?: number; y?: number; w?: number; h?: number; fontSize?: number; opacity?: number }) => {
    patchNode(id, frame);
  }, [patchNode]);

  // ---------- 组合 / 取消组合（⌘G / ⌘⇧G） ----------
  const groupSelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    if (sel.size < 2) { toast.info('选中 ≥2 个节点后 ⌘G 组合'); return; }
    pushHistory();
    const gid = 'grp_' + uid();
    setNodes(prev => prev.map(n => (sel.has(n.id) ? { ...n, groupId: gid } : n)));
    toast.success(`已组合 ${sel.size} 个节点`, '点击组内任意成员即选中整组 · ⌘⇧G 取消组合');
  }, [pushHistory]);

  const ungroupSelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    if (sel.size === 0) return;
    pushHistory();
    setNodes(prev => prev.map(n => (sel.has(n.id) ? { ...n, groupId: undefined } : n)));
    toast.info('已取消组合');
  }, [pushHistory]);

  // 图层面板：单层上移/下移（数组序 = 渲染层级）
  // 图层拖动排序：dragId 移到 targetId 当前的层级位置
  const reorderNode = useCallback((dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    pushHistory();
    setNodes(prev => {
      const di = prev.findIndex(n => n.id === dragId);
      const tiOrig = prev.findIndex(n => n.id === targetId);
      if (di < 0 || tiOrig < 0) return prev;
      const dragNode = prev[di];
      const without = prev.filter(n => n.id !== dragId);
      let ti = without.findIndex(n => n.id === targetId);
      // 面板顶层在上（数组末尾=最上层）：向上拖（di<tiOrig）落到目标上方，向下拖落到目标下方
      if (di < tiOrig) ti += 1;
      return [...without.slice(0, ti), dragNode, ...without.slice(ti)];
    });
  }, [pushHistory]);

  const moveLayer = useCallback((id: string, dir: 'up' | 'down') => {
    pushHistory();
    setNodes(prev => {
      const i = prev.findIndex(n => n.id === id);
      const j = dir === 'up' ? i + 1 : i - 1; // 数组末尾为最上层
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, [pushHistory]);

  const pushMessage = useCallback((msg: Omit<ChatMessage, 'ts'>) => {
    setMessages(prev => [...prev, { ...msg, ts: Date.now() }]);
  }, []);

  const findNode = useCallback((id: string) => nodesRef.current.find(n => n.id === id), []);

  // 图片加载后把节点高度贴合图片比例，消除"白底相框"（object-contain 的信箱留白）。
  // 仅对仍是默认方形占位（h ≈ CELL+FOOTER）的节点生效，不打扰手动 resize 过的节点。
  const fitNaturalRef = useRef(new Set<string>());
  const onImageNaturalSize = useCallback((nodeId: string, natW: number, natH: number) => {
    if (!natW || !natH || fitNaturalRef.current.has(nodeId)) return;
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node || node.kind === 'text') return;
    fitNaturalRef.current.add(nodeId);
    // 只在默认方形占位时贴合（避免覆盖用户手动调过的尺寸）
    if (Math.abs(node.h - (CELL + NODE_FOOTER)) > 1) return;
    const targetH = Math.round(node.w * (natH / natW)) + NODE_FOOTER;
    if (Math.abs(targetH - node.h) <= 2) return;
    setNodes(prev => prev.map(n => (n.id === nodeId ? { ...n, h: targetH } : n)));
  }, []);

  // ---------- 旋转 90° / 翻转（像素级烘焙，PNG 保透明） ----------
  const handleTransformNode = useCallback(async (nodeId: string, op: 'rot90' | 'flipH' | 'flipV') => {
    const node = findNode(nodeId);
    if (!node?.url || node.kind === 'text') return;
    try {
      const url = await transformImageDataUrl(node.url, op);
      pushHistory();
      // 旋转互换宽高；变换后旧的图层分解已失效，清除
      const frame = op === 'rot90' ? { w: node.h, h: node.w } : {};
      patchNode(nodeId, { url, ...frame, layers: undefined });
      toast.success(op === 'rot90' ? '已旋转 90°' : op === 'flipH' ? '已水平翻转' : '已垂直翻转', '⌘Z 可撤销');
    } catch {
      toast.error('变换失败', '图片处理出错，请重试');
    }
  }, [findNode, pushHistory, patchNode]);

  // ---------- 删除节点（素材节点联动移除参考图） ----------
  const deleteNodes = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const removedRefIds = nodesRef.current
      .filter(n => idSet.has(n.id) && n.refId)
      .map(n => n.refId!);
    setNodes(prev => prev.filter(n => !idSet.has(n.id)));
    if (removedRefIds.length > 0) {
      const refSet = new Set(removedRefIds);
      setRefImages(prev => prev.filter(r => !refSet.has(r.id)));
    }
    setSelectedIds(prev => new Set([...prev].filter(id => !idSet.has(id))));
  }, []);

  // ---------- 素材摄入（同时进参考图条 + 画板素材列） ----------
  const ensureAssetsRun = useCallback(() => {
    if (!runsRef.current.some(r => r.id === ASSETS_RUN_ID)) {
      setRuns(prev => [...prev, { id: ASSETS_RUN_ID, mode: 'assets', engine: 'gemini-flash', itemsDesc: '', title: '上传素材' }]);
    }
  }, []);

  /** at：世界坐标落点（拖拽=光标处、粘贴=视口中心）；缺省落到左侧素材列 */
  const processFiles = useCallback(async (files: FileList | File[], at?: { x: number; y: number }) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (list.length === 0) return;
    let ok = 0;
    for (const file of list) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const refId = 'ref_' + uid();
        setRefImages(prev => [...prev, { id: refId, originalBase64: dataUrl, fileName: file.name }]);
        ensureAssetsRun();
        let x: number;
        let y: number;
        if (at) {
          // 多文件按瀑布错位，避免完全重叠
          x = at.x - ASSET_W / 2 + ok * 32;
          y = at.y - ASSET_H / 2 + ok * 32;
        } else {
          x = ASSET_X;
          y = assetsYRef.current;
          assetsYRef.current += ASSET_H + 24;
        }
        setNodes(prev => [...prev, {
          id: 'node_' + uid(),
          runId: ASSETS_RUN_ID,
          label: file.name.replace(/\.[^.]+$/, '').slice(0, 18) || '素材',
          url: dataUrl,
          status: 'completed',
          x,
          y,
          w: ASSET_W,
          h: ASSET_H,
          engine: 'gemini-flash',
          prompt: '',
          refId,
        }]);
        ok++;
      } catch (e) {
        console.warn('图片读取失败', file.name, e);
        toast.error('图片读取失败', file.name);
      }
    }
    if (ok > 0) {
      toast.success(`已导入 ${ok} 张素材`, at ? '已放置到画板并加入参考图' : '已加入参考图并放置到画板素材列');
      // 上传后自动把画板视图飞到新素材（落点区域或素材列），不再需要用户手动找
      const focus = at
        ? { x: at.x - 260, y: at.y - 260, w: 520, h: 520 }
        : { x: ASSET_X - 30, y: -30, w: ASSET_W + 60, h: Math.max(ASSET_H, assetsYRef.current) + 60 };
      requestAnimationFrame(() => canvasRef.current?.flyToRect(focus));
    }
  }, [ensureAssetsRun]);

  const removeRef = useCallback((refId: string) => {
    setRefImages(prev => prev.filter(r => r.id !== refId));
    setNodes(prev => prev.filter(n => n.refId !== refId));
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  useEffect(() => {
    const inTextField = (target: EventTarget | null) =>
      Boolean((target as HTMLElement)?.closest?.('input, textarea, [contenteditable]'));

    const handlePaste = (e: ClipboardEvent) => {
      if (inTextField(e.target)) return; // 输入框内粘贴不吞图
      if (e.clipboardData?.files?.length) {
        lastFilePasteTsRef.current = Date.now(); // 通知 ⌘V 内部粘贴让位
        // 粘贴 → 放到当前视口中心
        processFiles(e.clipboardData.files, canvasRef.current?.getCenterWorld());
      }
    };
    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.relatedTarget) setIsDragging(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer?.files?.length) {
        // 拖到画板 → 落在光标处；拖到对话栏等区域 → 落到素材列
        const wp = canvasRef.current?.screenToWorld(e.clientX, e.clientY);
        processFiles(e.dataTransfer.files, wp ?? undefined);
      }
    };

    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [processFiles]);

  // ---------- 启动恢复（IndexedDB）----------
  useEffect(() => {
    if (restoredRef.current) return; // StrictMode 双执行守卫
    restoredRef.current = true;
    (async () => {
      const snap = await loadProject();
      if (!ENGINES[engineRef.current].available()) {
        const available = (Object.keys(ENGINES) as EngineId[]).find(id => ENGINES[id].available());
        if (available) setEngine(available);
      }
      if (!snap) return;
      // 刷新时进行中的任务已中断，标记为可重试的失败态（不伪装仍在进行）
      setNodes(snap.nodes.map(n => n.status === 'processing'
        ? { ...n, status: 'error' as const, errorMsg: '页面刷新导致任务中断，可点击重试' }
        : n));
      setRuns(snap.runs);
      setMessages(snap.messages.map(m => ({ ...m, pending: false })));
      setRefImages(snap.refImages);
      nextYRef.current = snap.nextY;
      assetsYRef.current = snap.assetsY;
      if (snap.layersOpen) setLayersOpen(true); // 恢复打开的面板（§37.2）
      if (snap.canvasBg) setCanvasBg(snap.canvasBg); // 恢复画布背景色
      // 视图与标注恢复经 prop 交给 CanvasBoard 自身在 mount 后应用——避免 StrictMode
      // 双挂载下 canvasRef 指向被丢弃实例导致的静默失败（比命令式 ref 更稳）。
      setRestorePayload({ view: snap.view ?? null, annotations: snap.annotations ?? [], fitIfNoView: !snap.view });
      // 恢复选中状态（启动时捕获的 localStorage 值——持久化 effect 会先以空选中覆写存储；只保留仍存在的节点）
      const savedSel = initialSelectionRef.current ?? [];
      if (savedSel.length) {
        const exist = new Set(snap.nodes.map(n => n.id));
        setSelectedIds(new Set(savedSel.filter(id => exist.has(id))));
      }
      toast.success('已恢复上次会话', `${snap.nodes.length} 个节点 · ${new Date(snap.savedAt).toLocaleTimeString('zh-CN')} 保存`);
    })().then(() => setProjectLoaded(true)).catch(e => {
      setProjectLoadError(e instanceof Error ? e.message : '读取云端画板失败，请稍后重试');
      setSaveState(e instanceof Error && e.message.includes('登录') ? 'idle' : 'error');
    });
  }, []);

  // ---------- 自动保存（防抖 800ms，含生成中变化；顶栏显示保存状态）----------
  useEffect(() => {
    if (!projectLoaded) return;
    let current = true;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveProject({
        nodes: nodesRef.current,
        runs: runsRef.current,
        messages,
        refImages: refsRef.current,
        nextY: nextYRef.current,
        assetsY: assetsYRef.current,
        savedAt: Date.now(),
        view: canvasRef.current?.getViewTransform(),
        layersOpen,
        canvasBg: canvasBg ?? undefined,
        annotations: canvasRef.current?.getAnnotations(),
      })
        .then(() => { if (current) { setSaveState('saved'); setSaveError(''); setSaveConflict(false); } })
        .catch(e => { if (current) { setSaveState('error'); setSaveConflict(e instanceof ProjectConflictError); setSaveError(e instanceof Error ? e.message : '保存失败，请检查网络后重试'); } });
    }, 800);
    return () => { current = false; clearTimeout(t); };
  }, [projectLoaded, nodes, runs, messages, refImages, layersOpen, canvasBg, annBump, saveAttempt]);

  useEffect(() => {
    const retry = () => { if (saveState === 'error' && !saveConflict) setSaveAttempt(value => value + 1); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [saveState, saveConflict]);

  // ---------- 选中状态持久化（§37.2 可选项；localStorage 轻量，不动 IndexedDB 大快照）----------
  const initialSelectionRef = useRef<string[] | null>(null);
  if (initialSelectionRef.current === null) {
    try { initialSelectionRef.current = JSON.parse(localStorage.getItem('craftcanvas_selection') ?? '[]'); }
    catch { initialSelectionRef.current = []; }
  }
  useEffect(() => {
    if (!restoredRef.current) return;
    try { localStorage.setItem('craftcanvas_selection', JSON.stringify([...selectedIds])); } catch { /* 忽略 */ }
  }, [selectedIds]);

  // ---------- 未保存完成时关闭页面提示（§37.1）----------
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStateRef.current === 'saving' || saveStateRef.current === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ---------- 快捷键（模态打开时 Delete 不删节点；Esc 逐层关闭） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!projectLoaded) return;
      const typing = Boolean((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable], button, a, [role="dialog"], [role="menu"]'));
      // ⌘K 命令面板：任何场景可开（含输入框聚焦时）
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }
      if (e.key === 'Escape') {
        if (shortcutsOpenRef.current) { setShortcutsOpen(false); return; }
        if (previewUrlRef.current) { setPreviewUrl(null); return; }
        if (!typing) setSelectedIds(new Set());
        return;
      }
      if (typing || previewUrlRef.current || shortcutsOpenRef.current) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selectedIdsRef.current;
        if (sel.size > 0) {
          pushHistory();
          deleteNodes([...sel]);
          toast.info(`已删除 ${sel.size} 个节点`, '⌘Z 可撤销');
        }
        return;
      }
      // 方向键微调选中节点（1px，Shift=10px；连续微调 600ms 合并为一次历史）
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const sel = selectedIdsRef.current;
        if (sel.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const now = Date.now();
        if (now - nudgeHistoryTsRef.current > 600) pushHistory();
        nudgeHistoryTsRef.current = now;
        setNodes(prev => prev.map(n => (sel.has(n.id) && !n.locked ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (k === 'c') { if (copySelection()) e.preventDefault(); return; }
      if (k === 'x') { if (cutSelection()) e.preventDefault(); return; }
      if (k === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (k === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(nodesRef.current.map(n => n.id)));
        return;
      }
      if (k === 'g') {
        e.preventDefault();
        e.shiftKey ? ungroupSelection() : groupSelection();
        return;
      }
      if (k === 'v') {
        // 与系统图片粘贴协调：稍等 80ms，若 paste 事件刚处理了图片文件则不贴内部节点
        setTimeout(() => {
          if (Date.now() - lastFilePasteTsRef.current < 300) return;
          pasteClipboard();
        }, 80);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectLoaded, deleteNodes, pushHistory, undo, redo, copySelection, cutSelection, duplicateSelection, pasteClipboard, groupSelection, ungroupSelection]);

  const libraryImported = useRef(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('asset');
    if (!projectLoaded || !id || libraryImported.current) return;
    libraryImported.current = true;
    (async () => {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('素材不存在或暂时无法读取');
      const asset = await response.json();
      const image = await fetch(`/api/assets/${asset.hash}`);
      if (!image.ok) throw new Error('图片读取失败');
      const blob = await image.blob();
      await processFiles([new File([blob], asset.name, { type: blob.type })]);
      const url = new URL(window.location.href); url.searchParams.delete('asset');
      window.history.replaceState(null, '', url.pathname + url.search);
    })().catch(e => toast.error('素材导入失败', e.message));
  }, [projectLoaded, processFiles]);

  // ---------- 派生节点（变体/放大/扩图/重绘/批注）通用流程 ----------
  interface DerivedSpec {
    fromNode: CanvasNodeData;
    label: string;
    prompt: string;
    baseImage?: string;
    opts?: GenerateOptions;
    engine?: EngineId;
    w?: number;
    h?: number;
    xOverride?: number; // 批量派生时由调用方预先计算，避免并发落点冲突
  }

  // 碰撞检测：期望位置若与任何现有节点重叠，则向下步进、整列占满再换右一列，直到找到空位
  const findFreeSpot = useCallback((desiredX: number, desiredY: number, w: number, h: number): { x: number; y: number } => {
    const pad = GAP;
    const list = nodesRef.current;
    const hit = (x: number, y: number) => list.some(n =>
      x < n.x + n.w + pad && x + w + pad > n.x && y < n.y + n.h + pad && y + h + pad > n.y);
    let x = desiredX, y = desiredY, tries = 0;
    while (hit(x, y) && tries < 400) {
      y += h + GAP; tries++;
      if (tries % 10 === 0) { x += w + GAP; y = desiredY; }
    }
    return { x, y };
  }, []);

  const createDerivedNode = useCallback((spec: DerivedSpec): CanvasNodeData => {
    const w = spec.w ?? spec.fromNode.w;
    const h = spec.h ?? spec.fromNode.h;
    // 紧贴源图右侧（关联感），再碰撞检测避免与任何节点重叠
    const desiredX = spec.xOverride ?? (spec.fromNode.x + spec.fromNode.w + GAP);
    const desiredY = spec.fromNode.y;
    const { x, y } = findFreeSpot(desiredX, desiredY, w, h);
    const node: CanvasNodeData = {
      id: 'node_' + uid(),
      runId: spec.fromNode.runId,
      parentId: spec.fromNode.id, // 记录衍生来源，画关联连接线
      label: spec.label,
      url: null,
      status: 'processing',
      x, y, w, h,
      // 「选啥模型就用啥模型」：派生操作一律用当前选中引擎（除非显式指定，如放大升 Pro）
      engine: spec.engine ?? engineRef.current,
      prompt: spec.prompt,
      baseImage: spec.baseImage,
    };
    // 批量并发派生时手动占位（nodesRef 直到下次 render 才含新节点），让同批后续分配避开本节点
    nodesRef.current = [...nodesRef.current, node];
    return node;
  }, [findFreeSpot]);

  const runDerived = useCallback(async (spec: DerivedSpec, opName: string): Promise<CanvasNodeData | null> => {
    const useEngine = spec.engine ?? engineRef.current;
    if (!ENGINES[useEngine].available()) {
      toast.error(`${opName}失败`, `此创作引擎暂未开放：${ENGINES[useEngine].setupHint}`);
      return null;
    }
    // AI 生成插入可撤销（§7.6）：必须先快照——createDerivedNode 会把新节点手动写进 nodesRef 占位
    pushHistory();
    const node = createDerivedNode(spec);
    setNodes(prev => [...prev, node]);
    setSelectedIds(new Set([node.id]));
    requestAnimationFrame(() => canvasRef.current?.flyToNode(node.id));
    try {
      const refs = refsRef.current.map(r => r.originalBase64);
      const url = await generateWithEngine(node.engine, refs, node.prompt, node.baseImage, { ...spec.opts, quality: gptQualityRef.current });
      patchNode(node.id, { status: 'completed', url });
      toast.success(`${opName}完成`, node.label);
      return { ...node, status: 'completed', url };
    } catch (e) {
      const msg = friendlyErrorMessage(e);
      patchNode(node.id, { status: 'error', errorMsg: msg });
      toast.error(`${opName}失败`, msg);
      return null;
    }
  }, [createDerivedNode, patchNode, pushHistory]);

  // ---------- Frame 独立子对话：作用域内生成 ----------
  const startScopedChat = useCallback(async (text: string) => {
    if (!scope) return;
    const run = runsRef.current.find(r => r.id === scope.runId);
    const runNodes = nodesRef.current.filter(n => n.runId === scope.runId);
    if (!run || runNodes.length === 0) {
      toast.info('该框架已不存在', '已退出框架对话');
      setScope(null);
      return;
    }
    if (!text.trim()) { toast.error('请输入想要的画面描述'); return; }
    if (isGenerating) { toast.info('正在生成中', '请等待当前任务完成'); return; }
    if (!ENGINES[engine].available()) {
      toast.error('此创作引擎暂未开放', ENGINES[engine].setupHint);
      return;
    }

    setIsGenerating(true);
    const refs = refsRef.current.map(r => r.originalBase64);
    pushMessage({ id: 'msg_' + uid(), role: 'user', text: text.trim(), runId: scope.runId });
    const msgId = 'msg_' + uid();
    pushMessage({ id: msgId, role: 'assistant', text: '正在框架内生成…', pending: true, runId: scope.runId });

    const short = text.trim().length > 14 ? text.trim().slice(0, 14) + '…' : text.trim();
    const result = await runDerived({
      fromNode: runNodes[runNodes.length - 1],
      label: short,
      prompt: buildChatPrompt(text, refs.length > 0, run.itemsDesc),
      engine,
      w: CELL,
      h: CELL + NODE_FOOTER,
    }, '框架生成');

    patchMessage(msgId, {
      pending: false,
      text: result ? '已生成并放入本框架。' : '生成失败，可在画板上重试。',
      thumbs: result ? [{ nodeId: result.id, url: result.url! }] : undefined,
      engine,
    });
    setIsGenerating(false);
  }, [scope, isGenerating, engine, pushMessage, patchMessage]);

  // ---------- 生成主流程 ----------
  const startGeneration = useCallback(async (customText: string) => {
    if (scope) { startScopedChat(customText); return; }
    const refs = refsRef.current.map(r => r.originalBase64);
    if (mode !== 'chat' && refs.length === 0) { toast.error('请先上传产品实拍图'); return; }
    if (mode === 'chat' && !customText.trim()) { toast.error('请输入想要的画面描述'); return; }
    if (isGenerating) { toast.info('正在生成中', '请等待当前批次完成'); return; }
    if (!ENGINES[engine].available()) {
      toast.error('此创作引擎暂未开放', ENGINES[engine].setupHint);
      return;
    }

    setIsGenerating(true);
    const runId = 'run_' + uid();
    const modeLabel = MODE_LABELS[mode];
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const title = `${modeLabel} · ${ENGINES[engine].label} · ${time}`;

    pushMessage({
      id: 'msg_' + uid(),
      role: 'user',
      text: mode === 'chat'
        ? customText.trim()
        : `发起「${modeLabel}」${customText ? `：${customText}` : ''}${mode === 'nine' && specText.trim() ? `\n参数：${specText.trim()}` : ''}`,
      refImages: refs.length > 0 ? refs : undefined,
      runId,
    });

    // GPT Image 端点本身多模态"看得见"参考图，无需 Gemini 预清点（Lovart 式直接图生图）——
    // 跳过清点即省一次 Gemini 调用，且 prompt 不注入清单文本（九图 ×9 省大量 token）。
    const usesGeminiCounting = (engine === 'gemini-flash' || engine === 'gemini-pro') && refs.length > 0;

    // Lovart 式 Think→Plan→Execute：先展示计划，再逐步更新
    const planHead = usesGeminiCounting
      ? `计划：① 清点素材 → ② 构建任务 → ③ 并行渲染 → ④ 汇总入板`
      : refs.length > 0
        ? `计划：① 构建任务 → ② 并行渲染 → ③ 汇总入板（GPT 直接读参考图，免清点省 token）`
        : `计划：① 构建任务 → ② 渲染 → ③ 汇总入板`;
    const progressMsgId = 'msg_' + uid();
    pushMessage({
      id: progressMsgId,
      role: 'assistant',
      text: `${planHead}\n${usesGeminiCounting ? '正在清点素材（识别主产品与全部配件）…' : '正在构建任务…'}`,
      pending: true,
      runId,
    });

    let itemsDesc = '';
    if (usesGeminiCounting) {
      try {
        itemsDesc = await analyzeImageForComponents(refs);
      } catch { /* 降级为空清单 */ }
    }

    const specs = buildTaskSpecs(mode, itemsDesc, customText, specText, refs.length > 0);
    const total = specs.length;

    // 排布占位节点
    // 新组落在现有内容（含派生图/拖动过的节点）最下方，避免与它们重叠
    // 按 refId 排除素材本身（素材衍生图继承 assets runId，须计入内容底部）
    const genNodes = nodesRef.current.filter(n => !n.refId);
    const contentBottom = genNodes.length ? Math.max(...genNodes.map(n => n.y + n.h)) + BATCH_SPACING : 0;
    const batchTop = Math.max(nextYRef.current, contentBottom);
    const rows = Math.ceil(total / COLS);
    const newNodes: CanvasNodeData[] = specs.map((spec, i) => ({
      id: 'node_' + uid(),
      runId,
      label: spec.label,
      url: null,
      status: 'processing',
      x: (i % COLS) * (CELL + GAP),
      y: batchTop + Math.floor(i / COLS) * (CELL + GAP + NODE_FOOTER),
      w: CELL,
      h: CELL + NODE_FOOTER,
      engine,
      prompt: spec.prompt,
    }));
    nextYRef.current = batchTop + rows * (CELL + GAP + NODE_FOOTER) + BATCH_SPACING;

    setRuns(prev => [...prev, { id: runId, mode, engine, itemsDesc, title }]);
    pushHistory(); // AI 生成插入可撤销（§7.6）
    setNodes(prev => [...prev, ...newNodes]);
    setSelectedIds(new Set());
    requestAnimationFrame(() => {
      canvasRef.current?.flyToRect({
        x: 0, y: batchTop - 60,
        w: COLS * (CELL + GAP) - GAP,
        h: rows * (CELL + GAP + NODE_FOOTER) + 60,
      });
    });

    let done = 0;
    patchMessage(progressMsgId, {
      text: `${planHead}\n${itemsDesc ? '✓ 素材清单已解析\n' : ''}✓ 已构建 ${total} 项任务\n渲染中 · 0/${total}`,
    });

    // 本地收集结果，避免在 setState 更新器里做副作用
    const outcomes = await Promise.all(newNodes.map(async node => {
      try {
        const url = await generateWithEngine(engine, refs, node.prompt, undefined, { quality: gptQualityRef.current });
        patchNode(node.id, { status: 'completed', url });
        return { node, url, ok: true as const };
      } catch (e) {
        const msg = friendlyErrorMessage(e);
        patchNode(node.id, { status: 'error', errorMsg: msg });
        return { node, errorMsg: msg, ok: false as const };
      } finally {
        done++;
        patchMessage(progressMsgId, { text: `${planHead}\n${itemsDesc ? '✓ 素材清单已解析\n' : ''}✓ 已构建 ${total} 项任务\n渲染中 · ${done}/${total}` });
      }
    }));

    const okOnes = outcomes.filter(o => o.ok) as { node: CanvasNodeData; url: string; ok: true }[];
    const failedOnes = outcomes.filter(o => !o.ok) as { node: CanvasNodeData; errorMsg: string; ok: false }[];
    const failText = failedOnes.length
      ? `\n失败 ${failedOnes.length} 张：${failedOnes.map(o => o.node.label).join('、')}。原因：${failedOnes[0].errorMsg}\n可在画板上点击对应卡片单独重试。`
      : '';
    patchMessage(progressMsgId, {
      pending: false,
      text: `「${modeLabel}」完成 ${okOnes.length}/${total} 张，已放置到画板。${failText}`,
      thumbs: okOnes.map(o => ({ nodeId: o.node.id, url: o.url })),
      engine,
    });
    if (failedOnes.length === 0) {
      toast.success(`「${modeLabel}」全部完成`, `${okOnes.length} 张图已放置到画板`);
    } else if (okOnes.length > 0) {
      toast.info(`「${modeLabel}」部分完成`, `成功 ${okOnes.length} 张，失败 ${failedOnes.length} 张，可单独重试`);
    } else {
      toast.error(`「${modeLabel}」全部失败`, failedOnes[0]?.errorMsg);
    }

    setIsGenerating(false);
  }, [engine, mode, specText, isGenerating, scope, startScopedChat, patchNode, patchMessage, pushMessage]);

  // ---------- 追问重绘（支持多选批量） ----------
  const refineTargets = useMemo(() => {
    return nodes.filter(n => selectedIds.has(n.id) && n.status === 'completed' && n.url);
  }, [selectedIds, nodes]);

  // 重绘目标上重叠的画布标注数（供对话栏显示"含 N 处标注"开关）；annBump 变化时重算
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const refineAnnCount = useMemo(() => {
    void annBump; // 依赖：标注变化时重算
    return refineTargets.reduce((sum, t) => sum + (canvasRef.current?.getNodeAnnotations(t.id).length ?? 0), 0);
  }, [refineTargets, annBump]);

  // 选中重绘目标时自动展开对话栏，避免焦点落在不可见输入框
  useEffect(() => {
    if (refineTargets.length > 0) setChatOpen(true);
  }, [refineTargets.length]);

  const startRefine = useCallback(async (instruction: string) => {
    const targets = refineTargets;
    if (targets.length === 0 || isGenerating) return;

    setIsGenerating(true);
    const useAnn = includeAnnotations; // 锁定本次是否烧入标注
    pushMessage({
      id: 'msg_' + uid(),
      role: 'user',
      text: `重绘 ${targets.length > 1 ? `${targets.length} 张图` : `「${targets[0].label}」`}：${instruction}`,
      runId: targets[0].runId,
    });
    const msgId = 'msg_' + uid();
    pushMessage({ id: msgId, role: 'assistant', text: `正在按指令重绘 ${targets.length} 张图…`, pending: true, runId: targets[0].runId });

    // 每张新图各自紧贴其源图右侧，createDerivedNode 内的碰撞检测+占位会自动避免重叠
    const results = await Promise.all(targets.map(async (target) => {
      const run = runsRef.current.find(r => r.id === target.runId);
      const version = nodesRef.current.filter(n => n.label.startsWith(`${target.label} · 改`)).length + 1;
      // 若目标图上有画布标注且开关开启：烧进源图 + 用 Set-of-Mark 提示词，让 AI 看见"改哪里"
      const anns = useAnn ? (canvasRef.current?.getNodeAnnotations(target.id) ?? []) : [];
      const baseImage = anns.length ? await burnAnnotationsOntoImage(target.url!, anns) : target.url!;
      return runDerived({
        fromNode: target,
        label: `${target.label} · 改${version > 1 ? version : ''}`,
        prompt: anns.length ? buildAnnotatedRefinePrompt(instruction, run?.itemsDesc) : buildRefinePrompt(instruction, run?.itemsDesc),
        baseImage,
      }, '重绘');
    }));

    const ok = results.filter(Boolean) as CanvasNodeData[];
    patchMessage(msgId, {
      pending: false,
      text: ok.length === targets.length
        ? `重绘完成，${ok.length > 1 ? `${ok.length} 张新版本` : '新版本'}已放在原图右侧。`
        : `重绘完成 ${ok.length}/${targets.length} 张（失败的可在画板上重试）。`,
      thumbs: ok.map(n => ({ nodeId: n.id, url: n.url! })),
      // 徽章须标"实际用于本次生成的引擎"（= 当前选中），而非源图当初的引擎
      engine: ok[0]?.engine ?? engineRef.current,
    });
    setIsGenerating(false);
  }, [refineTargets, isGenerating, includeAnnotations, runDerived, patchMessage, pushMessage]);

  // ---------- 批注（图钉队列）执行 ----------
  const handleUpdatePins = useCallback((nodeId: string, pins: NodePin[]) => {
    patchNode(nodeId, { pins });
  }, [patchNode]);

  const handleRunPins = useCallback(async (nodeId: string, pins: NodePin[]) => {
    const target = findNode(nodeId);
    if (!target?.url || pins.length === 0) return;
    const run = runsRef.current.find(r => r.id === target.runId);

    pushMessage({
      id: 'msg_' + uid(),
      role: 'user',
      text: `执行「${target.label}」的 ${pins.length} 条批注：\n${pins.map((p, i) => `${i + 1}. (${Math.round(p.xPct)}%, ${Math.round(p.yPct)}%) ${p.text}`).join('\n')}`,
      runId: target.runId,
    });
    const msgId = 'msg_' + uid();
    pushMessage({ id: msgId, role: 'assistant', text: `正在按 ${pins.length} 条批注修改…`, pending: true, runId: target.runId });

    const result = await runDerived({
      fromNode: target,
      label: `${target.label} · 批注${pins.length > 1 ? `×${pins.length}` : ''}`,
      prompt: buildAnnotationsPrompt(pins, run?.itemsDesc),
      baseImage: target.url,
    }, '批注修改');

    if (result) {
      // 已执行的批注从原图队列中清除
      const executed = new Set(pins.map(p => p.id));
      patchNode(nodeId, { pins: (findNode(nodeId)?.pins ?? []).filter(p => !executed.has(p.id)) });
    }
    patchMessage(msgId, {
      pending: false,
      text: result ? '批注已全部应用，新版本放在原图右侧。' : '批注修改失败，可重试。',
      thumbs: result ? [{ nodeId: result.id, url: result.url! }] : undefined,
      engine: result?.engine ?? engineRef.current,
    });
  }, [findNode, runDerived, patchNode, patchMessage, pushMessage]);

  // ---------- Touch Edit 触点编辑 ----------
  const handleIdentifyElement = useCallback(async (
    nodeId: string, xPct: number, yPct: number, focus: 'element' | 'text',
  ): Promise<IdentifiedElement | null> => {
    const node = findNode(nodeId);
    if (!node?.url) return null;
    if (!hasGeminiKey()) {
      toast.info('智能识别暂未开放', '可直接在弹层里用自由指令描述要改的内容');
      return null;
    }
    return identifyElementAt(node.url, xPct, yPct, focus);
  }, [findNode]);

  const handleTouchEdit = useCallback(async (
    nodeId: string, xPct: number, yPct: number, element: string, instruction: string,
  ) => {
    const target = findNode(nodeId);
    if (!target?.url) return;

    pushMessage({
      id: 'msg_' + uid(),
      role: 'user',
      text: `Touch Edit「${target.label}」· ${element}：${instruction}`,
      runId: target.runId,
    });
    const msgId = 'msg_' + uid();
    pushMessage({ id: msgId, role: 'assistant', text: '正在对该元素做定点直改…', pending: true, runId: target.runId });

    const result = await runDerived({
      fromNode: target,
      label: `${target.label} · 触改`,
      prompt: buildTouchEditPrompt(element, instruction, xPct, yPct),
      baseImage: target.url,
    }, 'Touch Edit');

    patchMessage(msgId, {
      pending: false,
      text: result ? '元素已修改，新版本放在原图右侧。' : 'Touch Edit 失败，可重试。',
      thumbs: result ? [{ nodeId: result.id, url: result.url! }] : undefined,
      engine: result?.engine ?? engineRef.current,
    });
  }, [findNode, runDerived, patchMessage, pushMessage]);

  // ---------- SVG 矢量导出 ----------
  const handleExportSvg = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    toast.info('正在矢量描摹…', '颜色量化 + 路径追踪，平面图效果最佳');
    try {
      const blob = await exportSvgVector(node.url);
      downloadBlob(blob, `CraftCanvas_${sanitize(node.label)}.svg`);
      toast.success('SVG 已导出', '真实矢量路径，AI/Figma 可直接编辑；照片类会呈海报化效果');
    } catch (e) {
      toast.error('SVG 导出失败', friendlyErrorMessage(e));
    }
  }, [findNode]);

  // ---------- Frame 子对话入口 ----------
  const handleOpenRunChat = useCallback((runId: string) => {
    const run = runsRef.current.find(r => r.id === runId);
    if (!run) return;
    setScope({ runId, title: run.title });
    setChatOpen(true);
    toast.info('已进入框架对话', `${run.title} — 生成结果将落入该框架`);
  }, []);

  // ---------- 底部工具坞：整理排列 / 图生图 / 文生图 / 图生视频 ----------
  const handleArrange = useCallback(() => {
    // 可整理对象 = 非上传素材本身（refId）、未锁定、未隐藏——不能按 runId 排除素材 run，
    // 否则素材衍生成图（继承素材 runId）会被误排除（与 canvasImages 同类 bug）
    const items = nodesRef.current.filter(n => !n.refId && !n.locked && !n.hidden);
    if (items.length === 0) { toast.info('画板暂无可整理的图'); return; }
    pushHistory();
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const cellW = CELL + GAP;
    const cellH = CELL + NODE_FOOTER + GAP + 20;
    const idOrder = items.map(n => n.id);
    setNodes(prev => prev.map(n => {
      const idx = idOrder.indexOf(n.id);
      if (idx < 0) return n;
      return { ...n, x: (idx % cols) * cellW, y: Math.floor(idx / cols) * cellH };
    }));
    nextYRef.current = Math.ceil(items.length / cols) * cellH + BATCH_SPACING;
    setLayoutMotionKey(key => key + 1);
    toast.success('已整理排列', `${items.length} 张图对齐为网格（⌘Z 可撤销）`);
    requestAnimationFrame(() => canvasRef.current?.fitAll());
  }, [pushHistory]);

  // ---------- 文本一等元素（§9.1）：可选中/拖动/双击编辑的画板节点 ----------
  const createTextNode = useCallback((at: { x: number; y: number }) => {
    pushHistory();
    const node: CanvasNodeData = {
      id: 'node_' + uid(),
      runId: ASSETS_RUN_ID,
      kind: 'text',
      label: '文本',
      text: '双击编辑文字',
      fontSize: 32,
      textColor: '#18181b',
      url: null,
      status: 'completed',
      x: at.x - 140, y: at.y - 40, w: 280, h: 80,
      engine: 'gemini-flash',
      prompt: '',
    };
    ensureAssetsRun();
    setNodes(prev => [...prev, node]);
    setSelectedIds(new Set([node.id]));
    toast.success('已添加文本', '双击进入编辑，拖动移动位置');
  }, [pushHistory, ensureAssetsRun]);

  const updateNodeText = useCallback((nodeId: string, text: string) => {
    pushHistory();
    patchNode(nodeId, { text, label: text.slice(0, 12) || '文本' });
  }, [pushHistory, patchNode]);

  const handleTextToImage = useCallback(() => {
    setScope(null);
    setMode('chat');
    setChatOpen(true);
    toast.info('文生图', '在右侧对话框直接描述想要的画面即可生成');
  }, []);

  const handleImageToImage = useCallback(() => {
    setScope(null);
    setChatOpen(true);
    if (refsRef.current.length === 0) {
      fileInputRef.current?.click();
      toast.info('图生图', '先上传参考图，再在右侧描述要生成/修改的画面');
    } else {
      toast.info('图生图', '已有参考图，在右侧描述要生成的画面（或选中画板图追问重绘）');
    }
  }, []);

  const handleImageToVideo = useCallback(() => {
    toast.info('图生视频暂未启用', '该能力需接入视频生成模型，接入后即可在此开启');
  }, []);

  // ---------- 画板节点操作 ----------
  const handleVariation = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    runDerived({
      fromNode: node,
      label: `${node.label} · 变体`,
      prompt: node.prompt
        ? buildVariationPrompt(node.prompt)
        : buildChatPrompt('Create a professional alternative version of this image.', true),
      baseImage: node.prompt ? undefined : node.url,
    }, '生成变体');
  }, [findNode, runDerived]);

  const handleUpscale = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    runDerived({
      fromNode: node,
      label: `${node.label} · 4K`,
      prompt: buildUpscalePrompt(),
      baseImage: node.url,
      opts: { upscale: true },
      // Gemini 系列统一用 Pro 做 4K 重渲；GPT 节点保持原引擎
      engine: engineRef.current === 'gemini-flash' ? 'gemini-pro' : engineRef.current,
    }, '高清放大');
  }, [findNode, runDerived]);

  const handleOutpaint = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    runDerived({
      fromNode: node,
      label: `${node.label} · 横幅`,
      prompt: buildOutpaintPrompt(),
      baseImage: node.url,
      opts: { wide: true },
      w: Math.round(CELL * 16 / 9),
      h: CELL + NODE_FOOTER,
    }, '扩图');
  }, [findNode, runDerived]);

  const handleCutout = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    toast.info('正在抠图…', '白底泛洪抠图，产品内部白色高光会保留');
    try {
      const png = await cutoutToTransparentPng(node.url);
      if (!png) {
        toast.error('无法自动抠图', '该图不是纯白底（场景图请用批注/重绘调整背景）');
        return;
      }
      pushHistory(); // 先快照再 createDerivedNode（其内部会改 nodesRef 占位）
      const newNode = createDerivedNode({ fromNode: node, label: `${node.label} · 抠图`, prompt: node.prompt });
      setNodes(prev => [...prev, { ...newNode, status: 'completed', url: png }]);
      setSelectedIds(new Set([newNode.id]));
      requestAnimationFrame(() => canvasRef.current?.flyToNode(newNode.id));
      toast.success('抠图完成', '已生成透明底 PNG 节点，可直接下载');
    } catch (e) {
      toast.error('抠图失败', friendlyErrorMessage(e));
    }
  }, [findNode, createDerivedNode, pushHistory]);

  const handleUseAsRef = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    setRefImages(prev => [...prev, { id: 'ref_' + uid(), originalBase64: node.url!, fileName: `${node.label}.png` }]);
    toast.success('已加入参考图', `「${node.label}」将作为后续生成的上下文`);
  }, [findNode]);

  const handleDuplicate = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node) return;
    const copy: CanvasNodeData = { ...node, id: 'node_' + uid(), x: node.x + 32, y: node.y + 32, label: `${node.label} 副本`, refId: undefined, pins: undefined };
    setNodes(prev => [...prev, copy]);
    setSelectedIds(new Set([copy.id]));
  }, [findNode]);

  // ---------- Lovart 式智能分层 PSD ----------
  // ---------- 图片内部图层：AI 分解 → 存入节点，画板实时合成 ----------
  const decomposeNodeLayers = useCallback(async (nodeId: string): Promise<boolean> => {
    const node = findNode(nodeId);
    if (!node?.url) return false;
    if (node.layers?.length) { toast.info('该图已分解', '在图层面板展开即可控制各层'); return true; }

    const engineOk = ENGINES[engineRef.current].available() || hasGeminiKey() || hasOpenAIKey();
    if (!engineOk) { toast.error('智能分层暂未开放', '请稍后再试或联系管理员'); return false; }
    const layerEngine: EngineId = ENGINES[engineRef.current].available()
      ? engineRef.current
      : hasGeminiKey() ? 'gemini-flash' : 'gpt-image';

    toast.info('分解图层中 · 1/2', 'AI 正在分解 背景 / 产品主体 / 文字 三层…');
    try {
      // 逐层容错：单层被模型拒绝/失败不整体失败，按层降级
      const [bgR, subjectR, typoR] = await Promise.allSettled([
        generateWithEngine(layerEngine, [], buildLayerPrompt('background'), node.url, { quality: gptQualityRef.current }),
        generateWithEngine(layerEngine, [], buildLayerPrompt('subject'), node.url, { quality: gptQualityRef.current }),
        generateWithEngine(layerEngine, [], buildLayerPrompt('typography'), node.url, { quality: gptQualityRef.current }),
      ]);
      toast.info('分解图层中 · 2/2', '正在抠透明…');
      const degraded: string[] = [];
      // 背景失败 → 用原图充当背景层
      const bgUrl = bgR.status === 'fulfilled' ? bgR.value : (degraded.push('背景(用原图)'), node.url);
      // 主体：AI 提取失败 → 白键抠原图降级
      let subjectPng: string | null = null;
      if (subjectR.status === 'fulfilled') {
        subjectPng = (await cutoutToTransparentPng(subjectR.value)) ?? subjectR.value;
      } else {
        subjectPng = await cutoutToTransparentPng(node.url);
        if (subjectPng) degraded.push('主体(白键抠图)');
      }
      // 文字：失败或近全透明 → 省略该层
      let typoPng: string | null = null;
      if (typoR.status === 'fulfilled') {
        typoPng = await cutoutToTransparentPng(typoR.value) ?? null;
      }
      if (typoR.status !== 'fulfilled' || !typoPng) degraded.push('文字(无/省略)');

      const layers = [
        { id: 'ly_' + uid(), name: '背景', url: bgUrl },
        ...(subjectPng ? [{ id: 'ly_' + uid(), name: '产品主体', url: subjectPng }] : []),
        ...(typoPng ? [{ id: 'ly_' + uid(), name: '文字', url: typoPng }] : []),
      ];
      if (layers.length < 2) {
        toast.error('图层分解失败', '各层均未成功提取，可稍后重试或换一张图');
        return false;
      }
      pushHistory();
      patchNode(nodeId, { layers });
      toast.success(`图层分解完成（${layers.length} 层）`, degraded.length ? `部分降级：${degraded.join('、')}` : '画板已按图层合成显示；图层面板可展开控制各层');
      return true;
    } catch (e) {
      toast.error('图层分解失败', friendlyErrorMessage(e));
      return false;
    }
  }, [findNode, pushHistory, patchNode]);

  const toggleNodeLayer = useCallback((nodeId: string, layerId: string) => {
    const node = findNode(nodeId);
    if (!node?.layers) return;
    patchNode(nodeId, { layers: node.layers.map(l => (l.id === layerId ? { ...l, hidden: !l.hidden } : l)) });
  }, [findNode, patchNode]);

  const downloadNodeLayer = useCallback((nodeId: string, layerId: string) => {
    const node = findNode(nodeId);
    const layer = node?.layers?.find(l => l.id === layerId);
    if (!node || !layer) return;
    downloadDataUrl(layer.url, `CraftCanvas_${sanitize(node.label)}_${layer.name}.png`);
    toast.success('已开始下载', `${layer.name} 图层 PNG`);
  }, [findNode]);

  const handleExportPsd = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;

    // 已分解 → 直接用画板内图层组装（不再花费生成）
    let layers = node.layers;
    if (!layers?.length) {
      const ok = await decomposeNodeLayers(nodeId);
      layers = findNode(nodeId)?.layers;
      if (!ok || !layers?.length) {
        // AI 不可用/失败 → 白键双层降级
        try {
          const { blob, hasSubject } = await exportLayeredPsd(node.url);
          downloadBlob(blob, `CraftCanvas_${sanitize(node.label)}.psd`);
          toast.info('已降级为快速分层', hasSubject ? '背景+主体双图层' : '非白底图，单图层');
        } catch (e) {
          toast.error('PSD 导出失败', friendlyErrorMessage(e));
        }
        return;
      }
    }

    try {
      const { blob, layerNames } = await assembleMultiLayerPsd([
        ...layers.map(l => ({ name: l.name, dataUrl: l.url, hidden: l.hidden })),
        { name: '原图 Original（参考）', dataUrl: node.url, hidden: true },
      ]);
      downloadBlob(blob, `CraftCanvas_${sanitize(node.label)}_分层.psd`);
      toast.success('分层 PSD 已导出', `图层：${layerNames.join(' / ')} — PS / AI 可直接编辑`);
    } catch (e) {
      toast.error('PSD 导出失败', friendlyErrorMessage(e));
    }
  }, [findNode, decomposeNodeLayers]);

  // ---------- 单节点重试 ----------
  const retryNode = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node || node.status === 'processing' || !node.prompt) return;
    const refs = refsRef.current.map(r => r.originalBase64);
    patchNode(nodeId, { status: 'processing', errorMsg: undefined });
    try {
      const url = await generateWithEngine(node.engine, refs, node.prompt, node.baseImage, { quality: gptQualityRef.current });
      patchNode(nodeId, { status: 'completed', url });
      toast.success('重试成功', node.label);
    } catch (e) {
      patchNode(nodeId, { status: 'error', errorMsg: friendlyErrorMessage(e) });
      toast.error('重试仍失败', friendlyErrorMessage(e));
    }
  }, [findNode, patchNode]);

  // ---------- 下载 ----------
  const downloadNode = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    const link = document.createElement('a');
    link.href = node.url;
    link.download = `CraftCanvas_${sanitize(node.label)}.png`;
    link.click();
    toast.success('已开始下载', `${node.label}.png`);
  }, [findNode]);

  const downloadNodeJpg = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    try {
      const jpg = await dataUrlToJpg(node.url);
      downloadDataUrl(jpg, `CraftCanvas_${sanitize(node.label)}.jpg`);
      toast.success('已开始下载', `${node.label}.jpg（白底）`);
    } catch (e) {
      toast.error('JPG 导出失败', friendlyErrorMessage(e));
    }
  }, [findNode]);

  const downloadNodePdf = useCallback(async (nodeId: string) => {
    const node = findNode(nodeId);
    if (!node?.url) return;
    toast.info('正在生成 PDF…');
    try {
      const blob = await exportPdf(node.url);
      downloadBlob(blob, `CraftCanvas_${sanitize(node.label)}.pdf`);
      toast.success('PDF 已导出', node.label);
    } catch (e) {
      toast.error('PDF 导出失败', friendlyErrorMessage(e));
    }
  }, [findNode]);

  const zipNodes = useCallback(async (targets: CanvasNodeData[], zipName: string, groupByRun: boolean) => {
    const completed = targets.filter(n => n.status === 'completed' && n.url);
    if (completed.length === 0) { toast.info('暂无可下载的成图'); return; }
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const counters = new Map<string, number>();
      completed.forEach(n => {
        const run = runsRef.current.find(r => r.id === n.runId);
        const folder = groupByRun && run ? `${sanitize(run.title)}/` : '';
        const base = `${folder}${sanitize(n.label)}`;
        const count = (counters.get(base) ?? 0) + 1;
        counters.set(base, count);
        zip.file(`${base}${count > 1 ? `_${count}` : ''}.png`, n.url!.split(',')[1], { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${zipName}.zip`);
      toast.success('打包下载已开始', `${completed.length} 张图`);
    } catch (e) {
      toast.error('打包下载失败', friendlyErrorMessage(e));
    }
  }, []);

  const downloadRun = useCallback((runId: string) => {
    const run = runsRef.current.find(r => r.id === runId);
    zipNodes(nodesRef.current.filter(n => n.runId === runId), sanitize(run?.title ?? 'CraftCanvas'), false);
  }, [zipNodes]);

  const exportSelection = useCallback(() => {
    const sel = selectedIdsRef.current;
    zipNodes(nodesRef.current.filter(n => sel.has(n.id)), `CraftCanvas_选区_${Date.now()}`, false);
  }, [zipNodes]);

  // 项目 JSON 导出（§29.1）：完整快照（画板/批次/对话/参考图），可作备份
  const exportProjectJson = useCallback(() => {
    const snapshot = {
      app: 'CraftCanvas',
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodesRef.current,
      runs: runsRef.current,
      messages,
      refImages: refsRef.current,
      nextY: nextYRef.current,
      assetsY: assetsYRef.current,
      savedAt: Date.now(),
      layersOpen,
      canvasBg,
      annotations: canvasRef.current?.getAnnotations(),
      view: canvasRef.current?.getViewTransform(),
    };
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `CraftCanvas_项目_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('项目 JSON 已导出', `${nodesRef.current.length} 个节点 · ${messages.length} 条消息`);
  }, [messages, layersOpen, canvasBg]);

  const importProjectJson = useCallback(async (file: File) => {
    try {
      const value = JSON.parse(await file.text());
      if (!value || !['nodes', 'runs', 'messages', 'refImages'].every(key => Array.isArray(value[key]))) {
        throw new Error('请选择 CraftCanvas 导出的完整项目 JSON');
      }
      // 导入前自动下载当前项目备份，避免原有作品被静默覆盖。
      if (nodesRef.current.length || messages.length) exportProjectJson();
      const snapshot = {
        ...value,
        nextY: Number.isFinite(value.nextY) ? value.nextY : Math.max(0, ...value.nodes.map((n: CanvasNodeData) => n.y + n.h)) + BATCH_SPACING,
        assetsY: Number.isFinite(value.assetsY) ? value.assetsY : value.refImages.length * (ASSET_H + GAP),
        savedAt: Date.now(),
      };
      await saveProject(snapshot);
      window.location.reload();
    } catch (e) {
      toast.error('项目导入失败', e instanceof Error ? e.message : '请检查文件后重试');
    }
  }, [messages, exportProjectJson]);

  const downloadAll = useCallback(() => {
    // 导出全部：不含上传素材本身（按 refId 判定；素材衍生成图要包含）
    zipNodes(nodesRef.current.filter(n => !n.refId), `CraftCanvas_全部_${Date.now()}`, true);
  }, [zipNodes]);

  // ---------- 画板回调 ----------
  const moveNodes = useCallback((ids: string[], dx: number, dy: number) => {
    const idSet = new Set(ids);
    setNodes(prev => prev.map(n => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
  }, []);

  const previewNode = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (node?.url) setPreviewUrl(node.url);
  }, [findNode]);

  const handleThumbClick = useCallback((nodeId: string) => {
    const node = findNode(nodeId);
    if (!node) {
      toast.info('该图已从画板删除');
      return;
    }
    setSelectedIds(new Set([nodeId]));
    canvasRef.current?.flyToNode(nodeId);
  }, [findNode]);

  const [librarySaving, setLibrarySaving] = useState(false);
  const librarySelection = nodes.filter(n => selectedIds.has(n.id) && n.status === 'completed' && n.url && n.kind !== 'text');
  const saveSelectedToLibrary = async () => {
    setLibrarySaving(true); let count = 0;
    try {
      for (const node of librarySelection.slice(0, 20)) {
        const image = await fetch(node.url!); if (!image.ok) throw new Error('图片读取失败');
        const blob = await image.blob();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
        const upload = await fetch(`/api/assets/${hash}`, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });
        if (!upload.ok) throw new Error((await upload.json()).error?.message || '素材上传失败');
        const saved = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash, name: node.label.slice(0, 120) || '画板作品', category: node.refId ? '产品实拍' : '生成作品' }) });
        if (!saved.ok) throw new Error((await saved.json()).error?.message || '资料库保存失败');
        count++;
      }
      toast.success('已保存到资料库', `${count} 张图片，可在资料库查看与复用`);
    } catch (e) { toast.error('资料库保存未完成', `${count} 张已保存；${(e as Error).message}`); }
    finally { setLibrarySaving(false); }
  };

  const hasCompleted = useMemo(
    () => nodes.some(n => n.status === 'completed' && !n.refId),
    [nodes],
  );

  // 画板成图列表（对话栏 @ 选图作参考用）。
  // 按 refId 排除「上传素材本身」（其已在参考图条）——不能按 runId 排除整个素材 run，
  // 否则从素材衍生的成图（继承素材 runId）会被误杀（曾致弹层恒显示"没有可用的成图"）
  const canvasImages = useMemo(
    () => nodes
      .filter(n => n.status === 'completed' && n.url && !n.refId)
      .map(n => ({ id: n.id, url: n.url!, label: n.label })),
    [nodes],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper font-sans text-ink-900 selection:bg-accent-500/20">
      <Toaster />

      {/* 全局拖放遮罩 */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-[200] m-3 flex items-center justify-center rounded-3xl border-4 border-dashed border-accent-500 bg-accent-600/10 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-white/95 px-10 py-8 shadow-2xl animate-in zoom-in-95">
            <UploadCloud className="h-12 w-12 animate-bounce text-accent-600" />
            <span className="text-xl font-black tracking-tight text-ink-900">松开即可导入产品图</span>
            <span className="rounded-full border border-ink-200 bg-ink-100 px-3 py-1 text-xs font-medium text-ink-500">支持批量拖拽 · ⌘V 粘贴</span>
          </div>
        </div>
      )}

      <input ref={importProjectInputRef} type="file" accept="application/json,.json" className="hidden"
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importProjectJson(file); }} />
      {!projectLoaded && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/85 backdrop-blur-sm">
          <div ref={gateDialogRef} role="dialog" aria-modal="true" aria-labelledby="canvas-login-title" tabIndex={-1} className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-xl">
            <h2 id="canvas-login-title" className="mb-3 text-lg font-bold">{projectLoadError.includes('登录') ? '欢迎使用 CraftCanvas' : projectLoadError ? '打开云端画板' : '正在读取云端画板…'}</h2>
            <p className="mb-5 text-sm text-ink-500">{projectLoadError || '正在恢复作品，请稍候。'}</p>
            {projectLoadError && (projectLoadError.includes('登录')
              ? <a href="/account?login=1" className="inline-block rounded-xl bg-ink-900 px-5 py-3 text-sm text-white">登录 / 创建账号</a>
              : <button onClick={() => window.location.reload()} className="rounded-xl bg-ink-900 px-5 py-3 text-sm text-white">重新读取</button>)}
            {projectLoadError.includes('登录') && <a href="/account" className="mt-4 block text-sm text-ink-500 underline underline-offset-4">先了解会员方案</a>}
          </div>
        </div>
      )}

      {/* 预览模态 */}
      {previewUrl && (
        <div
          ref={previewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-ink-900/50 p-6 backdrop-blur-xl animate-in fade-in duration-200"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            className="max-h-[90vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl animate-in zoom-in-95 duration-300"
            alt="预览"
            onClick={(e) => e.stopPropagation()}
          />
          <Tip label="关闭预览 (Esc)" className="absolute right-6 top-6"><button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-all hover:bg-white/25 active:scale-90"
            onClick={() => setPreviewUrl(null)}
            aria-label="关闭预览"
          >
            <X className="h-5 w-5" />
          </button></Tip>
        </div>
      )}

      {/* 设置面板 */}
      {/* ⌘K 命令面板 */}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          commands={([
            { id: 'export-all', title: '导出全部成图（ZIP）', hint: '按批次分文件夹', keywords: 'export zip download', run: downloadAll },
            { id: 'import-json', title: '导入项目 JSON', hint: '迁移旧站作品；先备份当前画板', keywords: 'import json 导入 迁移', run: () => importProjectInputRef.current?.click() },
            { id: 'export-json', title: '导出项目 JSON', hint: '完整项目快照（画板/批次/对话），可作备份', keywords: 'json backup 备份 快照 snapshot', run: exportProjectJson },
            { id: 'layers', title: layersOpen ? '关闭图层面板' : '打开图层面板', keywords: 'layers panel', run: () => setLayersOpen(o => !o) },
            { id: 'fit', title: '适配全部内容', hint: '⌘0', keywords: 'fit zoom all', run: () => canvasRef.current?.fitAll() },
            { id: 'arrange', title: '整理排列（网格对齐）', keywords: 'arrange grid tidy', run: handleArrange },
            { id: 'select-all', title: '全选节点', hint: '⌘A', keywords: 'select all', run: () => setSelectedIds(new Set(nodesRef.current.map(n => n.id))) },
            { id: 'undo', title: '撤销', hint: '⌘Z', keywords: 'undo', run: undo },
            { id: 'redo', title: '重做', hint: '⌘⇧Z', keywords: 'redo', run: redo },
            { id: 'upload', title: '上传产品图 / 参考图', keywords: 'upload image', run: () => fileInputRef.current?.click() },
            { id: 'chat', title: chatOpen ? '收起对话栏' : '展开对话栏', keywords: 'chat panel toggle', run: () => setChatOpen(o => !o) },
            { id: 'shortcuts', title: '快捷键说明', keywords: 'shortcuts keyboard help', run: () => setShortcutsOpen(true) },
            { id: 'account', title: '账号与会员中心', keywords: 'account membership 额度 积分', run: () => window.location.assign('/account') },
            { id: 'engine-flash', title: '切换引擎：Gemini Flash 极速', keywords: 'engine gemini flash', run: () => { setEngine('gemini-flash'); toast.success('已切换引擎', 'Gemini Flash 极速'); } },
            { id: 'engine-pro', title: '切换引擎：Gemini Pro 超清', keywords: 'engine gemini pro', run: () => { setEngine('gemini-pro'); toast.success('已切换引擎', 'Gemini Pro 超清'); } },
            { id: 'engine-gpt', title: '切换引擎：GPT Image 2', keywords: 'engine gpt openai', run: () => { setEngine('gpt-image'); toast.success('已切换引擎', 'GPT Image 2'); } },
            { id: 'mode-chat', title: '工作流：自由创作', keywords: 'mode chat', run: () => setMode('chat') },
            { id: 'mode-angle', title: '工作流：单品多角度（6 图）', keywords: 'mode angle', run: () => setMode('angle') },
            { id: 'mode-layout', title: '工作流：多组件重排（6 图）', keywords: 'mode layout knolling', run: () => setMode('layout') },
            { id: 'mode-nine', title: '工作流：一键九图', keywords: 'mode nine grid', run: () => setMode('nine') },
          ] as Command[])}
        />
      )}

      {/* 快捷键说明弹窗 */}
      {shortcutsOpen && (
        <div
          ref={shortcutsDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
          className="fixed inset-0 z-[150] flex items-center justify-center bg-ink-900/40 p-6 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-ink-100 bg-white p-7 shadow-2xl animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="shortcuts-title" className="flex items-center gap-2 text-base font-black tracking-tight text-ink-900">
                <Keyboard className="h-5 w-5 text-accent-600" /> 快捷键
              </h2>
              <Tip label="关闭快捷键说明"><button onClick={() => setShortcutsOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700">
                <X className="h-4 w-4" />
              </button></Tip>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
              {([
                ['V', '选择工具'], ['H', '抓手工具'], ['P', '批注工具'], ['空格(按住)', '临时抓手'],
                ['Tab', '选中图→编辑元素'], ['Esc', '退出/关闭'],
                ['⌘ C', '复制节点'], ['⌘ V', '粘贴节点/图片'], ['⌘ D', '原位复制'], ['⌘ A', '全选'],
                ['⌫ / Delete', '删除选中'], ['⌘ Z', '撤销'], ['⌘ ⇧ Z', '重做'],
                ['⌘ 0', '适配全部内容'], ['⌘ 1', '缩放至 100%'], ['⌘ + / −', '放大 / 缩小'],
                ['⌘ + 滚轮', '缩放到光标'], ['滚轮', '平移画板'],
                ['双击图片', '预览大图'], ['右键', '上下文菜单'],
                ['Enter', '发送 / 确认'], ['⇧ Enter', '输入框换行'], ['@', '引用画板图片'],
              ] as [string, string][]).map(([k, desc]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-ink-100/60 py-1.5">
                  <span className="text-ink-500">{desc}</span>
                  <kbd className="whitespace-nowrap rounded-md bg-ink-100 px-1.5 py-0.5 font-bold text-ink-700">{k}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}



      <input type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} aria-label="上传图片" />
      <input type="file" accept="image/*" className="hidden" ref={replaceInputRef} onChange={handleReplaceFile} aria-label="替换图片" />

      {/* 画板区 */}
      <div className="relative min-w-0 flex-1">
        <CanvasBoard
          ref={canvasRef}
          layoutMotionKey={layoutMotionKey}
          nodes={nodes}
          runs={runs}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onMoveNodes={moveNodes}
          onPreview={previewNode}
          onRetry={retryNode}
          onDelete={(ids) => { pushHistory(); deleteNodes(ids); }}
          onDownloadNode={downloadNode}
          onDownloadJpg={downloadNodeJpg}
          onDownloadPdf={downloadNodePdf}
          onDecomposeLayers={decomposeNodeLayers}
          onAlign={alignNodes}
          onDistribute={distributeNodes}
          onCreateText={createTextNode}
          onUpdateNodeText={updateNodeText}
          onSetNodeFrame={setNodeFrame}
          onReplaceImage={requestReplaceImage}
          onExportSelection={exportSelection}
          onCutSelection={cutSelection}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          onToggleLock={(id) => { pushHistory(); patchNode(id, { locked: !findNode(id)?.locked }); }}
          onToggleHide={(id) => { pushHistory(); patchNode(id, { hidden: !findNode(id)?.hidden }); }}
          onMoveLayerStep={moveLayer}
          onRevealInLayers={(id) => { setLayersOpen(true); setSelectedIds(new Set([id])); }}
          onTransformNode={handleTransformNode}
          onCopyStyle={copyNodeStyle}
          onPasteStyle={pasteNodeStyle}
          canvasBg={canvasBg}
          onSetCanvasBg={setCanvasBg}
          onAnnotationsChange={() => setAnnBump(b => b + 1)}
          onImageNaturalSize={onImageNaturalSize}
          restorePayload={restorePayload}
          leftPanelOpen={layersOpen}
          onDownloadRun={downloadRun}
          onUploadClick={() => fileInputRef.current?.click()}
          hasRefs={refImages.length > 0}
          onVariation={handleVariation}
          onUpscale={handleUpscale}
          onCutout={handleCutout}
          onOutpaint={handleOutpaint}
          onUseAsRef={handleUseAsRef}
          onDuplicate={handleDuplicate}
          onExportPsd={handleExportPsd}
          onExportSvg={handleExportSvg}
          onUpdatePins={handleUpdatePins}
          onRunPins={handleRunPins}
          onOpenRunChat={handleOpenRunChat}
          onIdentifyElement={handleIdentifyElement}
          onTouchEdit={handleTouchEdit}
          onArrange={handleArrange}
          onBeforeMove={pushHistory}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
          onCopySelection={copySelection}
          onPasteClipboard={pasteClipboard}
          onSelectAll={() => setSelectedIds(new Set(nodesRef.current.map(n => n.id)))}
          onTextToImage={handleTextToImage}
          onImageToImage={handleImageToImage}
          onImageToVideo={handleImageToVideo}
        />

        {/* 图层面板 */}
        {layersOpen && (
          <LayersPanel
            nodes={nodes}
            selectedIds={selectedIds}
            onSelect={(id, additive) => {
              setSelectedIds(prev => {
                if (!additive) return new Set([id]);
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });
            }}
            onToggleLock={(id) => { pushHistory(); patchNode(id, { locked: !findNode(id)?.locked }); }}
            onToggleHide={(id) => { pushHistory(); patchNode(id, { hidden: !findNode(id)?.hidden }); }}
            onMoveLayer={moveLayer}
            onFlyTo={(id) => canvasRef.current?.flyToNode(id)}
            onClose={() => setLayersOpen(false)}
            onDecompose={decomposeNodeLayers}
            onToggleNodeLayer={toggleNodeLayer}
            onDownloadLayer={downloadNodeLayer}
            onRename={renameNode}
            onReorder={reorderNode}
          />
        )}

        {/* 顶栏 */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div
            className="pointer-events-auto flex shrink-0 items-center gap-2.5 rounded-2xl border border-ink-200/70 bg-white/95 py-2 pl-3 pr-4 shadow-lg backdrop-blur-md"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <a href="/" className="flex items-center gap-2.5" aria-label="CraftCanvas 首页"><LogoMark size={28} /><BrandWordmark /></a>
            {/* 自动保存状态（Lovart 式顶栏提示） */}
            <Tip label={saveError || '项目自动保存在云端，当前浏览器保留备份'}><span
              role="status"
              tabIndex={0}
              className={`ml-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                saveState === 'saving' ? 'bg-ink-100 text-ink-400'
                  : saveState === 'error' ? 'bg-red-50 text-red-500'
                  : saveState === 'saved' ? 'bg-emerald-50 text-emerald-600' : 'bg-ink-100 text-ink-300'
              }`}
            >
              {saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : saveState === 'saved' ? '已保存' : '自动保存'}
            </span></Tip>
          </div>
          {saveError && <div role="alert" className="pointer-events-auto order-last flex w-full flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg">
            <span className="flex-1">{saveError}</span>
            {!saveConflict && <button className="min-h-11 rounded-lg px-3 font-bold hover:bg-red-50" onClick={() => setSaveAttempt(value => value + 1)}>重试保存</button>}
            <button className="min-h-11 rounded-lg px-3 font-bold hover:bg-red-50" onClick={exportProjectJson}>导出本地备份</button>
            {saveConflict && <button className="min-h-11 rounded-lg px-3 font-bold hover:bg-red-50" onClick={() => { exportProjectJson(); window.location.reload(); }}>备份后读取云端</button>}
          </div>}
          <div className="pointer-events-auto ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <a href="/workflow" className="whitespace-nowrap rounded-xl border border-accent-200 bg-white/95 px-3 py-2.5 text-xs font-bold text-accent-700 shadow-lg hover:bg-accent-50">节点工作流</a>
            <a href="/library" className="whitespace-nowrap rounded-xl border border-ink-200/70 bg-white/95 px-3 py-2.5 text-xs font-bold text-ink-700 shadow-lg hover:text-accent-700">资料库</a>
            <a href="/account" className="whitespace-nowrap rounded-xl border border-ink-200/70 bg-white/95 px-3 py-2.5 text-xs font-bold text-ink-700 shadow-lg hover:text-accent-700">账号与会员</a>
            <Tip label="图层面板"><button
              onClick={() => setLayersOpen(o => !o)}
              aria-expanded={layersOpen}
              className={`flex items-center gap-1.5 rounded-xl border border-ink-200/70 px-3 py-2.5 text-xs font-bold shadow-lg backdrop-blur-md transition-colors ${layersOpen ? 'bg-accent-600 text-white' : 'bg-white/95 text-ink-700 hover:text-accent-700'}`}
            >
              <LayersIcon className="h-4 w-4" />
            </button></Tip>
            <Tip label="快捷键说明"><button
              onClick={() => setShortcutsOpen(true)}
              aria-haspopup="dialog"
              className="flex items-center gap-1.5 rounded-xl border border-ink-200/70 bg-white/95 px-3 py-2.5 text-xs font-bold text-ink-700 shadow-lg backdrop-blur-md transition-colors hover:text-accent-700"
            >
              <Keyboard className="h-4 w-4" />
            </button></Tip>
            {librarySelection.length > 0 && <button disabled={librarySaving} onClick={() => void saveSelectedToLibrary()} className="rounded-xl border border-ink-200/70 bg-white/95 px-3 py-2.5 text-xs font-bold text-ink-700 shadow-lg hover:text-accent-700">{librarySaving ? '归档中…' : '保存选中到资料库'}</button>}
            {hasCompleted && (
              <button
                onClick={downloadAll}
                className="flex items-center gap-1.5 rounded-xl border border-ink-200/70 bg-white/95 px-3.5 py-2.5 text-xs font-bold text-ink-700 shadow-lg backdrop-blur-md transition-colors hover:text-accent-700"
              >
                <Download className="h-3.5 w-3.5" /> 导出全部
              </button>
            )}
            <Tip label={chatOpen ? '收起对话' : '展开对话'}><button
              onClick={() => setChatOpen(o => !o)}
              aria-expanded={chatOpen}
              className="flex items-center gap-1.5 rounded-xl border border-ink-200/70 bg-white/95 px-3 py-2.5 text-xs font-bold text-ink-700 shadow-lg backdrop-blur-md transition-colors hover:text-accent-700"
            >
              {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button></Tip>
          </div>
        </div>
      </div>

      {/* 对话抽屉 */}
      <div inert={!chatOpen} aria-hidden={!chatOpen} className={`fixed inset-y-0 right-0 z-[60] h-full shrink-0 overflow-hidden md:relative md:inset-auto md:z-30 border-l border-ink-200/80 shadow-[-8px_0_30px_rgb(0,0,0,0.03)] transition-[width] duration-300 ease-out ${chatOpen ? 'w-[min(400px,100vw)]' : 'w-0 border-l-0'}`}>
        <div className="h-full w-[min(400px,100vw)] overflow-hidden">
          <ChatPanel
            onClose={() => setChatOpen(false)}
            messages={messages}
            refImages={refImages}
            onRemoveRef={removeRef}
            onUploadClick={() => fileInputRef.current?.click()}
            mode={mode}
            setMode={setMode}
            engine={engine}
            setEngine={setEngine}
            gptQuality={gptQuality}
            setGptQuality={setGptQuality}
            specText={specText}
            setSpecText={setSpecText}
            isGenerating={isGenerating}
            refineTargets={refineTargets}
            onClearRefineTargets={() => setSelectedIds(new Set())}
            onGenerate={startGeneration}
            onRefine={startRefine}
            onThumbClick={handleThumbClick}
            refineAnnCount={refineAnnCount}
            includeAnnotations={includeAnnotations}
            onToggleAnnotations={() => setIncludeAnnotations(v => !v)}
            canvasImages={canvasImages}
            onPickCanvasRef={handleUseAsRef}
            scope={scope}
            onExitScope={() => setScope(null)}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
