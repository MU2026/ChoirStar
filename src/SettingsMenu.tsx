import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// Arrow navigation stays within the current menu, including embedded sliders.
export function navigateMenu(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.matches("input")) return;
  const menu = target.closest('[role="menu"]');
  if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
    return;
  const items = Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role^="menuitem"], input:not(:disabled)',
    ),
  ).filter(
    (item) =>
      item.closest('[role="menu"]') === menu && !item.matches(":disabled"),
  );
  const current = items.indexOf(target);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  event.preventDefault();
  event.stopPropagation();
  items[index]?.focus();
}

export function MenuItem({
  children,
  checked,
  radio,
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className="menu-item"
      role={
        checked === undefined
          ? "menuitem"
          : radio
            ? "menuitemradio"
            : "menuitemcheckbox"
      }
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      <span className="menu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span>{children}</span>
    </button>
  );
}

export function MenuBranch({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const branch = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !popup.current || !branch.current) return;
    const row = branch.current.getBoundingClientRect();
    const panel = popup.current.getBoundingClientRect();
    setPosition({
      left:
        Math.max(
          8,
          Math.min(
            row.right + panel.width <= window.innerWidth - 8
              ? row.right
              : row.left - panel.width,
            window.innerWidth - panel.width - 8,
          ),
        ) - row.left,
      top:
        Math.max(8, Math.min(row.top, window.innerHeight - panel.height - 8)) -
        row.top,
    });
    if (keyboardOpen.current) {
      popup.current
        .querySelector<HTMLElement>(
          '[role^="menuitem"]:not(:disabled), input:not(:disabled)',
        )
        ?.focus();
      keyboardOpen.current = false;
    }
  }, [open]);
  return (
    <div
      className="menu-branch"
      ref={branch}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" && event.target === trigger.current) {
          event.preventDefault();
          event.stopPropagation();
          keyboardOpen.current = true;
          setOpen(true);
          if (open)
            popup.current
              ?.querySelector<HTMLElement>(
                '[role^="menuitem"], input:not(:disabled)',
              )
              ?.focus();
        } else if (
          (event.key === "ArrowLeft" || event.key === "Escape") &&
          open
        ) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          keyboardOpen.current = event.detail === 0;
          setOpen(event.detail === 0 ? !open : true);
        }}
      >
        <span className="menu-check" aria-hidden="true" />
        <span>{label}</span>
        <span className="menu-arrow" aria-hidden="true">
          {typeof position.left === "number" && position.left < 0 ? "‹" : "›"}
        </span>
      </button>
      {open && (
        <div
          ref={popup}
          id={id}
          role="menu"
          aria-label={label}
          className="menu-flyout"
          style={position}
          onKeyDown={navigateMenu}
        >
          {children}
        </div>
      )}
    </div>
  );
}
