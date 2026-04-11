import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Zod schema for creating an Example entity.
 * Contains the name field provided by request.
 */
const CreateExampleSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("Name field for the Example entity"),
});

/**
 * Data transfer object for creating an Example entity.
 * Contains the name field provided by request.
 */
export class CreateExampleDto extends createZodDto(CreateExampleSchema) {}
