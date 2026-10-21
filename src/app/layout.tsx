import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';
import DataProvider from '@/components/DataProvider';
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from '@/lib/site';

// Share images come from opengraph-image.png / twitter-image.png next to this file.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'Dependabot',
    'Dependabot alerts',
    'GitHub security',
    'vulnerability dashboard',
    'dependency vulnerabilities',
    'CVE',
    'GHSA',
    'MTTR',
    'open source',
  ],
  authors: [{ name: 'Jack Sweeney', url: 'https://github.com/Jxck-S' }],
  creator: 'Jack Sweeney',
  category: 'technology',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  other: { 'source-code': REPO_URL },
};

export const viewport: Viewport = {
  themeColor: '#0b0f16',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </body>
    </html>
  );
}
