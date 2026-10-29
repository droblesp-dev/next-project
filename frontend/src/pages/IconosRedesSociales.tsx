// Íconos de redes sociales: SVG inline (sin dependencias nuevas ni CDN externo, currentColor para heredar el
// color del sitio) — no Material Symbols porque ese set no incluye logos de marca. Compartidos por la web
// principal (App.tsx) y el pie de la cotización pública.
type IconoProps = { className?: string };

export function IconoFacebook({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.87.24-1.46 1.49-1.46H16.5V4.36C16.24 4.32 15.36 4.25 14.33 4.25c-2.15 0-3.62 1.31-3.62 3.72V10.5H8.19v3h2.52V21h2.79Z" />
    </svg>
  );
}

export function IconoInstagram({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconoYouTube({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.6 7.2s-.2-1.44-.82-2.07c-.79-.83-1.67-.83-2.07-.88C15.9 4 12 4 12 4h-.01s-3.89 0-6.7.25c-.4.05-1.28.05-2.07.88-.62.63-.82 2.07-.82 2.07S2.2 8.9 2.2 10.6v1.8c0 1.7.2 3.4.2 3.4s.2 1.44.82 2.07c.79.83 1.82.8 2.28.89 1.65.16 7 .25 7 .25s3.9-.01 6.71-.26c.4-.05 1.28-.05 2.07-.88.62-.63.82-2.07.82-2.07s.2-1.7.2-3.4v-1.8c0-1.7-.2-3.4-.2-3.4ZM9.96 14.5v-5l4.8 2.51-4.8 2.49Z" />
    </svg>
  );
}

export function IconoTikTok({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.6 5.2c.6 1.02 1.6 1.78 2.8 2.02v2.55a5.86 5.86 0 0 1-2.8-.77v5.5a4.9 4.9 0 1 1-4.9-4.9c.17 0 .34 0 .5.03v2.6a2.3 2.3 0 1 0 1.9 2.27V3h2.5c0 .77.03 1.5 0 2.2Z" />
    </svg>
  );
}
