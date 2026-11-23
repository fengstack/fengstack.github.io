import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../data/site';
import { getPublishedPosts, toRssItems } from '../utils/posts';

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();

  return rss({
    title: SITE.rssTitle,
    description: SITE.rssDescription,
    site: context.site ?? SITE.url,
    items: toRssItems(posts),
    customData: `<language>zh-cn</language>`,
  });
}
