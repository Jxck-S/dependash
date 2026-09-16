import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import NavTabs from '@/components/NavTabs';
import RunControls from '@/components/RunControls';

export const metadata: Metadata = {
  title: 'dependash',
  description: 'Local-only Dependabot dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <h1>
              <Link href="/" style={{ color: 'var(--text)' }}>
                dependash
              </Link>
            </h1>
            <Suspense fallback={<nav className="tabs" />}>
              <NavTabs />
            </Suspense>
          </header>
          <RunControls />
          {children}
        </div>
      </body>
    </html>
  );
}
