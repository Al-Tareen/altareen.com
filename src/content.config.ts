import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const toolkit = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/toolkit" }),
  schema: z.object({
    title: z.string(),
    primaryCategory: z.string().optional(),
    categories: z.array(z.string()).optional(),

    // card excerpt
    tags: z.array(z.string()).optional().default([]),
    whenToUse: z.string().optional(),
    whenToUseFull: z.string().optional(),

    // full fields (detail page)
    inputsRequired: z.string().optional(),
    outputArtifact: z.string().optional(),
    commonMistakes: z.string().optional(),

    dbTitle: z.string().optional(),
    notionId: z.string().optional(),
    link: z.string().optional(),
    cover: z.string().optional(),

    files: z
      .array(
        z.object({
          name: z.string().optional(),
          url: z.string(),
        })
      )
      .optional(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string().optional(),
    project: z.string().optional(),
    primaryCategory: z.string().optional(),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    description: z.string().optional(),
    summary: z.string().optional(),
    excerpt: z.string().optional(),
    dbTitle: z.string().optional(),
    notionId: z.string().optional(),
    link: z.string().optional(),
    url: z.string().optional(),
    logo: z.string().optional(),
    cover: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    comingSoon: z.boolean().optional(),
    position: z.number().optional(),
    files: z
      .array(
        z.object({
          name: z.string().optional(),
          url: z.string(),
        })
      )
      .optional(),
  }),
});

export const collections = { toolkit, projects };
