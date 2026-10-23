import { getCollection } from 'astro:content';

export async function GET() {
  const posts = await getCollection('posts');
  const searchIndex = posts
    .sort((a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime())
    .map((post) => ({
      slug: post.slug,
      title: post.data.title,
      description: post.data.description,
      date: post.data.publishDate.toISOString().slice(0, 10),
      tags: post.data.tags,
      readTime: post.data.readTime,
    }));

  return new Response(JSON.stringify(searchIndex), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
