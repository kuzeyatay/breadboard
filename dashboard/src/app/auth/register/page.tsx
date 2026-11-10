import { firstAccountOpen } from '@/lib/first-account';
import RegisterForm from './register-form';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return <RegisterForm firstAccount={firstAccountOpen()} />;
}
