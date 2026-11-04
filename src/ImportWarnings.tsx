import { useRef } from "react";

export function ImportWarnings({ warnings }: { warnings?: string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const messages = [
    ...new Set(
      (warnings ?? [])
        .map((warning) => warning.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  ];
  if (!messages.length) return null;
  return (
    <>
      <button
        className="import-warnings-handle"
        title="Import warnings"
        aria-label={`Import warnings (${messages.length})`}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <span aria-hidden="true">⚠</span> {messages.length}
      </button>
      <dialog
        ref={dialog}
        className="import-warnings-dialog"
        aria-labelledby="import-warnings-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="settings-heading">
          <h2 id="import-warnings-title">Import warnings</h2>
          <button
            autoFocus
            className="icon-button"
            aria-label="Close import warnings"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <ul>
          {messages.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
