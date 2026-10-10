/**
 * ⌘K command palette (DESIGN §6 "Global", §7). Native modal <dialog> gives the focus trap, inert
 * background and Esc; inside it an ARIA 1.2 combobox (input) drives a listbox via
 * `aria-activedescendant`, so focus never leaves the input while ↑/↓/Home/End move the selection.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { filterCommands } from './command-filter';

export type CommandItem = {
  id: string;
  label: string;
  /** Section heading; items are shown in the order their group first appears. */
  group: string;
  /** Extra words that match but aren't shown (e.g. "board kanban"). */
  keywords?: string;
  /** Right-aligned meta: a shortcut, status or assignee. */
  hint?: ReactNode;
  icon?: ReactNode;
  perform: () => void;
};

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  /** Max items per group while the query is empty, so long task lists don't bury navigation. */
  idleLimit?: number;
  placeholder?: string;
  /** Shown under the list while some sources are still loading or failed (items still work). */
  status?: { tone: 'loading' | 'error'; text: string } | null;
  label?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  idleLimit = 6,
  placeholder = 'Type a command or search…',
  status,
  label = 'Command palette',
}: CommandPaletteProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnTo = useRef<Element | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const uid = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement;
      setQuery('');
      setActive(0);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const results = useMemo(() => {
    const ranked = filterCommands(items, query);
    const order = [...new Set(ranked.map((i) => i.group))];
    // With a query the best match leads; groups follow the order of their best item.
    if (query.trim())
      order.sort((a, b) => ranked.findIndex((i) => i.group === a) - ranked.findIndex((i) => i.group === b));
    else order.sort((a, b) => items.findIndex((i) => i.group === a) - items.findIndex((i) => i.group === b));
    return order.map((group) => {
      const inGroup = ranked.filter((i) => i.group === group);
      return { group, items: query.trim() ? inGroup : inGroup.slice(0, idleLimit) };
    });
  }, [items, query, idleLimit]);
  const flat = results.flatMap((g) => g.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (i: number) => `${uid}-opt-${i}`;

  useEffect(() => {
    listRef.current
      ?.querySelector(`[id="${CSS.escape(optionId(current))}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  const run = (item: CommandItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    item.perform();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = flat.length - 1;
    const move: Record<string, number | undefined> = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: e.ctrlKey ? 0 : undefined,
      End: e.ctrlKey ? last : undefined,
      PageDown: Math.min(last, current + 5),
      PageUp: Math.max(0, current - 5),
    };
    if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[current]);
    } else if (move[e.key] !== undefined && flat.length) {
      e.preventDefault();
      setActive(move[e.key]!);
    }
  };

  let index = -1;
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => {
        onOpenChange(false);
        if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
      }}
      onClick={(e) => e.target === e.currentTarget && onOpenChange(false)}
      className="mx-auto mt-(--spacing-palette-offset) w-full max-w-xl rounded-md border border-border-strong bg-raised p-0 text-default shadow-(--shadow-e3) backdrop:bg-sunken/70 max-sm:mt-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
    >
      <div className="flex items-center gap-2 border-b border-hover px-4">
        <span aria-hidden className="text-subtle">
          ⌘
        </span>
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
          aria-label={label}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-control-xl min-w-0 flex-1 bg-transparent text-body-lg text-strong outline-none placeholder:text-subtle"
        />
        <kbd className="rounded-xs border border-border-strong px-1.5 text-caption text-subtle">Esc</kbd>
      </div>

      <ul
        ref={listRef}
        id={`${uid}-list`}
        role="listbox"
        aria-label="Results"
        className="max-h-[min(60vh,var(--spacing-palette))] overflow-y-auto p-1.5 max-sm:max-h-none"
      >
        {results.map((g) => (
          <li key={g.group} role="presentation">
            <p
              id={`${uid}-${g.group}`}
              className="px-2.5 pt-2 pb-1 text-caption uppercase tracking-wide text-subtle"
            >
              {g.group}
            </p>
            <ul role="group" aria-labelledby={`${uid}-${g.group}`}>
              {g.items.map((item) => {
                const i = ++index;
                const selected = i === current;
                return (
                  <li
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex h-control-lg cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-body text-default',
                      selected && 'bg-hover text-strong',
                    )}
                  >
                    {item.icon && <span className="text-subtle">{item.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-label text-subtle">{item.hint}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {flat.length === 0 && (
        <p className="px-4 pb-4 text-body text-subtle">No commands match “{query.trim()}”.</p>
      )}
      <p
        role="status"
        className={cn(
          'border-t border-hover px-4 py-2 text-label',
          status?.tone === 'error' ? 'text-danger' : 'text-subtle',
        )}
      >
        {status?.text ?? `${flat.length} result${flat.length === 1 ? '' : 's'} · ↑↓ to move · Enter to run`}
      </p>
    </dialog>
  );
}
