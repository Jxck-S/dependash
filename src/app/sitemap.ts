import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// Only the landing page is public; the dashboard pages need a sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL('/', siteUrl()).toString(), changeFrequency: 'monthly', priority: 1 }];
}
