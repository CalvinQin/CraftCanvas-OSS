import React, { useState, useRef, useEffect, useId } from 'react';
import { EngineId, ENGINES } from '../services/engine';
import { ChevronDown, Check } from 'lucide-react';
import Tip from './Tip';
import { useMenuNavigation } from '../services/useMenuNavigation';

const modelIcon = (src: string, name: string) => <img src={src} alt={name} width={18} height={18} className="h-[18px] w-[18px] shrink-0 object-contain" />;
export const ENGINE_ICONS: Record<EngineId, React.ReactNode> = {
  'gemini-flash': modelIcon('/models/gemini.svg', 'Google Gemini'),
  'gemini-pro': modelIcon('/models/gemini.svg', 'Google Gemini'),
  'gpt-image': modelIcon('/models/gpt-image-2.5-flare.png', 'GPT Image 2.5 Flare'),
  'gpt-image-sunburst': modelIcon('/models/gpt-image-2.5-sunburst.png', 'GPT Image 2.5 Sunburst'),
};

interface EngineSelectProps {
  engine: EngineId;
  setEngine: (e: EngineId) => void;
}

const EngineSelect: React.FC<EngineSelectProps> = ({ engine, setEngine }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useMenuNavigation(open, menuRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Tip label={ENGINES[engine].tagline}><button
        onClick={() => setOpen(o => !o)}
        aria-label={`渲染引擎：${ENGINES[engine].label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setOpen(true); } }}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-bold text-ink-700 shadow-sm transition-all hover:border-ink-300"
      >
        {ENGINE_ICONS[engine]}
        {ENGINES[engine].label}
        <span className={`h-1.5 w-1.5 rounded-full ${ENGINES[engine].available() ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <ChevronDown className={`h-3.5 w-3.5 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button></Tip>

      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label="渲染引擎" tabIndex={-1} className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-ink-200/80 bg-white p-1.5 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <p className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-widest text-ink-400">渲染引擎</p>
          {(Object.keys(ENGINES) as EngineId[]).map(id => {
            const meta = ENGINES[id];
            const ok = meta.available();
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={engine === id}
                disabled={!ok}
                onClick={() => { setEngine(id); setOpen(false); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${engine === id ? 'bg-accent-50/70' : 'hover:bg-ink-100'}`}
              >
                {ENGINE_ICONS[id]}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink-700">
                    {meta.label}
                    <span className={`rounded px-1 py-px text-[9px] font-black ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                      {ok ? '可用' : '暂未开放'}
                    </span>
                  </span>
                  <span className="block truncate text-[10px] text-ink-400">{meta.tagline}</span>
                </span>
                {engine === id && <Check className="h-4 w-4 shrink-0 text-accent-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EngineSelect;
