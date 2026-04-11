import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DeleteResult, UpdateResult } from "typeorm";
import { ExampleService } from "./example.service";
import { Example } from "./entities/example.entity";
import { CreateExampleDto } from "./dto/create-example.dto";
import { UpdateExampleDto } from "./dto/update-example.dto";
import { describe, test, beforeEach } from "node:test";
import * as assert from "assert";

describe("ExampleService", () => {
  let service: ExampleService;
  let mockRepository: {
    create: (dto: CreateExampleDto) => Example;
    save: (entity: Example) => Promise<Example>;
    find: () => Promise<Example[]>;
    findOne: (options: { where: { id: number } }) => Promise<Example | null>;
    update: (id: number, updateData: UpdateExampleDto) => Promise<UpdateResult>;
    delete: (id: number) => Promise<DeleteResult>;
  };

  beforeEach(async () => {
    mockRepository = {
      create: (dto: CreateExampleDto): Example =>
        ({ ...dto, id: 1 }) as Example,
      save: async (entity: Example): Promise<Example> =>
        Promise.resolve(entity),
      find: async (): Promise<Example[]> =>
        Promise.resolve([
          { id: 1, name: "example1" } as Example,
          { id: 2, name: "example2" } as Example,
        ]),
      findOne: (options: {
        where: { id: number };
      }): Promise<Example | null> => {
        const id = options.where.id;
        return id === 1
          ? Promise.resolve({ id: 1, name: "example1" } as Example)
          : Promise.resolve(null);
      },
      update: async (): Promise<UpdateResult> =>
        Promise.resolve({ affected: 1, raw: {}, generatedMaps: [] }),
      delete: async (): Promise<DeleteResult> =>
        Promise.resolve({ affected: 1, raw: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExampleService,
        {
          provide: getRepositoryToken(Example),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ExampleService>(ExampleService);
  });

  test("should create and save an example entity", async () => {
    // Arrange
    const createExampleDto: CreateExampleDto = { name: "bar" };
    const expected = { id: 1, name: "bar" };

    // Act
    const result = await service.create(createExampleDto);

    // Assert
    assert.deepStrictEqual(result, expected);
  });

  test("should return all example entities", async () => {
    // Act
    const result = await service.findAll();

    // Assert
    assert.strictEqual(Array.isArray(result), true);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.name, "example1");
    assert.strictEqual(result[1]!.name, "example2");
  });

  test("should find one example by id", async () => {
    // Act
    const result = await service.findOne(1);

    // Assert
    assert.strictEqual(result?.id, 1);
    assert.strictEqual(result?.name, "example1");
  });

  test("should return null when example not found", async () => {
    // Act
    const result = await service.findOne(999);

    // Assert
    assert.strictEqual(result, null);
  });

  test("should update example and return updated entity", async () => {
    // Arrange
    const updateExampleDto: UpdateExampleDto = { name: "updated example" };

    // Act
    const result = await service.update(1, updateExampleDto);

    // Assert
    assert.strictEqual(result?.id, 1);
    assert.strictEqual(result?.name, "example1");
  });

  test("should remove example and return true when successful", async () => {
    // Act
    const result = await service.remove(1);

    // Assert
    assert.strictEqual(result, true);
  });

  test("should return false when example to remove not found", async () => {
    // Arrange
    mockRepository.delete = async (): Promise<DeleteResult> =>
      Promise.resolve({ affected: 0, raw: {} });

    // Act
    const result = await service.remove(999);

    // Assert
    assert.strictEqual(result, false);
  });
});
