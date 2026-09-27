import { useCallback, useRef, type PointerEvent } from 'react';

/**
 * Apple-style "liquid glass" tap feedback: a soft blob blooms from the exact touch/click point
 * and fades, instead of a flat :active highlight. Spawns a plain DOM node imperatively (see
 * global.css's .bubble-ripple) rather than React state, so mashing a button (e.g. holding
 * next-track) never causes a re-render per tap — the node removes itself on animationend.
 * Host element needs the `glass-ripple-host` class (position:relative + overflow:hidden) for
 * the blob to clip correctly.
 */
export function useBubbleRipple<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  const onPointerDown = useCallback((event: PointerEvent<T>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const host = ref.current;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const bubble = document.createElement('span');
    bubble.className = 'bubble-ripple';
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${event.clientX - rect.left - size / 2}px`;
    bubble.style.top = `${event.clientY - rect.top - size / 2}px`;
    bubble.addEventListener('animationend', () => bubble.remove());
    host.appendChild(bubble);
  }, []);

  return { ref, onPointerDown };
}
