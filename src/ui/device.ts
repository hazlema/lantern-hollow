// Phone & tablet support: touch detection, fullscreen, and "installed to the home screen".

/** A finger is the main pointer (phones, tablets). */
export const isTouch = matchMedia('(pointer: coarse)').matches;

/** iPhone/iPad Safari: no fullscreen API for pages on iPhone, so we point people at Add to Home Screen. */
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const doc = document as FsDoc;

/** Launched from the home screen (already fullscreen, nothing to toggle). */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const canFullscreen = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      if (doc.exitFullscreen) await doc.exitFullscreen(); else doc.webkitExitFullscreen?.();
      return;
    }
    const el = document.documentElement as FsEl;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen?.();
    // phones: stay sideways once we own the whole screen (Android only; harmless elsewhere)
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape').catch(() => {});
  } catch {
    // the browser said no (not from a tap, or not allowed): nothing to do
  }
}

export function onFullscreenChange(fn: () => void): void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
}
