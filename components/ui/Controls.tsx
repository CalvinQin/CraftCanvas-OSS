import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

type Option = { value: string; label: string };
export function Select({ value, onChange, options, label, disabled, className = '' }: { value: string; onChange: (value: string) => void; options: Option[]; label: string; disabled?: boolean; className?: string }) {
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null); const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const [position, setPosition] = useState({ left: 0, top: 0, width: 0, height: 280 });
  const selected = Math.max(0, options.findIndex(o => o.value === value));
  const locate = () => { const rect = trigger.current?.getBoundingClientRect(); if (!rect) return; const height = Math.min(280, options.length * 40 + 16); const below = window.innerHeight - rect.bottom - 12; const above = rect.top - 12; const up = below < height && above > below; const maxHeight = Math.min(height, Math.max(80, up ? above : below)); const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24); setPosition({ left: Math.min(rect.left, window.innerWidth - width - 12), top: up ? rect.top - maxHeight - 6 : rect.bottom + 6, width, height: maxHeight }); };
  const choose = (index: number) => { onChange(options[index].value); setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return; locate();
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !popup.current?.contains(e.target as Node)) setOpen(false); };
    const scroll = (e: Event) => { if (!popup.current?.contains(e.target as Node)) locate(); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', locate); document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', locate); document.removeEventListener('scroll', scroll, true); };
  }, [open, options.length]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) popup.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      if (!open) { setActive(selected); setOpen(true); return; }
      if (e.key === 'Enter' || e.key === ' ') choose(active);
      else setActive(e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key.length === 1) {
      const match = options.findIndex(o => o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (match >= 0) { setOpen(true); setActive(match); }
    }
  };
  return <div className={`ui-select ${className}`}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled} className="ui-select-trigger" onKeyDown={key} onClick={() => { setActive(selected); setOpen(!open); }}><span>{options[selected]?.label || '请选择'}</span><ChevronDown size={16} className={open ? 'rotate-180' : ''} /></button>
    {open && createPortal(<div ref={popup} id={`${id}-list`} role="listbox" aria-label={label} className="ui-select-menu" style={{ position: 'fixed', left: Math.max(12, position.left), top: position.top, width: position.width, maxHeight: position.height }}>{options.map((o, index) => <div key={o.value} id={`${id}-${index}`} role="option" aria-selected={o.value === value} data-active={index === active} className="ui-select-option" onMouseEnter={() => setActive(index)} onMouseDown={e => e.preventDefault()} onClick={() => choose(index)}><span>{o.label}</span>{o.value === value && <Check size={15} />}</div>)}</div>, trigger.current?.closest('[role="dialog"]') || document.body)}
  </div>;
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="ui-switch"><span className="ui-switch-track"><span /></span><span>{label}</span></button>;
}
export function SearchField({ value, onChange, label, placeholder, className = '' }: { value: string; onChange: (value: string) => void; label: string; placeholder: string; className?: string }) {
  return <div className={`ui-search ${className}`}><Search size={17} aria-hidden="true" /><input type="search" aria-label={label} maxLength={100} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />{value && <button type="button" className="ui-search-clear" aria-label="清除搜索" onClick={() => onChange('')}><X size={15} /></button>}</div>;
}

// Keep browser constraint semantics, but present errors within the product instead of native bubbles.
export function SiteForm({ children, onSubmit, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  const [error, setError] = useState(''); const errorId = useId();
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    for (const control of Array.from(event.currentTarget.elements) as HTMLInputElement[]) {
      if (!control.validity || control.disabled || control.validity.valid) continue;
      const name = control.getAttribute('aria-label') || control.labels?.[0]?.textContent?.trim() || '此项';
      const validity = control.validity;
      const message = validity.valueMissing ? `请填写${name}` : validity.typeMismatch ? `${name}格式不正确` : validity.tooShort ? `${name}至少需要 ${control.minLength} 个字符` : validity.patternMismatch ? `${name}不符合要求，请按下方提示填写` : validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch ? `${name}超出范围或精度要求` : `请检查${name}`;
      setError(message); control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', errorId); control.focus(); return;
    }
    onSubmit?.(event);
  };
  return <form {...props} noValidate onSubmit={submit} onInput={event => { setError(''); const target = event.target as HTMLElement; target.removeAttribute('aria-invalid'); if (target.getAttribute('aria-describedby') === errorId) target.removeAttribute('aria-describedby'); props.onInput?.(event); }}>{children}{error && <p id={errorId} role="alert" className="ui-form-error">{error}</p>}</form>;
}

export function NumberField({ value, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value)); const written = useRef(value);
  useEffect(() => { if (value !== written.current) { setDraft(String(value)); written.current = value; } }, [value]);
  return <input {...props} type="number" inputMode="decimal" value={draft} onChange={e => { const next = e.target.value; setDraft(next); const parsed = Number(next); if (next !== '' && Number.isFinite(parsed)) { written.current = parsed; onChange(parsed); } }} />;
}
