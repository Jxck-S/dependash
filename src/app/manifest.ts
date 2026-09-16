import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'dependash',
    short_name: 'dependash',
    description: 'Local-only Dependabot dashboard',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0f16',
    theme_color: '#0b0f16',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
