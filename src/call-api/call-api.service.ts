import { Injectable } from "@nestjs/common";
import axios from "axios";
import { ApiResponseDto } from "./dto/api-response.dto";

/**
 * Service for handling external API calls and data validation.
 * Provides methods for calling httpbin.org and returning validated responses.
 */
@Injectable()
export class CallApiService {
  /**
   * Calls external httpbin API and returns validated URL data.
   * @returns Promise of validated API response containing URL
   */
  async callHttpbin(): Promise<ApiResponseDto> {
    const { data } = await axios.get<{ url: string }>(
      "https://httpbin.org/get",
    );

    return {
      url: data.url,
    };
  }
}
