import { z } from "zod";

export const batchOverrideRequestSchema = z
  .object({
    overrides: z
      .array(
        z.object({
          transactionId: z.string().min(1),
          categoryId: z.string().min(1),
          note: z.string().optional(),
          ruleAction: z.enum(["none", "suggest", "create"]).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine(({ overrides }, context) => {
    const seen = new Set<string>();
    overrides.forEach((override, index) => {
      if (seen.has(override.transactionId)) {
        context.addIssue({
          code: "custom",
          path: ["overrides", index, "transactionId"],
          message: "Each transaction can appear only once in a batch.",
        });
      }
      seen.add(override.transactionId);
    });
  });

export type BatchOverrideRequest = z.infer<typeof batchOverrideRequestSchema>;
