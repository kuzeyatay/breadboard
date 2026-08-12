// The mark that means "this attachment is a 3D model".
//
// Shared by the composer chip, the message card and the Uploads list so a mesh
// looks the same wherever it is listed and never reads as a generic document.

export default function ModelCubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.75 20.25 7v10L12 21.25 3.75 17V7L12 2.75Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7 12 11.25 20.25 7M12 11.25v10" />
    </svg>
  );
}
