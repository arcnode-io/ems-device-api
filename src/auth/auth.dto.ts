import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Login DTO with OpenAPI metadata via createZodDto. */
export class LoginRequestDto extends createZodDto(LoginRequestSchema) {}

export interface LoginResponse {
  token: string;
}

export interface MqttCredentialsResponse {
  username: string;
  password: string;
  url: string;
}
