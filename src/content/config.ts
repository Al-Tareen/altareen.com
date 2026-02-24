import { defineCollection, z } from "astro:content";

const toolkit = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    primaryCategory: z.string().optional(),
    categories: z.array(z.string()).optional(),

    // card excerpt
    tags: z.array(z.string()).optional().default([]), 
    whenToUse: z.string().optional(),
    whenToUseFull: z.string().optional(),   // ✅ ADD THIS

    // full fields (detail page)
    inputsRequired: z.string().optional(),
    outputArtifact: z.string().optional(),
    commonMistakes: z.string().optional(),

    dbTitle: z.string().optional(),
    notionId: z.string().optional(),
    link: z.string().optional(),
    cover: z.string().optional(),

    // ✅ IMPORTANT
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

export const collections = { toolkit };
