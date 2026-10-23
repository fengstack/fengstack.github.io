import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts');
  const siteUrl = context.site?.toString().replace(/\/$/, '') || 'https://blog.yunitytech.top';
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    { loc: `${siteUrl}/`, lastmod: today, priority: '1.0', changefreq: 'daily' },
    { loc: `${siteUrl}/post/`, lastmod: today, priority: '0.9', changefreq: 'daily' },
    { loc: `${siteUrl}/about/`, lastmod: today, priority: '0.8', changefreq: 'weekly' },
  ];

  const postUrls = posts
    .sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime())
    .map((post) => ({
      loc: `${siteUrl}/post/${post.slug}/`,
      lastmod: post.data.publishDate.toISOString().slice(0, 10),
      priority: '0.8',
      changefreq: 'weekly',
    }));

  const allUrls = [...staticUrls, ...postUrls];

  const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
