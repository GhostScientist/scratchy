import { useCallback, useEffect, useRef, useState } from 'react';

interface PictureInPictureApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export function useFloatingWindow(onError: (message: string) => void) {
  const api = (window as Window & { documentPictureInPicture?: PictureInPictureApi }).documentPictureInPicture;
  const [floatingWindow, setFloatingWindow] = useState<Window | null>(null);
  const windowRef = useRef<Window | null>(null);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const close = useCallback(() => {
    generationRef.current += 1;
    windowRef.current?.close();
    windowRef.current = null;
    setFloatingWindow(null);
  }, []);
  const open = useCallback(async () => {
    if (!api || pendingRef.current) return;
    if (windowRef.current) { windowRef.current.focus(); return; }
    const generation = generationRef.current;
    pendingRef.current = true;
    try {
      const next = await api.requestWindow({ width: 380, height: 300 });
      if (generation !== generationRef.current) { next.close(); return; }
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) =>
        next.document.head.appendChild(node.cloneNode(true)));
      next.document.title = 'Screen recording controls';
      windowRef.current = next;
      setFloatingWindow(next);
      next.addEventListener('pagehide', () => {
        if (windowRef.current !== next) return;
        windowRef.current = null;
        setFloatingWindow(null);
      }, { once: true });
    } catch (error) {
      onError(`Could not open floating controls: ${error instanceof Error ? error.message : String(error)}.`);
    } finally {
      pendingRef.current = false;
    }
  }, [api, onError]);
  useEffect(() => () => {
    generationRef.current += 1;
    windowRef.current?.close();
  }, []);
  return { supported: !!api, floatingWindow, windowRef, open, close };
}
