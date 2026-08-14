import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service';
import { ActivityEventEntity } from './entities/activity-event.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityEventEntity])],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
