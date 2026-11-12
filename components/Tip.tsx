import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Product tooltips share pointer and keyboard behavior, including viewport edges.
const Tip: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className = '' }) => {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!hovering.current && !focused.current) { setOpen(false); setPos(null); }
    }, 100);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const locate = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;
      const below = anchor.top - tip.height - 8 < topEdge;
      setPos({
        left: Math.max(leftEdge, Math.min(anchor.left + (anchor.width - tip.width) / 2, rightEdge - tip.width)),
        top: Math.max(topEdge, Math.min(below ? anchor.bottom + 8 : anchor.top - tip.height - 8, bottomEdge - tip.height)),
      });
    };
    locate();
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setPos(null); } };
    window.addEventListener('resize', locate);
    document.addEventListener('scroll', locate, true);
    document.addEventListener('keydown', dismiss);
    window.visualViewport?.addEventListener('resize', locate);
    return () => {
      window.removeEventListener('resize', locate);
      document.removeEventListener('scroll', locate, true);
      document.removeEventListener('keydown', dismiss);
      window.visualViewport?.removeEventListener('resize', locate);
    };
  }, [open, label]);

  const content = React.isValidElement<React.HTMLAttributes<HTMLElement>>(children) && typeof children.type === 'string'
    ? React.cloneElement(children, {
      'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      ...(['button', 'a'].includes(children.type) && !children.props['aria-label'] && !children.props['aria-labelledby'] ? { 'aria-label': label } : {}),
    }) : children;

  return <span ref={anchorRef} className={`inline-flex ${className}`}
    onPointerEnter={() => { hovering.current = true; show(); }}
    onPointerLeave={() => { hovering.current = false; hide(); }}
    onFocusCapture={() => { focused.current = true; show(); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { focused.current = false; hide(); } }}>
    {content}
    {createPortal(<span ref={tipRef} id={id} role="tooltip" hidden={!open}
      onPointerEnter={() => { hovering.current = true; show(); }}
      onPointerLeave={() => { hovering.current = false; hide(); }}
      className="cc-tip fixed z-[300] rounded-lg bg-ink-900 px-3 py-2 text-[11px] font-medium leading-relaxed text-white shadow-lg"
      style={{ maxWidth: 'min(360px, calc(100vw - 16px))', overflowWrap: 'anywhere', left: pos?.left || 0, top: pos?.top || 0, visibility: open && pos ? 'visible' : 'hidden' }}>
      {label}
    </span>, document.body)}
  </span>;
};

export default Tip;
