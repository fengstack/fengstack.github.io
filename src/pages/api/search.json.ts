import { getPublishedPosts } from '../../utils/posts';

export async function GET() {
  const posts = await getPublishedPosts();
  const searchIndex = posts.map((post) => ({
    slug: post.slug,
    title: post.data.title,
    description: post.data.description,
    date: post.data.publishDate.toISOString().slice(0, 10),
    tags: post.data.tags,
    readTime: post.data.readTime,
    series: post.data.series?.name,
  }));

  return new Response(JSON.stringify(searchIndex), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
