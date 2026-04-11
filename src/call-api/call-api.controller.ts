import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { CallApiService } from "./call-api.service";
import { ApiResponseDto } from "./dto/api-response.dto";

/**
 * Controller for handling external API calls via REST endpoints.
 */
@Controller("call-api")
export class CallApiController {
  /**
   * Initializes the CallApiController with the CallApiService dependency.
   * @param callApiService Service for handling external API calls
   */
  constructor(private readonly callApiService: CallApiService) {}

  /**
   * Calls external httpbin API and returns validated URL data.
   * @returns Promise of validated API response containing URL
   */
  @Get()
  @ApiOperation({
    summary: "Call Httpbin",
    description: "Calls external httpbin API and returns validated URL data",
  })
  @ApiResponse({
    status: 200,
    description: "Successful Response",
    type: ApiResponseDto,
  })
  async callHttpbin(): Promise<ApiResponseDto> {
    return this.callApiService.callHttpbin();
  }
}
