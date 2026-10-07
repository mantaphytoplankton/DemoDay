import { z } from "zod";

/** Machine-readable rubric metadata (agent-design.md section 4.3). */
export const RubricCategorySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Category id must be lowercase letters, digits or _"),
    name: z.string().min(1).max(60),
    short: z.string().min(1).max(4),
    weight: z.number().int().min(1).max(100),
    tiers: z.object({ "1": z.string().min(1), "3": z.string().min(1), "5": z.string().min(1) }).strict(),
  })
  .strict();

export const RubricMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    maxDurationSeconds: z.number().int().min(30).max(3600),
    categories: z.array(RubricCategorySchema).min(1).max(8),
  })
  .strict()
  .superRefine((meta, ctx) => {
    const ids = new Set<string>();
    const shorts = new Set<string>();
    meta.categories.forEach((c, i) => {
      if (ids.has(c.id)) ctx.addIssue({ code: "custom", path: ["categories", i, "id"], message: `Duplicate category id: ${c.id}` });
      if (shorts.has(c.short)) ctx.addIssue({ code: "custom", path: ["categories", i, "short"], message: `Duplicate short name: ${c.short}` });
      ids.add(c.id);
      shorts.add(c.short);
    });
  });

export type RubricCategory = z.infer<typeof RubricCategorySchema>;
export type RubricMeta = z.infer<typeof RubricMetaSchema>;
