import { selectedTemplate } from '../services/templates';
import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChatMessage, ProductImage, GenerationMode, CanvasNodeData } from '../types';
import { EngineId, ENGINES } from '../services/engine';
import type { GptQuality } from '../services/openaiService';
import { PROMPT_PRESETS } from '../services/prompts';
import { ENGINE_ICONS } from './EngineSelect';
import UsageSummary from './UsageSummary';
import { creationPrice } from '../services/keys';
import { LogoMark } from './Logo';
import { useMenuNavigation } from '../services/useMenuNavigation';
import {
  Send, Loader2, X, Plus, Image as ImageIcon, LayoutDashboard, Grid3x3, ClipboardList,
  UserRound, PanelRightClose, MessageSquareText, Lightbulb, GalleryHorizontalEnd, ChevronDown, Check, Frame,
} from 'lucide-react';

const QUALITY_META: Record<GptQuality, { label: string; hint: string }> = {
  low: { label: '快速', hint: '快速预览与构思' },
  medium: { label: '标准', hint: '兼顾速度与细节' },
  high: { label: '精细', hint: '适合最终成图' },
};

// 模型偏好列表（Image tab）：引擎 + 质量合并为统一模型选择（Lovart 式）
const IMAGE_MODELS: { key: string; engine: EngineId; quality?: GptQuality; name: string; desc: string }[] = [
  { key: 'gpt-low', engine: 'gpt-image', quality: 'low', name: 'Image 2.5 Flare · 低', desc: '快速实惠，适合大多数任务' },
  { key: 'gpt-medium', engine: 'gpt-image', quality: 'medium', name: 'Image 2.5 Flare · 中', desc: '更多细节，成本适中' },
  { key: 'gpt-high', engine: 'gpt-image', quality: 'high', name: 'Image 2.5 Flare · 高', desc: '细节最佳，成本最高' },
  { key: 'sunburst-low', engine: 'gpt-image-sunburst', quality: 'low', name: 'Image 2.5 Sunburst · 低', desc: '精细编辑模型 · 草稿质量' },
  { key: 'sunburst-medium', engine: 'gpt-image-sunburst', quality: 'medium', name: 'Image 2.5 Sunburst · 中', desc: '精细编辑模型 · 标准质量' },
  { key: 'sunburst-high', engine: 'gpt-image-sunburst', quality: 'high', name: 'Image 2.5 Sunburst · 高', desc: '精细编辑模型 · 高质量' },
  { key: 'gemini-flash', engine: 'gemini-flash', name: 'Gemini 3.1 极速', desc: '快速出图 · 1K · 智能清点 3.8' },
  { key: 'gemini-pro', engine: 'gemini-pro', name: 'Gemini 3.1 超清', desc: '高保真 · 2K · 智能清点 3.8' },
];

const modelDisplayName = (engine: EngineId, quality: GptQuality): string =>
  engine.startsWith('gpt-image') ? `${ENGINES[engine].label} · ${QUALITY_META[quality].label}` : ENGINES[engine].label;

const MODE_META: Record<GenerationMode, { label: string; count: number; icon: React.ReactNode; desc: string }> = {
  chat: { label: '自由创作', count: 1, icon: <MessageSquareText className="h-3.5 w-3.5" />, desc: '直接说想要的画面，聊着生图' },
  angle: { label: '多角度', count: 6, icon: <ImageIcon className="h-3.5 w-3.5" />, desc: '正视 / 3D / 侧 / 背 / 俯 / 细节' },
  layout: { label: '重排', count: 6, icon: <LayoutDashboard className="h-3.5 w-3.5" />, desc: '6 种白底 knolling 排版' },
  nine: { label: '一键九图', count: 9, icon: <Grid3x3 className="h-3.5 w-3.5" />, desc: '3 细节 + 3 场景 + 3 参数图' },
};

// 悬浮中文提示
import Tip from './Tip';

