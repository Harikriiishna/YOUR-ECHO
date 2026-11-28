import { useEffect, useState } from 'react';

const NON_KEYBOARD_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
]);

export interface MobileKeyboardSnapshot {
  isKeyboardOpen: boolean;
  keyboardOverlapPx: number;
}

export function isTextEntryElement(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') {
    return !(el as HTMLTextAreaElement).disabled && !(el as HTMLTextAreaElement).readOnly;
  }
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    const type = (input.type || 'text').toLowerCase();
    return !NON_KEYBOARD_INPUT_TYPES.has(type);
  }
  return false;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight + 2
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export function scrollFocusedFieldIntoView(el: HTMLElement): void {
  if (typeof window === 'undefined' || !el.isConnected) return;
  const vv = window.visualViewport;
  const vvTop = vv?.offsetTop ?? 0;
  const vvHeight = vv?.height ?? window.innerHeight;

  const headerEl = document.querySelector('header[data-echo-header]');
  const headerRect = headerEl ? headerEl.getBoundingClientRect() : null;
  const headerBottom =
    headerRect && headerRect.height > 0 && headerRect.bottom > 0 && headerRect.bottom < 140
      ? headerRect.bottom
      : 0;

  const safeTop = Math.max(vvTop, headerBottom) + 12;
  const safeBottom = vvTop + vvHeight - 20;
  if (safeBottom <= safeTop + 24) return;

  const rect = el.getBoundingClientRect();
  if (rect.top >= safeTop && rect.bottom <= safeBottom) {
    return;
  }

  const scrollParent = findScrollableAncestor(el);
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const containerTop = Math.max(safeTop, parentRect.top + 8);
    const containerBottom = Math.min(safeBottom, parentRect.bottom - 8);
    if (containerBottom > containerTop + 20) {
      let innerDelta = 0;
      if (rect.height > containerBottom - containerTop) {
        innerDelta = rect.top - containerTop;
      } else if (rect.bottom > containerBottom) {
        innerDelta = rect.bottom - containerBottom + 12;
      } else if (rect.top < containerTop) {
        innerDelta = rect.top - containerTop - 8;
      }
      if (Math.abs(innerDelta) > 2) {
        scrollParent.scrollBy({ top: innerDelta, behavior: 'smooth' });
      }
      return;
    }
  }

  let delta = 0;
  if (rect.height > safeBottom - safeTop) {
    delta = rect.top - safeTop;
  } else if (rect.bottom > safeBottom) {
    delta = rect.bottom - safeBottom + 12;
  } else if (rect.top < safeTop) {
    delta = rect.top - safeTop - 8;
  }

  if (Math.abs(delta) > 2) {
    window.scrollBy({ top: delta, behavior: 'smooth' });
  }
}

let currentSnapshot: MobileKeyboardSnapshot = {
  isKeyboardOpen: false,
  keyboardOverlapPx: 0,
};
const listeners = new Set<(snap: MobileKeyboardSnapshot) => void>();
let activeSubscribers = 0;
let teardownManager: (() => void) | null = null;

function notifyListeners(next: MobileKeyboardSnapshot): void {
  if (
    next.isKeyboardOpen === currentSnapshot.isKeyboardOpen &&
    next.keyboardOverlapPx === currentSnapshot.keyboardOverlapPx
  ) {
    return;
  }
  currentSnapshot = next;
  for (const listener of listeners) {
    listener(next);
  }
}

function attachGlobalKeyboardManager(): () => void {
  let baselineHeight = window.visualViewport?.height || window.innerHeight;
  let lastWidth = window.innerWidth;
  let textFocused = isTextEntryElement(document.activeElement);
  let blurTimer: number | null = null;
  let scrollTimers: number[] = [];

  const clearScrollTimers = () => {
    for (const t of scrollTimers) window.clearTimeout(t);
    scrollTimers = [];
  };

  const scheduleEnsureVisible = () => {
    clearScrollTimers();
    for (const delay of [110, 320]) {
      const t = window.setTimeout(() => {
        const active = document.activeElement;
        if (isTextEntryElement(active)) {
          scrollFocusedFieldIntoView(active);
        }
      }, delay);
      scrollTimers.push(t);
    }
  };

  const syncState = () => {
    const vv = window.visualViewport;
    const currentWidth = window.innerWidth;
    const vvHeight = vv?.height ?? window.innerHeight;
    const vvOffsetTop = vv?.offsetTop ?? 0;

    if (Math.abs(currentWidth - lastWidth) > 60) {
      lastWidth = currentWidth;
      baselineHeight = Math.max(vvHeight, window.innerHeight);
    } else if (!textFocused && vvHeight > baselineHeight) {
      baselineHeight = vvHeight;
    }

    const rawShrink = Math.max(0, baselineHeight - vvHeight);
    const unadjustedOverlap = Math.max(0, Math.round(window.innerHeight - vvHeight - vvOffsetTop));
    const isCompactViewport = currentWidth < 1024;
    const viewportKeyboardOpen = rawShrink > 135 || unadjustedOverlap > 120;
    const isKeyboardOpen = viewportKeyboardOpen || (isCompactViewport && textFocused);

    document.documentElement.style.setProperty('--echo-keyboard-inset', `${unadjustedOverlap}px`);
    notifyListeners({ isKeyboardOpen, keyboardOverlapPx: unadjustedOverlap });
  };

  const onFocusIn = (e: FocusEvent) => {
    if (blurTimer) {
      window.clearTimeout(blurTimer);
      blurTimer = null;
    }
    const target = e.target instanceof Element ? e.target : document.activeElement;
    if (isTextEntryElement(target)) {
      textFocused = true;
      syncState();
      scheduleEnsureVisible();
    }
  };

  const onFocusOut = () => {
    if (blurTimer) window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      textFocused = isTextEntryElement(document.activeElement);
      syncState();
    }, 90);
  };

  const onViewportResize = () => {
    syncState();
    if (isTextEntryElement(document.activeElement)) {
      scheduleEnsureVisible();
    }
  };

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('resize', onViewportResize);
  window.visualViewport?.addEventListener('resize', onViewportResize);
  syncState();

  return () => {
    if (blurTimer) window.clearTimeout(blurTimer);
    clearScrollTimers();
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('resize', onViewportResize);
    window.visualViewport?.removeEventListener('resize', onViewportResize);
    document.documentElement.style.removeProperty('--echo-keyboard-inset');
  };
}

export function useMobileKeyboardState(): MobileKeyboardSnapshot {
  const [snapshot, setSnapshot] = useState<MobileKeyboardSnapshot>(currentSnapshot);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeSubscribers === 0 && !teardownManager) {
      teardownManager = attachGlobalKeyboardManager();
    }
    activeSubscribers += 1;
    listeners.add(setSnapshot);
    setSnapshot(currentSnapshot);

    return () => {
      listeners.delete(setSnapshot);
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      if (activeSubscribers === 0 && teardownManager) {
        teardownManager();
        teardownManager = null;
      }
    };
  }, []);

  return snapshot;
}
