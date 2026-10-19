import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import NavTabs from '@/components/NavTabs';
import RunControls from '@/components/RunControls';
import DataProvider from '@/components/DataProvider';
import Loading from '@/components/Loading';

export const metadata: Metadata = {
  title: 'dependash',
  description: 'One dashboard for every Dependabot alert you can see',
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
          <DataProvider>
            <RunControls />
            <Suspense fallback={<Loading />}>{children}</Suspense>
          </DataProvider>
        </div>
      </body>
    </html>
  );
}
