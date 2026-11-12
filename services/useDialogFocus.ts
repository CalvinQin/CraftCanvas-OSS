import { useEffect, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
let originalOverflow = '';

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const originalTabIndex = dialog.getAttribute('tabindex');
    if (originalTabIndex === null) dialog.setAttribute('tabindex', '-1');
    if (dialogs.length === 0) originalOverflow = document.body.style.overflow;
    dialogs.push(dialog);
    document.body.style.overflow = 'hidden';
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]')]
      .filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'));
    const focusFirst = () => (focusables()[0] || dialog).focus();
    focusFirst();
    const handle = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || dialogs[dialogs.length - 1] !== dialog) return;
      const elements = focusables(); const first = elements[0]; const last = elements[elements.length - 1];
      if (!first) { e.preventDefault(); dialog.focus(); return; }
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (dialogs[dialogs.length - 1] === dialog && !dialog.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener('keydown', handle, true);
    document.addEventListener('focusin', keepFocus);
    return () => {
      const wasTop = dialogs[dialogs.length - 1] === dialog;
      const index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      if (dialogs.length === 0) document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handle, true);
      document.removeEventListener('focusin', keepFocus);
      if (originalTabIndex === null) dialog.removeAttribute('tabindex');
      if (wasTop && previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
