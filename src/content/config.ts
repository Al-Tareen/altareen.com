import { defineCollection, z } from "astro:content";

const toolkit = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    category: z.string().optional(),
    dbTitle: z.string().optional(),
    notionId: z.string().optional(),
    link: z.string().optional(),
  }),
});

export const collections = { toolkit };
