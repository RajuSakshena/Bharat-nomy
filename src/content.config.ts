import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const research = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/research' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    authors: z.array(z.string()).min(1),
    summary: z.string(),
    category: z.string().transform(val => val.toLowerCase() as 'law' | 'economics' | 'policy' | 'finance'),
    tags: z.array(z.string()).default([]),
    citations: z.array(z.object({
      id: z.number(),
      text: z.string(),
    })).default([]),
    status: z.enum(['draft', 'published', 'Draft', 'Published']).default('published').transform(val => val.toLowerCase() as 'draft' | 'published'),
  }),
});

const datasets = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/datasets' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    source: z.string(),
    sourceUrl: z.string().optional(),
    format: z.enum(['csv', 'json', 'pdf']),
    file: z.string(),
    date: z.coerce.date(),
    category: z.string(),
    license: z.string().default('CC-BY-4.0'),
    methodology: z.string().optional(),
  }),
});

export const collections = { research, datasets };
