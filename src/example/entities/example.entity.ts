import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Example entity representing data stored in the example table.
 * Contains a name field for storing string values.
 */
@Entity()
export class Example {
  /**
   * Auto-generated primary key for the Example entity.
   */
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * Name field storing string values for the Example entity.
   */
  @ApiProperty()
  @Column()
  name!: string;
}
