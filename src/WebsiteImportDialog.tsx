import { useEffect, useRef, useState, type ComponentProps } from "react";
import { WebsiteLibrary } from "./WebsiteLibrary";

export function WebsiteImportDialog({
  onClose,
  ...props
}: Omit<ComponentProps<typeof WebsiteLibrary>, "onBusyChange"> & {
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="website-dialog"
      ref={dialog}
      aria-labelledby="website-import-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="settings-heading">
        <h2 id="website-import-title">Import from website</h2>
        <button
          autoFocus
          className="icon-button"
          disabled={busy}
          aria-label="Close website import"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <WebsiteLibrary {...props} onBusyChange={setBusy} />
    </dialog>
  );
}
