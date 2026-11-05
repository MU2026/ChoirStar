import type { Piece } from "./model";
import { fetchLimited, type WebsiteCatalogue } from "./website";

export async function fetchReloadFile(
  piece: Piece,
  catalogues: WebsiteCatalogue[],
) {
  if (!piece.website)
    throw new Error("No source website is saved for this piece.");
  const response = await fetchLimited(piece.website.url, 20 * 1024 * 1024);
  if (/text\/html/i.test(response.headers.get("content-type") ?? ""))
    throw new Error(
      "The source returned a web page instead of a score. Sign in on the source website or choose the downloaded file.",
    );
  const entry = catalogues
    .flatMap((c) => c.entries)
    .find((e) => e.url === piece.website!.url);
  const path = new URL(piece.website.url).pathname;
  const filename = entry?.filename || path.split("/").at(-1) || "";
  const supported = /\.(mid|midi|nwc|nwctxt|musicxml|xml)$/i.test(filename);
  const extension =
    piece.source === "nwc"
      ? "nwc"
      : piece.source === "musicxml"
        ? "musicxml"
        : "mid";
  return new File(
    [await response.blob()],
    supported ? filename : `reload.${extension}`,
  );
}
