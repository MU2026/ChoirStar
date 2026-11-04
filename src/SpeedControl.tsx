import { useEffect, useRef } from "react";

export function SpeedControl({
  speed,
  disabled,
  onChange,
}: {
  speed: number;
  disabled: boolean;
  onChange: (speed: number) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (!menu.contains(event.target as Node)) menu.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  return (
    <details className="top-speed" ref={ref}>
      <summary
        title="Playback speed"
        aria-label={`Playback speed: ${Math.round(speed * 100)}%`}
      >
        {Math.round(speed * 100)}% <span aria-hidden="true">▾</span>
      </summary>
      <div className="speed-popup">
        <span>200%</span>
        <input
          aria-label="Playback speed"
          aria-valuetext={`${Math.round(speed * 100)} percent`}
          disabled={disabled}
          type="range"
          min="25"
          max="200"
          step="5"
          value={Math.round(speed * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
        />
        <span>25%</span>
        <button disabled={disabled} onClick={() => onChange(1)}>
          100%
        </button>
        {disabled && <small>Stop to adjust</small>}
      </div>
    </details>
  );
}
