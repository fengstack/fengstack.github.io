import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts');
  const sorted = posts.sort(
    (a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime()
  );

  return rss({
    title: "高云峰的技术文章与开源博客",
    description: "专注 Java RPC 框架治理、分布式系统与事务、现代 AI Agent 编程实践（SDD/TDD）、数据库与开源实战。",
    site: context.site!,
    items: sorted.map((post) => ({
      title: post.data.title,
      pubDate: post.data.publishDate,
      description: post.data.description,
      link: `/post/${post.slug}/`,
    })),
    customData: `<language>zh-cn</language>`,
  });
}
