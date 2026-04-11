import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreateExampleDto } from "./dto/create-example.dto";
import { UpdateExampleDto } from "./dto/update-example.dto";
import { Example } from "./entities/example.entity";

/**
 * Service for handling Example resource business logic and data operations.
 * Uses TypeORM repository for database persistence.
 */
@Injectable()
export class ExampleService {
  /**
   * Initializes the ExampleService with the Example repository dependency.
   * @param exampleRepository TypeORM repository for Example entity database operations
   */
  constructor(
    @InjectRepository(Example)
    private readonly exampleRepository: Repository<Example>,
  ) {}

  /**
   * Creates a new Example resource and persists it to the database.
   * @param createExampleDto Data transfer object containing Example creation data
   * @returns Promise of the created Example entity
   */
  async create(createExampleDto: CreateExampleDto): Promise<Example> {
    const example = this.exampleRepository.create(createExampleDto);
    return await this.exampleRepository.save(example);
  }

  /**
   * Retrieves all Example resources from the database.
   * @returns Promise of array containing all Example entities
   */
  async findAll(): Promise<Example[]> {
    return await this.exampleRepository.find();
  }

  /**
   * Retrieves a specific Example resource by its ID from the database.
   * @param id Numeric identifier of the Example resource to retrieve
   * @returns Promise of the Example entity or null if not found
   */
  async findOne(id: number): Promise<Example | null> {
    return await this.exampleRepository.findOne({ where: { id } });
  }

  /**
   * Updates an existing Example resource with new data.
   * @param id Numeric identifier of the Example resource to update
   * @param updateExampleDto Data transfer object containing updated Example data
   * @returns Promise of the updated Example entity or null if not found
   */
  async update(
    id: number,
    updateExampleDto: UpdateExampleDto,
  ): Promise<Example | null> {
    await this.exampleRepository.update(id, updateExampleDto);
    return await this.findOne(id);
  }

  /**
   * Removes an Example resource from the system.
   * @param id Numeric identifier of the Example resource to remove
   * @returns Promise of boolean indicating successful removal
   */
  async remove(id: number): Promise<boolean> {
    const result = await this.exampleRepository.delete(id);
    return (result.affected ?? 0) > 0;
  }
}
