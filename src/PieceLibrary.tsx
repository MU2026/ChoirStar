import { useState, type DragEvent } from "react";
import type { LibraryItem, LibraryLayout, Piece } from "./model";
import {
  addLibraryFolder,
  moveLibraryItem,
  removeLibraryFolder,
} from "./piece-library";

type Drop = { id: string; position: "before" | "inside" | "after" };
export function PieceLibrary({
  pieces,
  layout,
  onChange,
  onSelect,
  onDelete,
  onReload,
  reloading,
}: {
  pieces: Piece[];
  layout: LibraryLayout;
  onChange: (layout: LibraryLayout) => void;
  onSelect: (id: string) => void;
  onDelete: (itemId: string) => void;
  onReload: (pieceId: string) => void;
  reloading: boolean;
}) {
  const piecesById = new Map(pieces.map((piece) => [piece.id, piece]));
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [undo, setUndo] = useState<LibraryLayout | null>(null);
  const [editor, setEditor] = useState<{
    type: "create" | "move" | "rename";
    id?: string;
  } | null>(null);
  const [parent, setParent] = useState("");
  const [before, setBefore] = useState("");
  const [name, setName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  function apply(next: LibraryLayout, message: string) {
    if (next === layout) return;
    setUndo(layout);
    onChange(next);
    setAnnouncement(message);
  }
  function path(item: LibraryItem): string {
    const parts = [item.title];
    let node = item;
    while (node.parent) {
      const folder = layout.items.find((n) => n.id === node.parent);
      if (!folder) break;
      parts.unshift(folder.title);
      node = folder;
    }
    return parts.join(" / ");
  }
  function descendant(id: string, ancestor: string) {
    let current: string | null = id;
    while (current) {
      if (current === ancestor) return true;
      current = layout.items.find((n) => n.id === current)?.parent || null;
    }
    return false;
  }
  function edit(type: "create" | "move" | "rename", item?: LibraryItem) {
    setEditor({ type, id: item?.id });
    setName(type === "rename" ? item!.title : "");
    setParent(type === "create" ? item?.id || "" : item?.parent || "");
    setBefore("");
  }
  function dragStart(event: DragEvent, item: LibraryItem) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-choirstar-item", item.id);
    setDragging(item.id);
    setEditor(null);
  }
  function over(event: DragEvent<HTMLElement>, item: LibraryItem) {
    if (!dragging || item.id === dragging || descendant(item.id, dragging))
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - rect.top) / rect.height;
    const position =
      item.type === "folder" && fraction >= 0.25 && fraction <= 0.75
        ? "inside"
        : fraction < 0.5
          ? "before"
          : "after";
    setDrop({ id: item.id, position });
  }
  function finishDrop(event: DragEvent, item?: LibraryItem) {
    event.preventDefault();
    event.stopPropagation();
    if (dragging) {
      if (!item)
        apply(moveLibraryItem(layout, dragging, null), "Moved to top level.");
      else if (drop?.id === item.id) {
        const siblings = layout.items.filter(
          (n) => n.parent === item.parent && n.id !== dragging,
        );
        const next =
          siblings[siblings.findIndex((n) => n.id === item.id) + 1]?.id || null;
        apply(
          moveLibraryItem(
            layout,
            dragging,
            drop.position === "inside" ? item.id : item.parent,
            drop.position === "inside"
              ? null
              : drop.position === "before"
                ? item.id
                : next,
          ),
          "Library order updated.",
        );
        if (drop.position === "inside")
          setClosed((old) => {
            const next = new Set(old);
            next.delete(item.id);
            return next;
          });
      }
    }
    setDragging(null);
    setDrop(null);
  }
  function actions(item: LibraryItem) {
    return (
      <span className="library-actions">
        {item.type === "piece" && (
          <button
            type="button"
            className="library-action"
            aria-label={`Reload ${item.title}`}
            title={
              piecesById.get(item.pieceId!)?.website
                ? "Reload from source website"
                : "Reload from original score file"
            }
            disabled={reloading}
            onClick={(e) => {
              e.preventDefault();
              onReload(item.pieceId!);
            }}
          >
            ↻
          </button>
        )}
        <button
          type="button"
          className="library-action"
          aria-label={`Move ${item.title}`}
          title="Move or reorder"
          onClick={(e) => {
            e.preventDefault();
            edit("move", item);
          }}
        >
          ↔
        </button>
        {item.type === "folder" && (
          <>
            <button
              type="button"
              className="library-action"
              aria-label={`New folder in ${item.title}`}
              title="New subfolder"
              onClick={(e) => {
                e.preventDefault();
                edit("create", item);
              }}
            >
              +
            </button>
            <button
              type="button"
              className="library-action"
              aria-label={`Rename ${item.title}`}
              title="Rename folder"
              onClick={(e) => {
                e.preventDefault();
                edit("rename", item);
              }}
            >
              ✎
            </button>
          </>
        )}
        <button
          type="button"
          className="delete-piece"
          aria-label={
            item.type === "folder"
              ? `Remove folder ${item.title}`
              : `Delete ${item.title}`
          }
          title={
            item.type === "folder"
              ? "Remove folder; keep its contents"
              : layout.items.filter((n) => n.pieceId === item.pieceId).length >
                  1
                ? "Remove this reference; keep the score and other references"
                : "Remove last reference and delete stored practice data"
          }
          onClick={(e) => {
            e.preventDefault();
            if (item.type === "folder")
              apply(
                removeLibraryFolder(layout, item.id),
                "Folder removed. Its contents were moved up one level.",
              );
            else {
              const piece = pieces.find((p) => p.id === item.pieceId);
              if (piece) {
                setUndo(null);
                onDelete(item.id);
              }
            }
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
          </svg>
        </button>
      </span>
    );
  }
  function rows(parent: string | null): React.ReactNode {
    return layout.items
      .filter((n) => n.parent === parent)
      .map((item) => {
        const className =
          "piece-row " + (drop?.id === item.id ? `drop-${drop.position}` : "");
        const handlers = {
          draggable: true,
          onDragStart: (e: DragEvent) => dragStart(e, item),
          onDragOver: (e: DragEvent<HTMLElement>) => over(e, item),
          onDrop: (e: DragEvent) => finishDrop(e, item),
          onDragEnd: () => {
            setDragging(null);
            setDrop(null);
          },
        };
        const handle = (
          <span className="drag-handle" aria-hidden="true" title="Drag to move">
            ⠿
          </span>
        );
        if (item.type === "piece") {
          const piece = piecesById.get(item.pieceId!);
          const format = piece
            ? { midi: "MIDI", musicxml: "MusicXML", nwc: "NWC" }[
                piece.source ?? "midi"
              ]
            : undefined;
          return (
            <div className={className} key={item.id} {...handlers}>
              {handle}
              <button
                className="piece-link"
                onClick={() => onSelect(item.pieceId!)}
              >
                {item.title}
                {format && <small className="piece-format">{format}</small>}
              </button>
              {actions(item)}
            </div>
          );
        }
        return (
          <details
            className="piece-group"
            key={item.id}
            open={!closed.has(item.id)}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setClosed((old) => {
                if (old.has(item.id) === !open) return old;
                const next = new Set(old);
                if (open) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }}
          >
            <summary className={className} {...handlers}>
              {handle}
              <span className="folder-title">{item.title}</span>
              {actions(item)}
            </summary>
            <div className="piece-group-content">{rows(item.id)}</div>
          </details>
        );
      });
  }
  return (
    <>
      <div className="library-toolbar">
        <button onClick={() => edit("create")}>New folder</button>
        {undo && (
          <button
            onClick={() => {
              onChange(undo);
              setUndo(null);
              setAnnouncement("Organization change undone.");
            }}
          >
            Undo organization change
          </button>
        )}
        <span className="muted">
          Drag rows to reorder; drop on a folder to move inside.
        </span>
      </div>
      {editor && (
        <form
          className="library-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (editor.type === "create")
              apply(
                addLibraryFolder(layout, name, parent || null),
                "Folder created.",
              );
            else if (editor.type === "move")
              apply(
                moveLibraryItem(
                  layout,
                  editor.id!,
                  parent || null,
                  before || null,
                ),
                "Library order updated.",
              );
            else if (name.trim())
              apply(
                {
                  ...layout,
                  items: layout.items.map((n) =>
                    n.id === editor.id ? { ...n, title: name.trim() } : n,
                  ),
                },
                "Folder renamed.",
              );
            setEditor(null);
          }}
        >
          <strong>
            {editor.type === "create"
              ? "New folder"
              : editor.type === "rename"
                ? "Rename folder"
                : "Move or reorder"}
          </strong>
          {editor.type !== "move" && (
            <label>
              Folder name
              <input
                autoFocus
                required
                maxLength={1000}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {editor.type !== "rename" && (
            <>
              <label>
                Destination folder
                <select
                  aria-label="Destination folder"
                  autoFocus={editor.type === "move"}
                  value={parent}
                  onChange={(e) => {
                    setParent(e.target.value);
                    setBefore("");
                  }}
                >
                  <option value="">Top level</option>
                  {layout.items
                    .filter(
                      (n) =>
                        n.type === "folder" &&
                        !(
                          editor.type === "move" && descendant(n.id, editor.id!)
                        ),
                    )
                    .map((n) => (
                      <option value={n.id} key={n.id}>
                        {path(n)}
                      </option>
                    ))}
                </select>
              </label>
              {editor.type === "move" && (
                <label>
                  Place before
                  <select
                    aria-label="Place before"
                    value={before}
                    onChange={(e) => setBefore(e.target.value)}
                  >
                    <option value="">End of folder</option>
                    {layout.items
                      .filter(
                        (n) =>
                          n.parent === (parent || null) && n.id !== editor.id,
                      )
                      .map((n) => (
                        <option value={n.id} key={n.id}>
                          {n.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
          )}
          <button className="primary">
            {editor.type === "move" ? "Move" : "Save folder"}
          </button>
          <button type="button" onClick={() => setEditor(null)}>
            Cancel
          </button>
        </form>
      )}
      <div className="piece-list">{rows(null)}</div>
      {dragging && (
        <div
          className="root-drop"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDrop(null);
          }}
          onDrop={(e) => finishDrop(e)}
        >
          Drop here to move to top level
        </div>
      )}
      <p className="library-status" role="status">
        {announcement}
      </p>
    </>
  );
}
