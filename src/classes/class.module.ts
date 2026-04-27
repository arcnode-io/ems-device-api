import { Module } from "@nestjs/common";
import { ClassService } from "./class.service";

/** Class catalog module — loads + serves device class definitions. */
@Module({
  providers: [ClassService],
  exports: [ClassService],
})
export class ClassModule {}
