import { useEffect } from 'react';

export function ScreenPreview({ stream, videoRef, onReady, onError }: {
  stream: MediaStream;
  videoRef: { current: HTMLVideoElement | null };
  onReady(ready: boolean): void;
  onError(message: string): void;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    onReady(false);
    video.srcObject = stream;
    void video.play().catch((error: unknown) => {
      onError(`Could not preview the shared screen: ${error instanceof Error ? error.message : String(error)}.`);
    });
    return () => {
      video.srcObject = null;
      onReady(false);
    };
  }, [stream, videoRef, onReady, onError]);

  return <video ref={(el) => { videoRef.current = el; }} className="screen-preview"
    autoPlay playsInline muted onLoadedData={() => onReady(true)} aria-label="Shared screen preview" />;
}
