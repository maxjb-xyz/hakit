/** `?` opens a sheet listing keyboard shortcuts. Native <dialog>: focus trap and Esc for free. */
import { useEffect, useRef } from 'react';
import { isTyping, OPEN_SHORTCUTS } from './keys';

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      ['?', 'Show this sheet'],
      ['⌘ K', 'Command palette'],
      ['Esc', 'Close the inspector or a dialog'],
    ],
  },
  {
    title: 'Mission Control',
    keys: [
      ['j / k', 'Next / previous suggestion'],
      ['a', 'Accept suggestion'],
      ['m', 'Modify (pick someone else)'],
      ['d', 'Dismiss with a reason'],
    ],
  },
  {
    title: 'Tasks',
    keys: [
      ['c', 'New task'],
      ['j / k', 'Next / previous card in a column'],
      ['m then ← / →', 'Move the open card between columns'],
      ['Enter', 'Finish moving'],
      ['Esc', 'Cancel move or close the task panel'],
    ],
  },
];

export function Shortcuts() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const show = () => {
      const d = ref.current;
      if (d && !d.open) d.showModal();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      show();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SHORTCUTS, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SHORTCUTS, show);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-h"
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto w-full max-w-md rounded-md border border-border-strong bg-surface p-0 text-default backdrop:bg-sunken/70"
    >
      <div className="flex items-center border-b border-hover px-5 py-3">
        <h2 id="shortcuts-h" className="text-body-lg font-medium text-strong">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="ml-auto rounded-xs px-1 text-label text-subtle hover:text-strong"
        >
          Close
        </button>
      </div>
      <div className="space-y-5 px-5 py-4">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-label text-subtle">{g.title}</h3>
            <dl className="space-y-1">
              {g.keys.map(([k, what]) => (
                <div key={k} className="flex items-center justify-between gap-4 text-body">
                  <dt className="text-default">{what}</dt>
                  <dd>
                    <kbd className="rounded-xs border border-border-strong px-1.5 text-label text-muted">
                      {k}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
