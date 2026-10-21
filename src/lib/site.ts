/**
 * Public site details shared by page metadata, robots.txt and the sitemap.
 *
 * The origin comes from DEPENDASH_URL when set, then Vercel's production
 * domain, so a self-hosted copy advertises its own URL rather than ours.
 */

export const SITE_NAME = 'dependash';
export const SITE_TITLE = 'dependash — every Dependabot alert, one dashboard';
export const SITE_DESCRIPTION =
  'One dashboard for every Dependabot alert you can see — across personal, org and collaborator ' +
  'repos. Trends, MTTR and risk scores from a single read-only fetch. Free and open source.';
export const REPO_URL = 'https://github.com/Jxck-S/dependash';

export function siteUrl(): URL {
  const explicit = process.env.DEPENDASH_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL('http://localhost:3939');
}
