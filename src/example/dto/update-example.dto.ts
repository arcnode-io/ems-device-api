import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Zod schema for updating an Example entity.
 * All fields are optional for partial updates.
 */
const UpdateExampleSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("Name field for the Example entity")
    .optional(),
});

/**
 * Data transfer object for updating an Example entity.
 * Contains optional fields for partial updates.
 */
export class UpdateExampleDto extends createZodDto(UpdateExampleSchema) {}
