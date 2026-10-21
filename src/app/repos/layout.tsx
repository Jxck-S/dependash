import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Repositories', alternates: { canonical: '/repos' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
