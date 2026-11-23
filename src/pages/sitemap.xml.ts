import type { APIContext } from 'astro';
import { SITE } from '../data/site';
import { TOPICS } from '../data/topics';
import { getPublishedPosts } from '../utils/posts';

export async function GET(context: APIContext) {
  const allPosts = await getPublishedPosts();
  const siteUrl = (context.site?.toString() || SITE.url).replace(/\/$/, '');

  const sortedPosts = [...allPosts].sort((a, b) => {
    const aTime = (a.data.updatedDate || a.data.publishDate).getTime();
    const bTime = (b.data.updatedDate || b.data.publishDate).getTime();
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return b.slug.localeCompare(a.slug, 'en');
  });

  const latestPostDate = sortedPosts[0]
    ? (sortedPosts[0].data.updatedDate || sortedPosts[0].data.publishDate).toISOString().slice(0, 10)
    : '2026-10-26';

  const staticUrls = [
    { loc: `${siteUrl}/`, lastmod: latestPostDate, priority: '1.0', changefreq: 'daily' },
    { loc: `${siteUrl}/post/`, lastmod: latestPostDate, priority: '0.9', changefreq: 'daily' },
    { loc: `${siteUrl}/topic/`, lastmod: latestPostDate, priority: '0.8', changefreq: 'weekly' },
    { loc: `${siteUrl}/about/`, lastmod: '2026-10-23', priority: '0.7', changefreq: 'monthly' },
  ];

  // Curated Topic pages
  const topicUrls = TOPICS.map((topic) => {
    const topicPosts = sortedPosts.filter((p) => topic.postSlugs.includes(p.slug));
    const topicLatestDate = topicPosts[0]
      ? (topicPosts[0].data.updatedDate || topicPosts[0].data.publishDate).toISOString().slice(0, 10)
      : latestPostDate;

    return {
      loc: `${siteUrl}/topic/${topic.slug}/`,
      lastmod: topicLatestDate,
      priority: '0.8',
      changefreq: 'weekly',
    };
  });

  // Post pages
  const postUrls = sortedPosts.map((post) => ({
    loc: `${siteUrl}/post/${post.slug}/`,
    lastmod: (post.data.updatedDate || post.data.publishDate).toISOString().slice(0, 10),
    priority: '0.8',
    changefreq: 'monthly',
  }));

  const allUrls = [...staticUrls, ...topicUrls, ...postUrls];

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
