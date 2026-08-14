'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useSyncExternalStore } from 'react';
import { backLabelFor, consumeBackTo, resolveBackHref, subscribeToTrail } from '@/lib/nav-history';

interface Props {
  /** Where to go when this tab has no recorded previous page (deep link, reload). */
  fallbackHref: string;
  fallbackLabel: string;
  className?: string;
}

const DEFAULT_CLASS =
  'text-gray-500 hover:text-white transition-colors text-sm flex items-center gap-1.5 shrink-0';

/**
 * A back control that returns to the page the user actually arrived from,
 * falling back to a fixed parent when the trail cannot answer.
 */
export default function BackLink({ fallbackHref, fallbackLabel, className }: Props) {
  const pathname = usePathname();

  // The trail is read relative to wherever we are standing, so a route change
  // has to produce a fresh snapshot even when the trail itself is unchanged.
  const getSnapshot = useCallback(
    () => resolveBackHref(pathname, fallbackHref),
    [fallbackHref, pathname],
  );
  const getServerSnapshot = useCallback(() => fallbackHref, [fallbackHref]);

  const href = useSyncExternalStore(subscribeToTrail, getSnapshot, getServerSnapshot);
  const label = href === fallbackHref ? fallbackLabel : backLabelFor(href, fallbackLabel);

  return (
    <Link
      href={href}
      onClick={() => consumeBackTo(href)}
      className={className ?? DEFAULT_CLASS}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
      </svg>
      {label}
    </Link>
  );
}