interface ChatPanelProps {
  onClose: () => void;
  messages: ChatMessage[];
  refImages: ProductImage[];
  onRemoveRef: (id: string) => void;
  onUploadClick: () => void;
  mode: GenerationMode;
  setMode: (m: GenerationMode) => void;
  engine: EngineId;
  setEngine: (e: EngineId) => void;
  gptQuality: GptQuality;
  setGptQuality: (q: GptQuality) => void;
  specText: string;
  setSpecText: (s: string) => void;
  isGenerating: boolean;
  refineTargets: CanvasNodeData[];
  onClearRefineTargets: () => void;
  onGenerate: (customText: string) => void;
  onRefine: (instruction: string) => void;
  onThumbClick: (nodeId: string) => void;
  canvasImages: { id: string; url: string; label: string }[];
  onPickCanvasRef: (nodeId: string) => void;
  /** Frame 独立子对话作用域 */
  scope: { runId: string; title: string } | null;
  onExitScope: () => void;
  /** 重绘目标上的画布标注数 + 是否烧入给 AI */
  refineAnnCount: number;
  includeAnnotations: boolean;
  onToggleAnnotations: () => void;
}

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

const ChatPanel: React.FC<ChatPanelProps> = ({
  onClose, messages, refImages, onRemoveRef, onUploadClick,
  mode, setMode, engine, setEngine, gptQuality, setGptQuality, specText, setSpecText,
  isGenerating, refineTargets, onClearRefineTargets,
  onGenerate, onRefine, onThumbClick,
  canvasImages, onPickCanvasRef, scope, onExitScope,
  refineAnnCount, includeAnnotations, onToggleAnnotations,
}) => {
  const [text, setText] = useState(() => selectedTemplate()?.prompt || '');
  const [popover, setPopover] = useState<'presets' | 'canvas' | 'mode' | 'models' | null>(null);
  const [modelTab, setModelTab] = useState<'image' | 'video' | '3d'>('image');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useMenuNavigation(popover, popoverRef, () => setPopover(null));
  const openMenu = (event: React.KeyboardEvent, kind: typeof popover) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setPopover(kind); }
  };

  // 作用域过滤：框架对话只看该框架的消息
  const visibleMessages = useMemo(
    () => (scope ? messages.filter(m => m.runId === scope.runId) : messages),
    [messages, scope],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleMessages]);

  useEffect(() => {
    if (refineTargets.length > 0) inputRef.current?.focus();
  }, [refineTargets.length]);

  useEffect(() => {
    if (scope) inputRef.current?.focus();
  }, [scope]);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popoverRef.current?.contains(t) && !controlsRef.current?.contains(t)) setPopover(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [popover]);

  const engineAvailable = ENGINES[engine].available();
  const isRefine = refineTargets.length > 0;
  const refineEngineOk = isRefine ? refineTargets.every(t => ENGINES[t.engine].available()) : true;
  // 自由创作/框架对话：只需文字；预设工作流：需要参考图
  const generateReady = (scope || mode === 'chat') ? text.trim().length > 0 : refImages.length > 0;
  const canSend = !isGenerating && (isRefine ? refineEngineOk && text.trim().length > 0 : engineAvailable && generateReady);

  const handleSend = () => {
    if (!canSend) return;
    if (isRefine) {
      onRefine(text.trim());
    } else {
      onGenerate(text.trim());
    }
    setText('');
  };

  const sendTip = isGenerating
    ? '正在生成中…'
    : isRefine
      ? (refineTargets.length > 1 ? `批量重绘选中的 ${refineTargets.length} 张图` : '按指令重绘选中图片')
      : scope ? '在当前框架内生成'
      : mode === 'chat' ? '按描述生成 1 张图'
      : `发起「${MODE_META[mode].label}」· 生成 ${MODE_META[mode].count} 张图`;

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* 头部 */}
      <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
        <LogoMark size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black tracking-tight text-ink-900">设计助理</h2>
          <p className="truncate text-[11px] text-ink-400">{ENGINES[engine].tagline}</p>
        </div>
        <button onClick={onClose} aria-label="查看画板" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 md:hidden"><PanelRightClose size={18} /></button>
        <Tip label="账号与会员">
          <a href="/account" aria-label="账号与会员"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-accent-700"
          >
            <UserRound className="h-4 w-4" />
          </a>
        </Tip>
      </div>

      <UsageSummary refresh={isGenerating} />

      {/* 框架作用域横幅 */}
      {scope && (
        <div className="flex items-center gap-2 border-b border-accent-100 bg-accent-50/70 px-4 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <Frame className="h-3.5 w-3.5 shrink-0 text-accent-600" />
          <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-accent-700">
            框架对话：{scope.title}
          </p>
          <Tip label="退出框架，回到全局对话">
            <button onClick={onExitScope} className="flex h-6 w-6 items-center justify-center rounded-full text-accent-600 transition-colors hover:bg-accent-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </Tip>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {visibleMessages.length === 0 && !scope && (
          <div className="space-y-3 pt-6">
            <p className="text-center text-xs leading-relaxed text-ink-400">
              直接输入文字即可生图；上传产品实拍图后<br />可用预设工作流，或选中画板图片追问重绘。
            </p>
            <div className="space-y-2">
              {(Object.keys(MODE_META) as GenerationMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${mode === m ? 'border-accent-200 bg-accent-50/70' : 'border-ink-100 hover:border-ink-200'}`}
                >
                  <span className={mode === m ? 'text-accent-600' : 'text-ink-400'}>{MODE_META[m].icon}</span>
                  <span className="flex-1">
                    <span className="block text-xs font-bold text-ink-700">{MODE_META[m].label}</span>
                    <span className="block text-[10px] text-ink-400">{MODE_META[m].desc}</span>
                  </span>
                  <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-black text-ink-500">{m === 'chat' ? '对话' : `${MODE_META[m].count} 图`}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {visibleMessages.length === 0 && scope && (
          <p className="pt-8 text-center text-xs leading-relaxed text-ink-400">
            这是「{scope.title}」的独立对话。<br />在下方输入，生成结果会直接落入该框架。
          </p>
        )}

        {visibleMessages.map((msg, i) => {
          const prev = visibleMessages[i - 1];
          const showDate = msg.ts && (!prev?.ts || new Date(prev.ts).toDateString() !== new Date(msg.ts).toDateString());
          return (
            <React.Fragment key={msg.id}>
              {/* 日期分隔线（Lovart 式） */}
              {showDate && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-ink-100" />
                  <span className="text-[10px] font-bold text-ink-300">{fmtDate(msg.ts!)}</span>
                  <div className="h-px flex-1 bg-ink-100" />
                </div>
              )}
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.refImages && msg.refImages.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {msg.refImages.slice(0, 4).map((src, j) => (
                        <img key={j} src={src} className="h-12 w-12 rounded-lg border border-ink-200 object-cover" alt="参考图" />
                      ))}
                      {msg.refImages.length > 4 && (
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-ink-100 text-[10px] font-bold text-ink-500">+{msg.refImages.length - 4}</span>
                      )}
                    </div>
                  )}
                  {/* 模型徽章（Lovart 式结果标注） */}
                  {msg.role === 'assistant' && msg.engine && !msg.pending && (
                    <span className="flex w-fit items-center gap-1.5 rounded-md bg-ink-100 px-2 py-1 text-[10px] font-black text-ink-500">
                      {ENGINE_ICONS[msg.engine]}
                      {ENGINES[msg.engine].tagline.split(' · ')[0]}
                    </span>
                  )}
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-br-md bg-ink-900 text-white'
                        : 'rounded-bl-md bg-ink-100/80 text-ink-700'
                    }`}
                  >
                    {msg.pending && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin text-accent-600" />}
                    {msg.text}
                  </div>
                  {msg.thumbs && msg.thumbs.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {msg.thumbs.map(t => (
                        <Tip key={t.nodeId} label="在画板中定位这张图">
                          <button
                            onClick={() => onThumbClick(t.nodeId)}
                            className="group relative aspect-square w-full overflow-hidden rounded-lg border border-ink-200 bg-white transition-all hover:border-accent-500 hover:shadow-md"
                          >
                            <img src={t.url} className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-110" alt="生成结果" />
                          </button>
                        </Tip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* 底部工作台 */}
      <div className="space-y-3 border-t border-ink-100 px-4 pb-4 pt-3">
        {/* 追问重绘目标 */}
        {isRefine && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex -space-x-2">
              {refineTargets.slice(0, 3).map(t => (
                t.url && <img key={t.id} src={t.url} className="h-9 w-9 rounded-lg border-2 border-white bg-white object-contain shadow-sm" alt={t.label} />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">
                {refineTargets.length > 1 ? `批量重绘 · ${refineTargets.length} 张` : '追问重绘'}
              </p>
              <p className="truncate text-xs font-bold text-ink-700">
                {refineTargets.length > 1 ? refineTargets.map(t => t.label).join('、') : refineTargets[0].label}
              </p>
            </div>
            <Tip label="取消重绘选中">
              <button onClick={onClearRefineTargets} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-amber-100 hover:text-ink-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </div>
        )}

        {/* 画布标注烧入开关：目标图上有标注时出现，让 AI 看见"改哪里" */}
        {isRefine && refineAnnCount > 0 && (
          <button
            onClick={onToggleAnnotations}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors animate-in fade-in slide-in-from-bottom-2 duration-200 ${includeAnnotations ? 'border-accent-300 bg-accent-50/70' : 'border-ink-200 bg-white hover:bg-ink-50'}`}
          >
            <span className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${includeAnnotations ? 'justify-end bg-accent-500' : 'justify-start bg-ink-200'}`}>
              <span className="h-4 w-4 rounded-full bg-white shadow" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-ink-700">
                {includeAnnotations ? `含 ${refineAnnCount} 处画布标注` : `不含画布标注（${refineAnnCount} 处）`}
              </span>
              <span className="block text-[10px] text-ink-400">
                {includeAnnotations ? '标注会烧进图作为 AI 修改指引，成图不含红色标记' : '开启后 AI 能看见你圈画的区域与指令'}
              </span>
            </span>
          </button>
        )}

        {/* 九图参数输入 */}
        {!isRefine && !scope && mode === 'nine' && (
          <div className="space-y-1.5 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-600">
              <ClipboardList className="h-3.5 w-3.5" />
              产品参数 · 用于 3 张参数图
            </label>
            <textarea
              value={specText}
              onChange={(e) => setSpecText(e.target.value)}
              placeholder="每行一项，AI 将严格按此标注，例如 尺寸 120x45x30mm、材质 铝合金、容量 5000mAh、重量 180g"
              className="h-24 w-full resize-none rounded-lg border border-amber-200/60 bg-white/80 p-2.5 text-xs leading-relaxed text-ink-700 shadow-inner outline-none transition-all placeholder:text-ink-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
            />
            <p className="text-[10px] leading-relaxed text-amber-500/90">
              {specText.trim() ? '将严格按以上数据渲染英文参数标注。' : '未填写时参数图只标注可见特征，不虚构数值。'}
            </p>
          </div>
        )}

        {/* 参考图物料 */}
        {!isRefine && (
          <div className="flex flex-wrap items-center gap-1.5">
            {refImages.map(img => (
              <div key={img.id} className="group relative h-12 w-12">
                <img src={img.originalBase64} className="h-full w-full rounded-lg border border-ink-200 object-cover" alt={img.fileName} />
                <Tip label={`移除参考图：${img.fileName}`} className="absolute -right-1.5 -top-1.5"><button
                  onClick={() => onRemoveRef(img.id)}
                  className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-ink-900 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button></Tip>
              </div>
            ))}
            <Tip label={refImages.length === 0 ? '上传产品实拍图' : '继续添加参考图'}>
              <button
                onClick={onUploadClick}
                className={`flex h-12 items-center justify-center gap-1 rounded-lg border-2 border-dashed text-[11px] font-bold transition-colors ${
                  refImages.length === 0
                    ? 'w-full border-accent-300 bg-accent-50/50 px-4 py-2 text-accent-700 hover:border-accent-400'
                    : 'w-12 border-ink-200 text-ink-400 hover:border-accent-300 hover:text-accent-700'
                }`}
              >
                <Plus className="h-4 w-4" />
                {refImages.length === 0 && ((scope || mode === 'chat') ? '上传参考图（可选）' : '上传产品实拍图（必需）')}
              </button>
            </Tip>
          </div>
        )}

        {/* 输入 + 发送 */}
        <div className="relative rounded-2xl border border-ink-200 bg-ink-100/50 p-2 shadow-inner transition-all focus-within:border-accent-400 focus-within:ring-2 focus-within:ring-accent-500/10">
          {/* 弹层：提示词库 / 画板选图 / 工作流选择 */}
          {popover && (
            <div
              ref={popoverRef}
              id={menuId}
              role="menu"
              aria-label={popover === 'models' ? '模型偏好' : popover === 'mode' ? '工作流' : popover === 'presets' ? '内置提示词库' : '画板参考图'}
              tabIndex={-1}
              onKeyDown={event => event.stopPropagation()}
              data-canvas-ui
              className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-ink-200/80 bg-white p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              {popover === 'presets' && (
                <div className="space-y-3">
                  {PROMPT_PRESETS.map(group => (
                    <div key={group.category}>
                      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-ink-400">{group.category}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map(p => (
                          <Tip key={p.label} label={p.text}><button
                            role="menuitem"
                            aria-label={p.label}
                            onClick={() => { setText(p.text); setPopover(null); inputRef.current?.focus(); }}
                            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-ink-700 transition-all hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
                          >
                            {p.label}
                          </button></Tip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {popover === 'canvas' && (
                <div>
                  <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-ink-400">画板图片 · 点击设为参考图</p>
                  {canvasImages.length === 0 ? (
                    <p className="py-4 text-center text-xs text-ink-400">画板上还没有可用的成图</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {canvasImages.map(img => (
                        <Tip key={img.id} label={img.label} className="w-full"><button
                          role="menuitem"
                          aria-label={`引用画板图：${img.label}`}
                          onClick={() => { onPickCanvasRef(img.id); setPopover(null); }}
                          className="group relative aspect-square w-full overflow-hidden rounded-lg border border-ink-200 bg-white transition-all hover:border-accent-500 hover:shadow-md"
                        >
                          <img src={img.url} className="h-full w-full object-contain" alt={img.label} />
                        </button></Tip>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {popover === 'models' && (
                <div>
                  <p className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-ink-400">模型偏好</p>
                  {/* Image / Video / 3D 分段 */}
                  <div role="group" aria-label="生成类别" className="mb-2 flex gap-1 rounded-xl bg-ink-100 p-1">
                    {(['image', 'video', '3d'] as const).map(t => (
                      <button
                        key={t}
                        role="menuitemradio"
                        aria-checked={modelTab === t}
                        onClick={() => setModelTab(t)}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors ${modelTab === t ? 'bg-white text-ink-800 shadow-sm' : 'text-ink-400 hover:text-ink-600'}`}
                      >
                        {t === 'image' ? 'Image' : t === 'video' ? 'Video' : '3D'}
                      </button>
                    ))}
                  </div>
                  {modelTab === 'image' ? (
                    <div role="group" aria-label="图像模型与质量" className="space-y-0.5">
                      {IMAGE_MODELS.map(m => {
                        const active = engine === m.engine && (!m.quality || m.quality === gptQuality);
                        const ok = ENGINES[m.engine].available();
                        return (
                          <button
                            key={m.key}
                            role="menuitemradio"
                            aria-checked={active}
                            disabled={!ok}
                            onClick={() => { setEngine(m.engine); if (m.quality) setGptQuality(m.quality); setPopover(null); }}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${!ok ? 'cursor-not-allowed opacity-40' : active ? 'bg-accent-50/70' : 'hover:bg-ink-100'}`}
                          >
                            <span className="mt-0.5 shrink-0">{ENGINE_ICONS[m.engine]}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-xs font-bold text-ink-800">
                                {m.name}
                                {!ok && <span className="rounded bg-amber-50 px-1 py-px text-[9px] font-black text-amber-600">暂未开放</span>}
                              </span>
                              <span className="block truncate text-[10px] text-ink-400">{m.desc}</span>
                            </span>
                            {active && <Check className="h-4 w-4 shrink-0 text-accent-600" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-3 py-6 text-center text-xs leading-relaxed text-ink-400">
                      {modelTab === 'video' ? '视频生成' : '3D 生成'}暂未接入模型，敬请期待。
                    </p>
                  )}
                </div>
              )}
              {popover === 'mode' && (
                <div className="space-y-1">
                  <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-widest text-ink-400">工作流</p>
                  {(Object.keys(MODE_META) as GenerationMode[]).map(m => (
                    <button
                      key={m}
                      role="menuitemradio"
                      aria-checked={mode === m}
                      onClick={() => { setMode(m); setPopover(null); }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${mode === m ? 'bg-accent-50/70' : 'hover:bg-ink-100'}`}
                    >
                      <span className={mode === m ? 'text-accent-600' : 'text-ink-400'}>{MODE_META[m].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-ink-700">{MODE_META[m].label}</span>
                        <span className="block truncate text-[10px] text-ink-400">{MODE_META[m].desc}</span>
                      </span>
                      {mode === m && <Check className="h-4 w-4 shrink-0 text-accent-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={inputRef}
            aria-label={isRefine ? '图片修改要求' : '创作要求'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
                return;
              }
              if (e.key === '@' && canvasImages.length > 0) setPopover('canvas');
            }}
            placeholder={
              isRefine ? '描述修改要求，如：背景换成浅灰渐变…'
                : scope ? `在「${scope.title}」内继续创作，如：再来一张俯拍角度…`
                : mode === 'chat' ? '直接描述想要的画面，如：这款保温杯放在晨光露营桌上的场景图…'
                : '补充要求（可选），如：整体偏冷色调、保留金属质感…'
            }
            className="h-14 w-full resize-none bg-transparent px-2 pt-1 text-[13px] leading-relaxed text-ink-700 outline-none placeholder:text-ink-400"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <div ref={controlsRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {/* 工作流下拉（Lovart Agent 式）；框架对话下锁定 */}
              {!isRefine && !scope && (
                <div ref={modeRef} className="shrink-0">
                  <Tip label={`工作流：${MODE_META[mode].label}（点击切换）`}>
                    <button
                      aria-haspopup="menu"
                      aria-expanded={popover === 'mode'}
                      aria-controls={menuId}
                      onKeyDown={event => openMenu(event, 'mode')}
                      onClick={() => setPopover(p => (p === 'mode' ? null : 'mode'))}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all ${popover === 'mode' ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-ink-200 bg-white text-accent-600 shadow-sm hover:border-ink-300'}`}
                    >
                      {MODE_META[mode].icon}
                    </button>
                  </Tip>
                </div>
              )}
              {/* 模型偏好（引擎+质量合一，Lovart 式） */}
              <div ref={modelRef} className="shrink-0">
                <Tip label={`模型：${modelDisplayName(engine, gptQuality)}（点击切换）`}>
                  <button
                    aria-haspopup="menu"
                    aria-expanded={popover === 'models'}
                    aria-controls={menuId}
                    onKeyDown={event => openMenu(event, 'models')}
                    onClick={() => setPopover(p => (p === 'models' ? null : 'models'))}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all ${popover === 'models' ? 'border-accent-300 bg-accent-50' : 'border-ink-200 bg-white shadow-sm hover:border-ink-300'}`}
                  >
                    {ENGINE_ICONS[engine]}
                  </button>
                </Tip>
              </div>
              <Tip label="内置提示词库">
                <button
                  aria-haspopup="menu"
                  aria-expanded={popover === 'presets'}
                  aria-controls={menuId}
                  onKeyDown={event => openMenu(event, 'presets')}
                  onClick={() => setPopover(p => (p === 'presets' ? null : 'presets'))}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${popover === 'presets' ? 'bg-accent-100 text-accent-700' : 'text-ink-400 hover:bg-ink-100 hover:text-accent-700'}`}
                >
                  <Lightbulb className="h-4 w-4" />
                </button>
              </Tip>
              <Tip label="从画板选图作参考 (@)">
                <button
                  aria-haspopup="menu"
                  aria-expanded={popover === 'canvas'}
                  aria-controls={menuId}
                  onKeyDown={event => openMenu(event, 'canvas')}
                  onClick={() => setPopover(p => (p === 'canvas' ? null : 'canvas'))}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${popover === 'canvas' ? 'bg-accent-100 text-accent-700' : 'text-ink-400 hover:bg-ink-100 hover:text-accent-700'}`}
                >
                  <GalleryHorizontalEnd className="h-4 w-4" />
                </button>
              </Tip>
            </div>
            {/* 圆形发送键（Lovart 式） */}
            <Tip label={sendTip}>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
                  canSend
                    ? 'bg-accent-600 text-white shadow-md shadow-accent-600/25 hover:bg-accent-700 active:scale-90'
                    : 'cursor-not-allowed bg-ink-200 text-ink-400'
                }`}
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </Tip>
          </div>
        </div>
        <p className="text-center text-[10px] leading-relaxed text-ink-500">
          本次 {scope || isRefine ? 1 : MODE_META[mode].count} 张 · {creationPrice(engine, gptQuality) > 0
            ? `每次生成 ${creationPrice(engine, gptQuality)} 积分，素材分析单独计入` : '按每日创作额度使用'}
        </p>
        {!engineAvailable && !isRefine && (
          <p role="status" className="text-center text-xs text-amber-600">当前引擎暂未开放，请在模型选择中切换。</p>
        )}
      </div>
    </div>
  );
};

export default ChatPanel;
