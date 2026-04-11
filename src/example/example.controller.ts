import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ExampleService } from "./example.service";
import { CreateExampleDto } from "./dto/create-example.dto";
import { UpdateExampleDto } from "./dto/update-example.dto";
import { Example } from "./entities/example.entity";
import { HTTPValidationError } from "../validation-error.dto";

/**
 * Controller for managing Example resources via REST API endpoints.
 */
@ApiTags("example")
@Controller("example")
export class ExampleController {
  /**
   * Initializes the ExampleController with the ExampleService dependency.
   * @param exampleService Service for handling Example business logic
   */
  constructor(private readonly exampleService: ExampleService) {}

  /**
   * Creates a new Example resource.
   * @param createExampleDto Data transfer object containing Example creation data
   * @returns Promise of the created Example entity
   */
  @Post()
  @ApiOperation({ summary: "Create", description: "Create a new example." })
  @ApiResponse({
    status: 200,
    description: "Successful Response",
    type: Example,
  })
  @ApiResponse({
    status: 422,
    description: "Validation Error",
    type: HTTPValidationError,
  })
  create(@Body() createExampleDto: CreateExampleDto): Promise<Example> {
    return this.exampleService.create(createExampleDto);
  }

  /**
   * Retrieves all Example resources from the database.
   * @returns Promise of array containing all Example entities
   */
  @Get()
  @ApiOperation({ summary: "Find All", description: "Find all example." })
  @ApiResponse({
    status: 200,
    description: "Successful Response",
    type: [Example],
  })
  async findAll(): Promise<Example[]> {
    return this.exampleService.findAll();
  }

  /**
   * Retrieves a specific Example resource by ID.
   * @param id Unique identifier of the Example resource
   * @returns Promise of the requested Example resource or null if not found
   */
  @Get(":id")
  @ApiOperation({ summary: "Find One", description: "Find one example by ID." })
  @ApiResponse({
    status: 200,
    description: "Successful Response",
    type: Example,
  })
  @ApiResponse({ status: 404, description: "Not Found" })
  @ApiResponse({
    status: 422,
    description: "Validation Error",
    type: HTTPValidationError,
  })
  async findOne(@Param("id") id: number): Promise<Example | null> {
    return await this.exampleService.findOne(+id);
  }

  /**
   * Updates an existing Example resource.
   * @param id Unique identifier of the Example resource to update
   * @param updateExampleDto Data transfer object containing updated Example data
   * @returns Promise of the updated Example entity or null if not found
   */
  @Patch(":id")
  @ApiOperation({ summary: "Update", description: "Update an example." })
  @ApiResponse({
    status: 200,
    description: "Successful Response",
    type: Example,
  })
  @ApiResponse({ status: 404, description: "Not Found" })
  @ApiResponse({
    status: 422,
    description: "Validation Error",
    type: HTTPValidationError,
  })
  async update(
    @Param("id") id: number,
    @Body() updateExampleDto: UpdateExampleDto,
  ): Promise<Example | null> {
    return this.exampleService.update(+id, updateExampleDto);
  }

  /**
   * Removes an Example resource by ID.
   * @param id Unique identifier of the Example resource to remove
   * @returns Promise of boolean indicating successful removal
   */
  @Delete(":id")
  @ApiOperation({ summary: "Remove", description: "Remove an example." })
  @ApiResponse({ status: 200, description: "Successful Response" })
  @ApiResponse({ status: 404, description: "Not Found" })
  @ApiResponse({
    status: 422,
    description: "Validation Error",
    type: HTTPValidationError,
  })
  async remove(@Param("id") id: number): Promise<boolean> {
    return this.exampleService.remove(+id);
  }
}
