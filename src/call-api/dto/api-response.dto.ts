import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Zod schema for API response containing validated URL.
 * Contains the url field returned from external API calls.
 */
const ApiResponseSchema = z
  .object({
    url: z.string().url().min(1).max(2083),
  })
  .describe("API response with URL");

/**
 * Data transfer object for API response containing validated URL.
 * Contains the url field returned from external API calls.
 */
export class ApiResponseDto extends createZodDto(ApiResponseSchema) {
  @ApiProperty({
    format: "uri",
    title: "Url",
  })
  url!: string;
}
