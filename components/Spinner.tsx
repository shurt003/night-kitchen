/**
 * A ring that inherits its colour from the text around it, so it works on the
 * flame buttons (chalk text) and the bordered ones (smoke text) without a prop.
 * Size it with h-/w- classes at the call site.
 */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70 motion-reduce:animate-none ${className}`}
    />
  );
}
