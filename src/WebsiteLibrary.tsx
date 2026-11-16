import { useEffect, useRef, useState } from "react";
import {
  catalogueSchema,
  fetchLimited,
  parseWebsiteExport,
  scanWebsite,
  websiteBookmarklet,
  websiteHelperLoader,
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
  onImported: (count: number, skipped?: number) => void;
  onBusyChange: (busy: boolean) => void;
  onSave: (catalogue: WebsiteCatalogue) => void;
  onImport: (
    file: File,
    entry: WebsiteEntry,
    catalogue: WebsiteCatalogue,
  ) => Promise<boolean>;
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
  const [mobileHelp] = useState(
    () =>
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      // iPadOS can identify itself as a Mac when requesting desktop websites.
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<Record<string, string>>({});
  const bookmark = useRef<HTMLAnchorElement>(null);
  const helperCode = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [bookmarklet] = useState(websiteBookmarklet);
  const [mobileBookmarklet] = useState(() =>
    websiteHelperLoader(
      new URL(`${import.meta.env.BASE_URL}website-helper.js`, location.href)
        .href,
    ),
  );
  const upload = useRef<HTMLInputElement>(null);
  const localScore = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<WebsiteEntry | null>(null);
  useEffect(() => {
    bookmark.current?.setAttribute("href", bookmarklet);
  }, [bookmarklet]);
  async function copyHelper() {
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(mobileBookmarklet);
      setCopyStatus(
        "Helper code copied. Paste it into the bookmark's address field.",
      );
    } catch {
      helperCode.current?.focus();
      helperCode.current?.select();
      setCopyStatus(
        "Automatic copying is unavailable. Touch and hold the selected code and choose Copy.",
      );
    }
  }
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
    let skipped = 0;
    const failed: string[] = [];
    for (const entry of new Map(entries.map((e) => [e.url, e])).values()) {
      if (imported.has(entry.url)) {
        skipped++;
        continue;
      }
      setStatus(
        `Importing ${count + skipped + failed.length + 1} of ${entries.length}…`,
      );
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
        if (await onImport(new File([blob], entry.filename), entry, catalogue))
          count++;
        else skipped++;
      } catch {
        failed.push(entry.title);
      }
    }
    setStatus(
      `Imported ${count} scores. ${skipped ? `${skipped} already in your library; no duplicates added. ` : ""}${failed.length ? `${failed.length} could not be imported.` : ""}`,
    );
    if (failed.length)
      setError(
        `Could not import: ${failed.slice(0, 8).join(", ")}. Use the website helper, or open each source file and attach the downloaded score. Successful imports were kept.`,
      );
    setSelected(new Set());
    setBusy(false);
    if (count > 0 && !failed.length) onImported(count, skipped);
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
        <details className="website-help" open>
          <summary>Signed-in or blocked website?</summary>
          <p>
            Install the Export to ChoirStar helper once in the browser you use
            to sign in to the source website. Replace its code after updating
            ChoirStar.
          </p>
          <details open={mobileHelp}>
            <summary>Phone or tablet: install without dragging</summary>
            <ol>
              <li>
                Bookmark this page using your browser's bookmark menu (not Add
                to Home Screen). Name it <strong>Export to ChoirStar</strong>.
              </li>
              <li>
                Choose <strong>Copy helper code</strong> below. Open your
                browser's bookmarks, edit the bookmark you just created and
                replace its entire address with the copied code. Keep the
                initial <strong>javascript:</strong> and save.
              </li>
              <li>
                Open the repertoire page and sign in in the same browser. In
                Safari, open the helper from Bookmarks while that page is
                visible. In Chrome on Android, type{" "}
                <strong>Export to ChoirStar</strong> in the address bar and
                choose the saved bookmark suggestion. Do not paste the helper
                code into a search box.
              </li>
              <li>
                Confirm the export and keep the source page open until it
                finishes. Return here, choose{" "}
                <strong>Import website file</strong>, select{" "}
                <strong>choirstar-[website hostname].json</strong> from
                Downloads and select the scores to import.
              </li>
            </ol>
            <button type="button" onClick={() => void copyHelper()}>
              Copy helper code
            </button>
            <label className="website-helper-code">
              Helper code (select and copy manually if needed)
              <textarea
                ref={helperCode}
                readOnly
                value={mobileBookmarklet}
                rows={3}
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            {copyStatus && <p role="status">{copyStatus}</p>}
            <p>
              This short code loads the export helper from ChoirStar when you
              run it. An internet connection is required. The helper runs on the
              source page; scores, passwords and cookies are not sent to
              ChoirStar. Replace the old long code with this short version.
            </p>
            <p>
              Mobile browser support varies. If no export confirmation appears,
              the browser or website may block the helper. You can also export
              on a desktop and transfer the JSON file privately to this device,
              or download individual scores and use Import → Local file.
            </p>
          </details>
          <details open={!mobileHelp}>
            <summary>Desktop installation and export</summary>
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
                Open the repertoire page and sign in there. Run the bookmark and
                confirm the local export. Keep the page open while it downloads
                the scores. The export is saved to your browser's download
                folder as choirstar-[website hostname].json (on a phone or
                tablet, check Downloads in your file manager). If no
                confirmation appears, the website may block bookmarklets; use
                the saved HTML alternative below.
              </li>
              <li>
                Here, choose <strong>Import website file</strong> and select{" "}
                <strong>choirstar-[website hostname].json</strong>. Select
                scores from the list to add them to your pieces.
              </li>
            </ol>
          </details>
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
              const added = await onImport(f, pending, catalogue);
              setStatus(
                added
                  ? `Imported ${pending.title}.`
                  : "This score is already in your library. No duplicate was added.",
              );
              if (added) onImported(1);
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
