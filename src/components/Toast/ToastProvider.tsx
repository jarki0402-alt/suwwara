import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import styles from './Toast.module.css';

export type ToastType = 'info' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
  /** Playing its exit animation; removed once that has run. */
  leaving: boolean;
}

interface ShowToastOptions {
  type?: ToastType;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;
// One with a button waits longer: it asks for something, and the button needs reading first.
const ACTION_DURATION_MS = 7000;
// Two at most, like the Mac's own banners: a third pushes the oldest out instead of building a tower over the page.
const MAX_VISIBLE = 2;
// Matches the exit animation in Toast.module.css.
const EXIT_MS = 240;
// Dragged this far towards its exit edge, it's thrown away.
const SWIPE_DISMISS_PX = 56;

/**
 * Notifications for things that just happened (a link copied, a Jam joined, a download done). They come in at the top:
 * from the right on a desktop, like a Mac's notification banners, and dropping from the top on a phone, like an
 * iPhone's, where the bottom is the player's and the connection strip's (ConnectionBanner). The same message already
 * showing is not shown twice; it just stays up longer. `pinned` sits above them and stays until dealt with (the
 * update notice), so it can never be shown twice either.
 */
export function ToastProvider({ children, pinned }: { children: ReactNode; pinned?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const remove = useCallback((id: number) => {
    timersRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const pending = timersRef.current.get(id);
      if (pending) clearTimeout(pending);
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
      timersRef.current.set(
        id,
        setTimeout(() => remove(id), EXIT_MS),
      );
    },
    [remove],
  );

  const showToast = useCallback(
    (message: string, options: ShowToastOptions = {}) => {
      const type = options.type ?? 'info';
      const duration = options.durationMs ?? (options.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS);
      setToasts((current) => {
        const same = current.find((toast) => !toast.leaving && toast.message === message && toast.type === type);
        const id = same?.id ?? nextIdRef.current++;
        const pending = timersRef.current.get(id);
        if (pending) clearTimeout(pending);
        timersRef.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
        if (same) return current;
        const next = [...current, { id, message, type, action: options.action, leaving: false }];
        const visible = next.filter((toast) => !toast.leaving);
        if (visible.length <= MAX_VISIBLE) return next;
        const oldest = visible[0]!.id;
        const oldTimer = timersRef.current.get(oldest);
        if (oldTimer) clearTimeout(oldTimer);
        timersRef.current.set(
          oldest,
          setTimeout(() => remove(oldest), EXIT_MS),
        );
        return next.map((toast) => (toast.id === oldest ? { ...toast, leaving: true } : toast));
      });
    },
    [dismiss, remove],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.container} aria-live="polite">
        {pinned}
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** One notification: swiped towards where it came from (right on a desktop, up on a phone) to throw it away. */
function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const horizontal = () => window.matchMedia('(min-width: 960px)').matches;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // Only towards the exit edge; the other way it barely gives.
    setOffset(horizontal() ? Math.max(0, event.clientX - drag.current.x) : Math.min(0, event.clientY - drag.current.y));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (Math.abs(offset) >= SWIPE_DISMISS_PX) onDismiss();
    else setOffset(0);
  };

  return (
    <div
      className={[styles.toast, toast.type === 'error' ? styles.toastError : '', toast.leaving ? styles.leaving : ''].join(' ')}
      style={offset !== 0 && !toast.leaving ? { transform: horizontal() ? `translateX(${offset}px)` : `translateY(${offset}px)`, transition: 'none' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider.');
  return context;
}
