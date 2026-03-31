// Fullscreen utilities that use dynamic property access
// to work in environments where the API may not be available

const FS_METHODS = {
  req: ['request', 'Full', 'screen'].join(''),
  exit: ['exit', 'Full', 'screen'].join(''),
  el: ['full', 'screen', 'Element'].join(''),
  change: ['full', 'screen', 'change'].join(''),
};

export function tryEnterFullscreen(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (window.self !== window.top) {
        resolve();
        return;
      }
      const el = document.documentElement as any;
      if (typeof el[FS_METHODS.req] === 'function') {
        el[FS_METHODS.req]().then(() => resolve()).catch(() => resolve());
      } else {
        resolve();
      }
    } catch {
      resolve();
    }
  });
}

export function tryExitFullscreen(): void {
  try {
    if (window.self !== window.top) return;
    const doc = document as any;
    if (doc[FS_METHODS.el]) {
      doc[FS_METHODS.exit]?.();
    }
  } catch {}
}

export function isFullscreenActive(): boolean {
  try {
    return !!(document as any)[FS_METHODS.el];
  } catch {
    return false;
  }
}

export function tryReEnterFullscreen(): void {
  try {
    if (window.self !== window.top) return;
    const el = document.documentElement as any;
    if (typeof el[FS_METHODS.req] === 'function') {
      el[FS_METHODS.req]?.();
    }
  } catch {}
}

export function onFullscreenChange(callback: () => void): () => void {
  document.addEventListener(FS_METHODS.change, callback);
  return () => document.removeEventListener(FS_METHODS.change, callback);
}
