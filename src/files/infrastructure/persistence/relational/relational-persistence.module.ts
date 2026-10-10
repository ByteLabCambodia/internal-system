import { Module } from '@nestjs/common';
import { FileRepository } from '../file.repository';
import { FileRelationalRepository } from './repositories/file.repository';

@Module({
  providers: [
    {
      provide: FileRepository,
      useClass: FileRelationalRepository,
    },
  ],
  exports: [FileRepository],
})
export class RelationalFilePersistenceModule {}
