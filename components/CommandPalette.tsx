import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { useDialogFocus } from '../services/useDialogFocus';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

// 最近使用命令（localStorage，最多 5 条）
const RECENT_KEY = 'craftcanvas_recent_commands';
const loadRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
};
const saveRecent = (id: string) => {
  try {
    const next = [id, ...loadRecent().filter(x => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* 隐私模式等存储不可用时静默 */ }
};

// ⌘K 命令面板（§33）：搜索 + 键盘上下 + 回车执行 + 最近使用
const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDialogFocus(true, dialogRef);
  const recentIds = useMemo(() => loadRecent(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // 无搜索词：最近使用置顶，其余保持原序
      if (!recentIds.length) return commands;
      const recent = recentIds.map(id => commands.find(c => c.id === id)).filter((c): c is Command => Boolean(c));
      return [...recent, ...commands.filter(c => !recentIds.includes(c.id))];
    }
    return commands.filter(c =>
      c.title.toLowerCase().includes(q) || (c.keywords ?? '').toLowerCase().includes(q));
  }, [commands, query, recentIds]);

  const recentCount = query.trim() ? 0 : recentIds.filter(id => commands.some(c => c.id === id)).length;

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelectorAll('button')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const exec = (c?: Command) => {
    if (!c) return;
    saveRecent(c.id);
    onClose();
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-[160] flex items-start justify-center bg-ink-900/30 p-6 pt-[12vh] backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          event.stopPropagation();
          if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) { event.preventDefault(); onClose(); }
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter(item => item.getClientRects().length > 0);
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-2xl animate-in zoom-in-95 slide-in-from-top-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            aria-label="搜索命令"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, filtered.length - 1))); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); exec(filtered[active]); }
            }}
            placeholder="搜索命令：导出 / 图层 / 缩放 / 引擎…"
            className="w-full bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-300"
          />
          <kbd className="shrink-0 rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-400">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label="命令列表" className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-ink-400">没有匹配的命令</p>
          )}
          {filtered.map((c, i) => (
            <React.Fragment key={c.id}>
              {recentCount > 0 && i === 0 && (
                <p className="px-3 pb-1 pt-1.5 text-[9.5px] font-black uppercase tracking-wider text-ink-300">最近使用</p>
              )}
              {recentCount > 0 && i === recentCount && (
                <p className="px-3 pb-1 pt-2 text-[9.5px] font-black uppercase tracking-wider text-ink-300">全部命令</p>
              )}
              <button
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => exec(c)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === active ? 'bg-accent-50/80' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-ink-800">{c.title}</span>
                  {c.hint && <span className="block truncate text-[10px] text-ink-400">{c.hint}</span>}
                </span>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent-600" />}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
