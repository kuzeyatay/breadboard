import { RouteError } from '@/lib/server-auth';
import type { GestureControl } from './preferences';

export function requestGestureControl(request?: Request): GestureControl {
  const control = request ? new URL(request.url).searchParams.get('control') : null;
  if (control === null || control === 'clap') return 'clap';
  if (control === 'snap') return 'snap';
  throw new RouteError(400, 'Choose clap or finger-snap controls.');
}
