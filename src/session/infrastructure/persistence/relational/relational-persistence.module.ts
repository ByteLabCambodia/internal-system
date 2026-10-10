import { Module } from '@nestjs/common';
import { SessionRepository } from '../session.repository';
import { SessionRelationalRepository } from './repositories/session.repository';

@Module({
  providers: [
    {
      provide: SessionRepository,
      useClass: SessionRelationalRepository,
    },
  ],
  exports: [SessionRepository],
})
export class RelationalSessionPersistenceModule {}
