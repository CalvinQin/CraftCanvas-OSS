import { useEffect, useRef, type RefObject } from 'react';

// One keyboard model for the product's custom action and option menus.
export function useMenuNavigation(open: boolean | string | null, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const menu = ref.current;
    if (!open || !menu) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(item => item.getClientRects().length > 0 && item.getAttribute('aria-disabled') !== 'true');
    const choices = items();
    (choices.find(item => item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true') || choices[0] || menu).focus();
    const handle = (event: KeyboardEvent) => {
      const choices = items();
      const active = choices.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (active + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
        choices[index]?.focus(); choices[index]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current(); previous?.focus();
      } else if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); close.current();
        const backwards = event.shiftKey;
        requestAnimationFrame(() => {
          const controls = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
            .filter(item => item.getClientRects().length > 0 && item.tabIndex >= 0 && !item.closest('[inert]') && !menu.contains(item));
          const index = controls.indexOf(previous!);
          (controls[index + (backwards ? -1 : 1)] || previous)?.focus();
        });
      } else if (event.key === 'Enter' || event.key === ' ') {
        // Keep native button activation while isolating canvas shortcuts.
        event.stopPropagation();
      }
    };
    menu.addEventListener('keydown', handle);
    return () => {
      menu.removeEventListener('keydown', handle);
      if (previous?.isConnected && (menu.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
    };
  }, [open, ref]);
}
