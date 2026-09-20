import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import db from '@/lib/db';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = db
          .prepare('SELECT * FROM users WHERE email = ?')
          .get(credentials.email.toLowerCase().trim()) as
          | { id: number; username: string | null; email: string; password_hash: string; created_at: string }
          | undefined;

        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;

        return {
          id: String(user.id), email: user.email, name: user.username ?? user.email,
          passwordVersion: createHash('sha256').update(user.password_hash).digest('hex'),
        };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/auth/login' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      const userId = Number(token.id ?? token.sub);
      const current = Number.isSafeInteger(userId) && userId > 0
        ? db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
          { password_hash: string } | undefined
        : undefined;
      const passwordVersion = current
        ? createHash('sha256').update(current.password_hash).digest('hex')
        : undefined;
      const authenticatedVersion = user
        ? (user as { passwordVersion?: string }).passwordVersion
        : token.passwordVersion;
      if (!passwordVersion || authenticatedVersion !== passwordVersion) {
        // NextAuth clears the session cookie when JWT validation throws. This
        // also invalidates sessions minted before password-version binding.
        throw new Error('Session expired. Please sign in again.');
      }
      token.passwordVersion = passwordVersion;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const tokenId = typeof token.id === 'string' ? token.id : token.sub;
        (session.user as Record<string, unknown>).id = tokenId;

        if (tokenId) {
          const user = db
            .prepare('SELECT username, email FROM users WHERE id = ?')
            .get(Number(tokenId)) as { username: string | null; email: string } | undefined;

          session.user.name = user?.username ?? (typeof token.name === 'string' ? token.name : null);
          session.user.email = user?.email ?? session.user.email;
        }
      }
      return session;
    },
  },
};
