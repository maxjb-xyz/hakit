/** Keyboard helpers shared by shell-level shortcuts. */

/** True while the user is typing, so single-key shortcuts don't hijack text fields. */
export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Fired on `window` to open the shortcuts sheet from elsewhere (e.g. the ⌘K palette). */
export const OPEN_SHORTCUTS = 'hakit:open-shortcuts';
