import { askPasswordAtStartup, localOwner } from '@/lib/first-account';
import LoginForm from './login-form';
import SetupForm from './setup-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const owner = localOwner();
  if (!owner) return <SetupForm />;
  return <LoginForm name={owner.name} auto={!askPasswordAtStartup(owner.id)} />;
}
