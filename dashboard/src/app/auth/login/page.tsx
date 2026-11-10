import { redirect } from 'next/navigation';
import { firstAccountOpen } from '@/lib/first-account';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  // A fresh desktop install has nobody to sign in yet: go straight to
  // creating the first account instead of showing a form that cannot succeed.
  if (firstAccountOpen()) redirect('/auth/register');
  return <LoginForm />;
}
