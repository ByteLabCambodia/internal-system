import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

/** Only used by the email-change confirmation; there is no sign-up confirmation flow. */
export class AuthConfirmEmailDto {
  @ApiProperty()
  @IsNotEmpty()
  hash: string;
}
