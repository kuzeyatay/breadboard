import Link from "next/link";

const SECTIONS = [
  { href: "/settings", label: "Settings" },
  { href: "/screen-time", label: "Screen Time" },
] as const;

export default function SettingsSectionNav({ active, returnTo }: {
  active: (typeof SECTIONS)[number]["href"];
  returnTo?: string;
}) {
  return (
    <nav aria-label="Settings sections" className="relative z-10 inline-flex shrink-0 items-center rounded-md border border-gray-800 bg-gray-900/80 p-1 shadow-inner">
      {SECTIONS.map(({ href, label }) => (
        <Link
          key={href}
          href={returnTo ? { pathname: href, query: { returnTo } } : href}
          aria-current={active === href ? "page" : undefined}
          className={active === href
            ? "whitespace-nowrap rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-950 shadow-sm"
            : "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 transition hover:text-white"}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
