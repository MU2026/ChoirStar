import { useEffect, useRef, useState } from "react";
import {
  catalogueSchema,
  fetchLimited,
  parseWebsiteExport,
  scanWebsite,
  websiteBookmarklet,
  type WebsiteCatalogue,
  type WebsiteEntry,
} from "./website";

export function WebsiteLibrary({
  catalogues,
  imported,
  onSave,
  onImport,
  onImported,
  onBusyChange,
}: {
  catalogues: WebsiteCatalogue[];
  imported: Set<string>;
  onImported: (count: number) => void;
  onBusyChange: (busy: boolean) => void;
  onSave: (catalogue: WebsiteCatalogue) => void;
  onImport: (
    file: File,
    entry: WebsiteEntry,
    catalogue: WebsiteCatalogue,
  ) => Promise<void>;
}) {
  const [address, setAddress] = useState(catalogues[0]?.url || "");
  const [active, setActive] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<Record<string, string>>({});
  const bookmark = useRef<HTMLAnchorElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const localScore = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<WebsiteEntry | null>(null);
  useEffect(() => {
    bookmark.current?.setAttribute("href", websiteBookmarklet());
  }, []);
  const catalogue = catalogues.find((c) => c.url === active) || catalogues[0];
  function save(c: WebsiteCatalogue) {
    const checked = catalogueSchema.parse(c);
    if (!checked.entries.length)
      throw new Error(
        "No supported score links found. This may be a sign-in page. Open the source page, sign in and use the website helper or save the page as HTML.",
      );
    onSave(checked);
    setActive(checked.url);
    setSelected(new Set());
    setQuery("");
    setStatus(`Found ${checked.entries.length} MIDI / MusicXML / NWC links.`);
  }
  async function scan() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetchLimited(address, 5 * 1024 * 1024);
      save(
        scanWebsite(
          new DOMParser().parseFromString(await response.text(), "text/html"),
          response.headers.get("X-ChoirStar-Page-URL") || address,
        ),
      );
      setFiles({});
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : e} Direct access may be blocked by the website. Use the signed-in website helper below, or import a saved HTML page.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function read(file: File) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (file.size > 120 * 1024 * 1024)
        throw new Error("Website exports must be smaller than 120 MB.");
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        const bundle = parseWebsiteExport(text);
        save(bundle.catalogue);
        setFiles(bundle.files);
      } else {
        if (file.size > 5 * 1024 * 1024)
          throw new Error("HTML pages must be smaller than 5 MB.");
        save(
          scanWebsite(
            new DOMParser().parseFromString(text, "text/html"),
            address,
          ),
        );
        setFiles({});
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read website export.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importEntries(entries: WebsiteEntry[]) {
    if (!catalogue) return;
    setBusy(true);
    setError("");
    setStatus("");
    let count = 0;
    const failed: string[] = [];
    for (const entry of new Map(entries.map((e) => [e.url, e])).values()) {
      if (imported.has(entry.url)) continue;
      setStatus(`Importing ${count + failed.length + 1} of ${entries.length}…`);
      try {
        let blob: Blob;
        if (files[entry.url])
          blob = new Blob([
            Uint8Array.from(atob(files[entry.url]), (c) => c.charCodeAt(0)),
          ]);
        else {
          const response = await fetchLimited(entry.url, 20 * 1024 * 1024);
          if (/text\/html/i.test(response.headers.get("content-type") || ""))
            throw new Error(
              "The server returned a web page instead of a score.",
            );
          blob = await response.blob();
        }
        await onImport(new File([blob], entry.filename), entry, catalogue);
        count++;
      } catch {
        failed.push(entry.title);
      }
    }
    setStatus(
      `Imported ${count} scores. ${failed.length ? `${failed.length} could not be imported.` : ""}`,
    );
    if (failed.length)
      setError(
        `Could not import: ${failed.slice(0, 8).join(", ")}. Use the website helper, or open each source file and attach the downloaded score. Successful imports were kept.`,
      );
    setSelected(new Set());
    setBusy(false);
    if (count > 0 && !failed.length) onImported(count);
  }
  const visible = (catalogue?.entries || []).filter((e) =>
    `${e.title} ${e.filename} ${e.category.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const groups = new Map<string, WebsiteEntry[]>();
  for (const entry of visible) {
    const key = entry.category.join(" › ") || "Uncategorized";
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  return (
    <section className="website-library panel" aria-label="Website library">
      <h2>Website library</h2>
      <p className="muted">
        Browse MIDI (.mid, .midi), NWC (.nwc, .nwctxt) and uncompressed MusicXML
        (.musicxml, .xml) links, grouped as on the source page. Scores stay on
        this device.
      </p>
      <fieldset disabled={busy}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void scan();
          }}
        >
          <input
            type="url"
            aria-label="Source page address"
            autoFocus
            placeholder="https://choir.example/repertoire/"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
          <button type="submit">Read page</button>
          {/^(https?):\/\//i.test(address) && (
            <a href={address} target="_blank" rel="noopener noreferrer">
              Open website / sign in
            </a>
          )}
          <button type="button" onClick={() => upload.current?.click()}>
            Import website file
          </button>
        </form>
        <input
          hidden
          ref={upload}
          type="file"
          accept=".json,.html,.htm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
        <details className="website-help">
          <summary>Signed-in or blocked website?</summary>
          <ol>
            <li>
              On a desktop browser, drag{" "}
              <a ref={bookmark} onClick={(e) => e.preventDefault()}>
                Export to ChoirStar
              </a>{" "}
              to your bookmarks bar. Replace any older copy of this bookmark
              after updating ChoirStar.
            </li>
            <li>
              Open the repertoire page and sign in there. Click the bookmark and
              confirm the local export. Keep the page open while it downloads
              the scores. The export is saved to your browser's download folder
              as choirstar-[website hostname].json. If no confirmation appears,
              the website may block bookmarklets; use the saved HTML alternative
              below.
            </li>
            <li>
              Here, choose <strong>Import website file</strong> and select{" "}
              <strong>choirstar-[website hostname].json</strong>. Select scores
              from the list to add them to your pieces.
            </li>
          </ol>
          <p>
            No password or cookies are copied. The helper downloads only linked
            scores; it does not upload anything. Some websites block helpers or
            downloads.
          </p>
          <p>
            Alternative: save the signed-in page as HTML in your browser, enter
            its original address above, and import that HTML file. Its links and
            categories will appear here. Use <strong>Open file</strong> to
            download a protected score, then <strong>Attach file</strong> to add
            it. PDF, audio, compressed MusicXML and links without a recognizable
            score filename are not included. Subpages are not crawled.
          </p>
        </details>
        {catalogues.length > 0 && (
          <div className="row">
            <select
              aria-label="Website catalogue"
              value={catalogue?.url}
              onChange={(e) => {
                setActive(e.target.value);
                setAddress(e.target.value);
                setSelected(new Set());
              }}
            >
              {catalogues.map((c) => (
                <option key={c.url} value={c.url}>
                  {c.title}
                </option>
              ))}
            </select>
            <input
              aria-label="Filter website scores"
              placeholder="Filter scores or categories"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              onClick={() =>
                setSelected(
                  new Set(
                    visible
                      .filter((e) => !imported.has(e.url))
                      .map((e) => e.url),
                  ),
                )
              }
            >
              Select visible
            </button>
            <button
              disabled={!selected.size}
              onClick={() =>
                void importEntries(
                  (catalogue?.entries || []).filter((e) => selected.has(e.url)),
                )
              }
            >
              Import selected ({selected.size})
            </button>
          </div>
        )}
        <div className="website-groups">
          {Array.from(groups, ([category, entries]) => (
            <details key={category} open>
              <summary>
                {category} <small>({entries.length})</small>
              </summary>
              {entries.map((entry) => (
                <div className="website-entry" key={entry.url}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.url)}
                      disabled={imported.has(entry.url)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(entry.url);
                          else next.delete(entry.url);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>
                        {entry.filename} ·{" "}
                        {entry.format === "midi"
                          ? "MIDI"
                          : entry.format === "nwc"
                            ? "NWC"
                            : "MusicXML"}
                        {imported.has(entry.url)
                          ? " · Imported"
                          : files[entry.url]
                            ? " · Ready to import"
                            : ""}
                      </small>
                    </span>
                  </label>
                  <a href={entry.url} target="_blank" rel="noopener noreferrer">
                    Open file
                  </a>
                  {!imported.has(entry.url) && (
                    <button
                      onClick={() => {
                        setPending(entry);
                        localScore.current?.click();
                      }}
                    >
                      Attach file
                    </button>
                  )}
                </div>
              ))}
            </details>
          ))}
        </div>
        <input
          hidden
          ref={localScore}
          type="file"
          accept=".mid,.midi,.musicxml,.xml,.nwc,.nwctxt"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !pending || !catalogue) return;
            setBusy(true);
            setError("");
            try {
              await onImport(f, pending, catalogue);
              setStatus(`Imported ${pending.title}.`);
              onImported(1);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Could not import score.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </fieldset>
      {busy && <p role="status">{status || "Reading website…"}</p>}
      {!busy && status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="website-error">
          {error}
        </p>
      )}
    </section>
  );
}
