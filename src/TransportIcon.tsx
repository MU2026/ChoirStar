export function TransportIcon({
  kind,
}: {
  kind: "sing" | "listen" | "stop" | "loop";
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === "sing" ? (
        // Lucide mic-vocal (ISC); see docs/upstream.md and public/licenses/lucide-ISC.txt.
        <g strokeLinejoin="round">
          <path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12" />
          <path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5" />
          <circle cx="16" cy="7" r="5" />
        </g>
      ) : kind === "listen" ? (
        <path d="m7 3 14 9-14 9z" fill="currentColor" />
      ) : kind === "stop" ? (
        <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
      ) : (
        <>
          <path d="M19 7H6a3 3 0 0 0-3 3v2M5 17h13a3 3 0 0 0 3-3v-2M16 4l3 3-3 3M8 14l-3 3 3 3" />
        </>
      )}
    </svg>
  );
}
