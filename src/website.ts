import { z } from "zod";

const webUrl = z
  .string()
  .max(8000)
  .refine((s) => {
    try {
      const u = new URL(s);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS address without a password.");
export const catalogueSchema = z.object({
  url: webUrl,
  title: z.string().max(1000),
  entries: z
    .array(
      z.object({
        url: webUrl,
        title: z.string().max(1000),
        filename: z.string().max(1000),
        format: z.enum(["midi", "musicxml"]),
        category: z.array(z.string().max(1000)).max(12),
      }),
    )
    .max(2000),
});
export type WebsiteCatalogue = z.infer<typeof catalogueSchema>;
export type WebsiteEntry = WebsiteCatalogue["entries"][number];

// Self-contained: the same scanner runs in ChoirStar and the user's bookmarklet.
export function scanWebsite(doc: Document, address: string): WebsiteCatalogue {
  const page = new URL(address);
  if (!/^https?:$/.test(page.protocol) || page.username || page.password)
    throw new Error("Enter an HTTP or HTTPS page address without a password.");
  page.hash = "";
  const clean = (s: string | null) =>
    (s || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  let base = page.href;
  const baseHref = doc.getElementsByTagName("base")[0]?.getAttribute("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, base).href;
    } catch {
      /* Ignore malformed base. */
    }
  }
  const headings: { level: number; title: string }[] = [];
  const entries: WebsiteEntry[] = [];
  const seen = new Set<string>();
  const tableGroups = new Map<Element, string[]>();
  const tableSections = new Map<Element, string>();
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      while (headings.length && headings[headings.length - 1].level >= level)
        headings.pop();
      const title = clean(node.textContent);
      if (title) headings.push({ level, title });
    }
    if (tag === "tr") {
      const cells = Array.from(node.childNodes).filter(
        (c) => c.nodeType === 1 && /^(td|th)$/i.test((c as Element).tagName),
      ) as Element[];
      let table = node.parentNode as Element | null;
      while (table && table.tagName?.toLowerCase() !== "table")
        table = table.parentNode as Element | null;
      if (
        table &&
        cells.length === 1 &&
        Number(cells[0].getAttribute("colspan")) > 1 &&
        !node.getElementsByTagName("a").length &&
        !node.getElementsByTagName("img").length
      ) {
        const label = clean(cells[0].textContent);
        if (label) {
          if (/(?:\*\s*){3,}/.test(label)) {
            tableSections.set(table, label.replace(/\*/g, "").trim());
            tableGroups.set(table, []);
            continue;
          }
          const main =
            (node.getAttribute("style") || "").includes("background") ||
            (node.getElementsByTagName("strong").length > 0 &&
              !node.getElementsByTagName("em").length);
          tableGroups.set(
            table,
            main
              ? [label]
              : [...(tableGroups.get(table) || []).slice(0, 1), label],
          );
        }
      }
    }
    if (tag !== "a" || !node.getAttribute("href")) continue;
    let url: URL;
    try {
      url = new URL(node.getAttribute("href")!, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      continue;
    url.hash = "";
    const candidates = [
      node.getAttribute("download") || "",
      ...Array.from(url.searchParams.values()),
      url.pathname.split("/").pop() || "",
      clean(node.textContent),
    ];
    let filename = "";
    for (const candidate of candidates) {
      let decoded = candidate;
      try {
        decoded = decodeURIComponent(candidate);
      } catch {
        /* Keep original. */
      }
      if (/\.(mid|midi|musicxml|xml)$/i.test(decoded)) {
        filename = decoded.split(/[\\/]/).pop()!;
        break;
      }
    }
    if (!filename) continue;
    const category = headings.map((h) => h.title);
    let rowTitle = "";
    const parents: Element[] = [];
    let parent = node.parentNode;
    while (parent && parent.nodeType === 1) {
      parents.unshift(parent as Element);
      parent = parent.parentNode;
    }
    for (const ancestor of parents) {
      const name = ancestor.tagName.toLowerCase();
      let label = "";
      if (name === "table") {
        const section = tableSections.get(ancestor);
        if (section) category.push(section);
        category.push(...(tableGroups.get(ancestor) || []));
      }
      if (name === "details")
        label = clean(
          ancestor.getElementsByTagName("summary")[0]?.textContent || "",
        );
      if (name === "tr") {
        const cell = Array.from(ancestor.childNodes).find(
          (c) => c.nodeType === 1 && /^(td|th)$/i.test((c as Element).tagName),
        ) as Element | undefined;
        if (
          cell &&
          !Array.from(cell.getElementsByTagName("a")).some((a) => a === node)
        ) {
          const first = Array.from(cell.childNodes).find((n) =>
            clean(n.textContent),
          );
          rowTitle = clean(first?.textContent || cell.textContent);
        }
      }
      if (name === "li") {
        for (const child of Array.from(ancestor.childNodes)) {
          if (
            child === node ||
            (child.nodeType === 1 &&
              /^(ul|ol|a)$/i.test((child as Element).tagName))
          )
            break;
          label += child.textContent || "";
        }
        label = clean(label);
      }
      if (label && !category.includes(label)) category.push(label);
    }
    const identity = JSON.stringify([url.href, category]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    entries.push({
      url: url.href,
      filename,
      title: rowTitle || clean(node.textContent) || filename,
      format: /\.(mid|midi)$/i.test(filename) ? "midi" : "musicxml",
      category: category.slice(0, 12),
    });
  }
  return {
    url: page.href,
    title:
      clean(
        doc.getElementsByTagName("title")[0]?.textContent ||
          doc.getElementsByTagName("h1")[0]?.textContent ||
          "",
      ) || page.hostname,
    entries,
  };
}

export async function fetchLimited(
  url: string,
  limit: number,
  credentials: RequestCredentials = "omit",
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(webUrl.parse(url), {
      credentials,
      signal: controller.signal,
      referrerPolicy: "no-referrer",
    });
    if (!response.ok)
      throw new Error(
        `Website returned HTTP ${response.status}. Sign in on the source website if needed.`,
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The website returned no content.");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The file is too large.");
      }
      chunks.push(value);
    }
    const headers = new Headers(response.headers);
    headers.set("X-ChoirStar-Page-URL", response.url || url);
    return new Response(new Blob(chunks), { headers });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseWebsiteExport(text: string) {
  return z
    .object({
      format: z.literal("ChoirStar website"),
      catalogue: catalogueSchema,
      files: z
        .record(
          z.string(),
          z
            .string()
            .max(28000000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        )
        .default({}),
    })
    .parse(JSON.parse(text));
}

// This helper runs only when the user invokes their bookmark on the source page.
export function websiteBookmarklet() {
  return (
    "javascript:void((" +
    async function (scan: typeof scanWebsite) {
      const catalogue = scan(document, location.href);
      if (!catalogue.entries.length) {
        alert("No MIDI or uncompressed MusicXML links found on this page.");
        return;
      }
      if (
        !confirm(
          `Export ${catalogue.entries.length} score links and their categories to a local ChoirStar file? Scores will be downloaded using this website's sign-in. Nothing is uploaded.`,
        )
      )
        return;
      const files: Record<string, string> = {};
      let total = 0;
      for (const entry of catalogue.entries) {
        if (files[entry.url]) continue;
        if (total > 60 * 1024 * 1024) break;
        try {
          // Do not send this site's credentials to a different origin.
          const response = await fetch(entry.url, {
            credentials:
              new URL(entry.url).origin === location.origin
                ? "same-origin"
                : "omit",
            signal: AbortSignal.timeout(15000),
          });
          if (
            !response.ok ||
            /text\/html/i.test(response.headers.get("content-type") || "")
          )
            continue;
          const reader = response.body!.getReader();
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          let size = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 20 * 1024 * 1024 || total + size > 80 * 1024 * 1024) {
              await reader.cancel();
              throw new Error("Size limit");
            }
            chunks.push(value);
          }
          const blob = new Blob(chunks);
          files[entry.url] = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          total += size;
        } catch {
          /* Keep the link available for manual download. */
        }
      }
      const url = URL.createObjectURL(
        new Blob(
          [JSON.stringify({ format: "ChoirStar website", catalogue, files })],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "choirstar-website.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      alert(
        `Exported ${catalogue.entries.length} links and ${Object.keys(files).length} score files. Import choirstar-website.json in ChoirStar. Links without files can be opened for manual download.`,
      );
    }.toString() +
    ")(" +
    scanWebsite.toString() +
    "))"
  );
}
