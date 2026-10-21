import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Trends', alternates: { canonical: '/trends' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
