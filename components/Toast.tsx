import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  desc?: string;
}

interface VisibleToast extends ToastItem {
  exiting?: boolean;
}

type Listener = (t: ToastItem) => void;
let listener: Listener | null = null;
let seq = 0;

const push = (kind: ToastKind, title: string, desc?: string) => {
  listener?.({ id: ++seq, kind, title, desc });
};

// 全局 toast 入口：任意模块 import { toast } 直接调用
export const toast = {
  success: (title: string, desc?: string) => push('success', title, desc),
  error: (title: string, desc?: string) => push('error', title, desc),
  info: (title: string, desc?: string) => push('info', title, desc),
};

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 aria-hidden="true" className="h-4.5 w-4.5 text-emerald-600" />,
  error: <XCircle aria-hidden="true" className="h-4.5 w-4.5 text-red-500" />,
  info: <Info aria-hidden="true" className="h-4.5 w-4.5 text-accent-600" />,
};

const EXIT_DURATION = 180;
const MAX_VISIBLE_TOASTS = 5;
const TONES: Record<ToastKind, { badge: string; progress: string }> = {
  success: { badge: 'bg-emerald-50', progress: 'bg-emerald-400' },
  error: { badge: 'bg-red-50', progress: 'bg-red-400' },
  info: { badge: 'bg-accent-50', progress: 'bg-accent-400' },
};

interface ToastCardProps {
  item: VisibleToast;
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
  onHeight: (id: number, height: number) => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ item, onDismiss, onRemove, onHeight }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'entering' | 'visible'>('entering');
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const ttl = item.kind === 'error' ? 6500 : 3500;
  const clock = useRef({ remaining: ttl, startedAt: 0 });
  const [progress, setProgress] = useState(1);
  const [countdownDuration, setCountdownDuration] = useState(0);
  const paused = pointerPaused || focusPaused;

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => onHeight(item.id, card.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [item.id, onHeight]);

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPhase('visible'));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (item.exiting || phase !== 'visible') return;
    if (paused) {
      setCountdownDuration(0);
      setProgress(clock.current.remaining / ttl);
      return;
    }

    const timerClock = clock.current;
    timerClock.startedAt = performance.now();
    setCountdownDuration(timerClock.remaining);
    const frame = requestAnimationFrame(() => setProgress(0));
    const timer = window.setTimeout(() => onDismiss(item.id), timerClock.remaining);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      timerClock.remaining = Math.max(0, timerClock.remaining - (performance.now() - timerClock.startedAt));
    };
  }, [item.id, item.exiting, phase, paused, ttl, onDismiss]);

  useEffect(() => {
    if (!item.exiting) return;
    const timer = window.setTimeout(() => onRemove(item.id), EXIT_DURATION);
    return () => clearTimeout(timer);
  }, [item.id, item.exiting, onRemove]);

  return (
    <div
      ref={cardRef}
      className="cc-toast pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border border-ink-200/70 bg-white/95 p-3.5 shadow-xl shadow-ink-900/10 backdrop-blur-xl"
      data-state={item.exiting ? 'exiting' : phase}
      data-paused={paused || undefined}
      role={item.kind === 'error' ? 'alert' : 'status'}
      aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onPointerEnter={() => setPointerPaused(true)}
      onPointerLeave={() => setPointerPaused(false)}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusPaused(false);
      }}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${TONES[item.kind].badge}`}>
        {ICONS[item.kind]}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="break-words text-[13px] font-bold leading-tight text-ink-900">{item.title}</p>
        {item.desc && <p className="mt-1 break-words text-xs leading-relaxed text-ink-500">{item.desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        disabled={item.exiting}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
        aria-label={`关闭通知：${item.title}`}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-ink-100/70">
        <div
          className={`cc-toast-progress h-full origin-left ${TONES[item.kind].progress}`}
          style={{ transform: `scaleX(${progress})`, transitionProperty: 'transform', transitionDuration: `${countdownDuration}ms`, transitionTimingFunction: 'linear' }}
        />
      </div>
    </div>
  );
};

export const Toaster: React.FC = () => {
  const [items, setItems] = useState<VisibleToast[]>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, exiting: true } : item));
  }, []);

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
    setHeights(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const measureHeight = useCallback((id: number, height: number) => {
    setHeights(prev => prev[id] === height ? prev : { ...prev, [id]: height });
  }, []);

  useEffect(() => {
    const handleToast: Listener = item => {
      setItems(prev => {
        const visible = prev.filter(existing => !existing.exiting);
        const oldestId = visible.length >= MAX_VISIBLE_TOASTS ? visible[0].id : undefined;
        return [...prev.map(existing => existing.id === oldestId ? { ...existing, exiting: true } : existing), item];
      });
    };
    listener = handleToast;
    return () => { if (listener === handleToast) listener = null; };
  }, []);

  let offset = 0;
  const stack = [...items].reverse().map(item => {
    const top = offset;
    offset += (heights[item.id] ?? 64) + 8;
    return { item, top };
  });

  return (
    <div role="region" aria-label="通知" className="pointer-events-none fixed inset-x-0 top-5 z-[300] flex justify-center">
      <div className="relative w-[calc(100%-2rem)] max-w-md" style={{ height: Math.max(0, offset - 8) }}>
        {stack.map(({ item, top }, index) => (
          <div
            key={item.id}
            className="cc-toast-stack-item absolute inset-x-0 top-0"
            style={{ transform: `translateY(${top}px)`, zIndex: stack.length - index }}
          >
            <ToastCard item={item} onDismiss={dismiss} onRemove={remove} onHeight={measureHeight} />
          </div>
        ))}
      </div>
    </div>
  );
};
