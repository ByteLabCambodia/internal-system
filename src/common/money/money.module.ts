import { Global, Module } from '@nestjs/common';
import { MoneyService } from './money.service';

@Global()
@Module({
  providers: [MoneyService],
  exports: [MoneyService],
})
export class MoneyModule {}
