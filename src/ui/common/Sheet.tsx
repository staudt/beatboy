import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  /** 'sheet' slides from the bottom on phones; both are centered modals on desktop. */
  className?: string;
}

/** Modal dialog / bottom sheet. Render it only while open. */
export function Sheet({ title, onClose, children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect: the Escape listener and focus are in place as soon as the dialog is visible.
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = el?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select');
    (focusable ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class={`sheet ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div class="sheet-grip" aria-hidden="true" />
        <div class="sheet-head">
          <h2 class="sheet-title">{title}</h2>
          <button type="button" class="btn btn-ghost" aria-label="Close" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
