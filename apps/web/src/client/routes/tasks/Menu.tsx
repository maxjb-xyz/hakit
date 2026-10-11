/**
 * S10 inline-edit popover: a button that opens a single-select listbox (status, assignee, priority, filters).
 * Shown as a manual popover (top layer, viewport-fixed) so board columns, list rows and the quick-create
 * dialog never clip or cover it.
 * Keyboard: Enter/Space/↓ opens, ↑/↓/Home/End move, typing jumps to a match, Enter picks, Esc/Tab close.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@hakit/ui';

export type MenuOption<V extends string> = {
  value: V;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
};

export function Menu<V extends string>(props: {
  /** Accessible name of the trigger, e.g. "Status for HK-3". */
  label: string;
  value: V | null;
  options: MenuOption<V>[];
  onChange: (v: V) => void;
  /** Trigger contents; defaults to the selected option's icon + label. */
  children?: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  title?: string;
  /** Multi-value filters show a check per selected option. */
  selected?: (v: V) => boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();
  const isSelected = props.selected ?? ((v: V) => v === props.value);
  const current = props.options.find((o) => o.value === props.value);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 280 > window.innerHeight && r.top > 280;
    setPos({
      top: up ? r.top - 4 : r.bottom + 4,
      ...(props.align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }),
      up,
    });
  }, [props.align]);

  const openMenu = () => {
    if (props.disabled) return;
    place();
    const i = props.options.findIndex((o) => isSelected(o.value));
    setActive(Math.max(0, i));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };

  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    try {
      el.showPopover();
    } catch {
      /* popover unsupported: it still renders fixed */
    }
    el.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const pick = (v: V) => {
    props.onChange(v);
    if (!props.selected) close();
  };

  const onListKey = (e: KeyboardEvent) => {
    const n = props.options.length;
    // Keep keys inside the menu: board/list shortcuts (j/k/m/c) must not fire while it is open.
    e.stopPropagation();
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const o = props.options[active];
      if (o) pick(o.value);
    } else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = e.timeStamp;
      typed.current = {
        text: (now - typed.current.at < 600 ? typed.current.text : '') + e.key.toLowerCase(),
        at: now,
      };
      const i = props.options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${props.label}: ${current?.label ?? 'none'}`}
        title={props.title ?? props.label}
        disabled={props.disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            openMenu();
          }
        }}
        className={cn(
          'interactive press inline-flex h-control-sm min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-label text-default',
          open && 'bg-hover text-strong',
          props.className,
        )}
      >
        {props.children ?? (
          <>
            {current?.icon}
            <span className="truncate">{current?.label ?? 'None'}</span>
          </>
        )}
      </button>
      {open && pos && (
        <ul
          ref={list}
          popover="manual"
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={props.label}
          aria-multiselectable={props.selected ? true : undefined}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={onListKey}
          style={{
            inset: 'auto',
            margin: 0,
            top: pos.top,
            left: pos.left,
            right: pos.right,
            transform: pos.up ? 'translateY(-100%)' : undefined,
          }}
          className={cn(
            'animate-pop-in fixed z-50 max-h-72 min-w-44 overflow-auto rounded-md border border-border-strong bg-raised p-1 shadow-e3 outline-none',
            pos.up && 'origin-bottom',
          )}
        >
          {props.options.map((o, i) => {
            const sel = isSelected(o.value);
            return (
              <li
                key={o.value}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={sel}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={cn(
                  'flex h-control-md cursor-pointer items-center gap-2 rounded-sm px-2 text-body text-default',
                  i === active && 'bg-hover text-strong',
                )}
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-label text-subtle">{o.hint}</span>}
                <span aria-hidden className={cn('w-3 text-label text-accent-400', !sel && 'invisible')}>
                  ✓
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
