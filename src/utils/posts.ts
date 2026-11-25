import type { RSSFeedItem } from '@astrojs/rss';
import { getCollection, type CollectionEntry } from 'astro:content';
import { TOPICS, type Topic } from '../data/topics';

export type PostEntry = CollectionEntry<'posts'>;

const TOPIC_PRIORITY = [
  'cloud-native-delivery',
  'rpc-governance',
  'troubleshooting-opensource',
  'gis-spatial',
  'ai-agent-engineering',
  'java-distributed',
] as const;

/** Compare two posts in ascending publish order with series order and slug tie-breakers. */
export function comparePostsAsc(a: PostEntry, b: PostEntry): number {
  const dateDiff = a.data.publishDate.getTime() - b.data.publishDate.getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  if (a.data.series?.name && a.data.series.name === b.data.series?.name) {
    const orderDiff = a.data.series.order - b.data.series.order;
    if (orderDiff !== 0) {
      return orderDiff;
    }
  }

  return a.slug.localeCompare(b.slug, 'en');
}

/** Compare two posts in descending publish order with series order and slug tie-breakers. */
export function comparePostsDesc(a: PostEntry, b: PostEntry): number {
  return comparePostsAsc(b, a);
}

/** Fetch all non-draft posts sorted deterministically. */
export async function getPublishedPosts(order: 'desc' | 'asc' = 'desc'): Promise<PostEntry[]> {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const comparator = order === 'asc' ? comparePostsAsc : comparePostsDesc;
  return [...posts].sort(comparator);
}

/** Return all curated topics that include the given post slug. */
export function getPostTopics(slug: string): Topic[] {
  return TOPICS.filter((topic) => topic.postSlugs.includes(slug));
}

/** Return the primary topic for a post by specificity priority, falling back to the first match. */
export function getPrimaryTopic(slug: string): Topic | undefined {
  const postTopics = getPostTopics(slug);
  for (const topicSlug of TOPIC_PRIORITY) {
    const matched = postTopics.find((topic) => topic.slug === topicSlug);
    if (matched) {
      return matched;
    }
  }
  return postTopics[0];
}

/** Map post entries into RSS feed items. */
export function toRssItems(posts: PostEntry[]): RSSFeedItem[] {
  return posts.map((post) => ({
    title: post.data.title,
    pubDate: post.data.publishDate,
    description: post.data.description,
    link: `/post/${post.slug}/`,
  }));
}
