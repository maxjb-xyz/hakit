import { cn } from '../cn';

/** Hakit mark: a pixel-font "<h>" on a light rounded tile. Same mark as the favicon (docs/brand/logo.svg). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 64 64"
      shapeRendering="crispEdges"
      className={cn('size-6 shrink-0', className)}
    >
      <rect width="64" height="64" rx="14" className="fill-strong" />
      <path
        className="fill-on-light"
        d="M18 19.75h3.5v3.5h-3.5zM25 19.75h3.5v3.5h-3.5zM42.5 19.75h3.5v3.5h-3.5zM14.5 23.25h3.5v3.5h-3.5zM25 23.25h3.5v3.5h-3.5zM46 23.25h3.5v3.5h-3.5zM11 26.75h3.5v3.5h-3.5zM25 26.75h3.5v3.5h-3.5zM32 26.75h3.5v3.5h-3.5zM35.5 26.75h3.5v3.5h-3.5zM49.5 26.75h3.5v3.5h-3.5zM7.5 30.25h3.5v3.5h-3.5zM25 30.25h3.5v3.5h-3.5zM28.5 30.25h3.5v3.5h-3.5zM35.5 30.25h3.5v3.5h-3.5zM53 30.25h3.5v3.5h-3.5zM11 33.75h3.5v3.5h-3.5zM25 33.75h3.5v3.5h-3.5zM35.5 33.75h3.5v3.5h-3.5zM49.5 33.75h3.5v3.5h-3.5zM14.5 37.25h3.5v3.5h-3.5zM25 37.25h3.5v3.5h-3.5zM35.5 37.25h3.5v3.5h-3.5zM46 37.25h3.5v3.5h-3.5zM18 40.75h3.5v3.5h-3.5zM25 40.75h3.5v3.5h-3.5zM35.5 40.75h3.5v3.5h-3.5zM42.5 40.75h3.5v3.5h-3.5z"
      />
    </svg>
  );
}
