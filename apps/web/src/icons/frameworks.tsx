/**
 * Framework icons — inline, self-contained SVG (no CDN, no <img>). Keyed on the
 * exact `RepositoryFramework.name` strings the analyzer emits (see
 * FRAMEWORK_SIGNATURES in packages/analyzer-js-ts). Well-known marks (React, Vue)
 * use their real geometry; the rest use a tidy lettered badge in the brand hue,
 * which also reads as a small bubble. Unmapped names fall back to a neutral dot.
 */
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

function Svg({ size = 16, children, label }: IconProps & { children: ReactNode; label: string }) {
  return (
    <svg
      className="fw-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      style={{ display: "block", flex: "0 0 auto" }}
    >
      {children}
    </svg>
  );
}

/** A rounded-square badge with a short letterform, in one brand colour. */
function Badge({ size, label, letter, bg, fg = "#fff" }: IconProps & { label: string; letter: string; bg: string; fg?: string }) {
  return (
    <Svg size={size} label={label}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={bg} />
      <text
        x="12"
        y="12"
        fill={fg}
        fontSize={letter.length > 1 ? 8.5 : 12}
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {letter}
      </text>
    </Svg>
  );
}

function ReactIcon({ size }: IconProps) {
  return (
    <Svg size={size} label="React">
      <g fill="none" stroke="#61dafb" strokeWidth="1.4">
        <ellipse cx="12" cy="12" rx="10" ry="4" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="#61dafb" />
    </Svg>
  );
}

function VueIcon({ size }: IconProps) {
  return (
    <Svg size={size} label="Vue">
      <path d="M2 4h4.2L12 14 17.8 4H22L12 21 2 4Z" fill="#41b883" />
      <path d="M6.2 4h3.3L12 8.2 14.5 4h3.3L12 14Z" fill="#35495e" />
    </Svg>
  );
}

function NextIcon({ size }: IconProps) {
  return (
    <Svg size={size} label="Next.js">
      <circle cx="12" cy="12" r="10.5" fill="currentColor" />
      <path d="M9 8v8M9 8l7.5 9M16 8v5.5" stroke="var(--surface)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

const FRAMEWORK_ICON: Record<string, (props: IconProps) => ReactNode> = {
  React: (p) => <ReactIcon {...p} />,
  Vue: (p) => <VueIcon {...p} />,
  "Next.js": (p) => <NextIcon {...p} />,
  Svelte: (p) => <Badge {...p} label="Svelte" letter="S" bg="#ff3e00" />,
  SvelteKit: (p) => <Badge {...p} label="SvelteKit" letter="SK" bg="#ff3e00" />,
  Nuxt: (p) => <Badge {...p} label="Nuxt" letter="N" bg="#00dc82" fg="#0b1120" />,
  "TanStack Router": (p) => <Badge {...p} label="TanStack Router" letter="TS" bg="#f97316" fg="#1c1917" />,
  "TanStack Start": (p) => <Badge {...p} label="TanStack Start" letter="TS" bg="#ef4444" />,
  Express: (p) => <Badge {...p} label="Express" letter="ex" bg="#334155" />,
  Hono: (p) => <Badge {...p} label="Hono" letter="H" bg="#e36002" />,
  Fastify: (p) => <Badge {...p} label="Fastify" letter="F" bg="#1e293b" />,
  NestJS: (p) => <Badge {...p} label="NestJS" letter="N" bg="#e0234e" />,
  Remix: (p) => <Badge {...p} label="Remix" letter="R" bg="#3992ff" />,
};

/** Renders the icon for a detected framework, or a neutral fallback dot. */
export function FrameworkIcon({ name, size = 16 }: { name: string; size?: number }) {
  const render = FRAMEWORK_ICON[name];
  if (render) return <>{render({ size })}</>;
  return (
    <Svg size={size} label={name}>
      <circle cx="12" cy="12" r="7" fill="var(--h-slate)" />
    </Svg>
  );
}
