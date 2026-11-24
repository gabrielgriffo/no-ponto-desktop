const BLOCKED_KEYS = new Set(['F3', 'F5', 'F7', 'BrowserRefresh']);
const BLOCKED_WITH_MODIFIER = new Set(['r', 'p', 'f', 'g', 'j', 'u']);

export function isBrowserShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): boolean {
  if (BLOCKED_KEYS.has(event.key)) return true;
  return (event.ctrlKey || event.metaKey) && BLOCKED_WITH_MODIFIER.has(event.key.toLowerCase());
}

export function allowsNativeContextMenu(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');
}

export function installAppBehavior(doc: Document): void {
  doc.addEventListener('contextmenu', event => {
    if (!allowsNativeContextMenu(event.target)) event.preventDefault();
  });

  doc.addEventListener(
    'keydown',
    event => {
      if (isBrowserShortcut(event)) event.preventDefault();
    },
    { capture: true }
  );
}
