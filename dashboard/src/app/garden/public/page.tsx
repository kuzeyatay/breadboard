import { redirect } from 'next/navigation';

export default function PublicGardenRedirect() {
  redirect('/garden?view=public');
}
