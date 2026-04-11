import { ApiProperty } from "@nestjs/swagger";

/**
 * Individual validation error details
 */
export class ValidationError {
  @ApiProperty({
    description: "Location of the error (field path)",
    type: "array",
    items: {
      anyOf: [{ type: "string" }, { type: "integer" }],
    },
    example: ["body", "name"],
  })
  loc!: (string | number)[];

  @ApiProperty({
    description: "Human-readable error message",
    example: "field required",
  })
  msg!: string;

  @ApiProperty({
    description: "Type of validation error",
    example: "value_error.missing",
  })
  type!: string;
}

/**
 * HTTP validation error response
 */
export class HTTPValidationError {
  @ApiProperty({
    description: "Array of validation error details",
    type: [ValidationError],
  })
  detail!: ValidationError[];
}
