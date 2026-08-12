'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { recordVisit } from '@/lib/nav-history';

/**
 * Records every in-app location so back controls can return to where the user
 * came from. Mounted once in the root layout; renders nothing.
 */
export default function NavigationTrail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    recordVisit(`${pathname}${search ? `?${search}` : ''}`);
  }, [pathname, search]);

  return null;
}
