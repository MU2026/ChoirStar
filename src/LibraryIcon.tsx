export function LibraryIcon({
  kind,
}: {
  kind: "import" | "backup" | "new-folder";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "new-folder" ? (
        <>
          <path d="M20 10V7a2 2 0 0 0-2-2h-7L9 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9" />
          <path d="M18 13v8m-4-4h8" />
        </>
      ) : (
        <>
          <path d="M4 16v4h16v-4M12 4v12" />
          <path d={kind === "import" ? "m7 9 5-5 5 5" : "m7 11 5 5 5-5"} />
        </>
      )}
    </svg>
  );
}
