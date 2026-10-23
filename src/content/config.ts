import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    readTime: z.string().optional(),
    series: z
      .object({
        name: z.string(),
        order: z.number(),
      })
      .optional(),
    refLink: z
      .object({
        text: z.string(),
        url: z.string(),
      })
      .optional(),
  }),
});

export const collections = {
  posts,
};
