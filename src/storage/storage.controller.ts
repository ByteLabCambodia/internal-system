import {
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { StorageService } from './storage.service';

const ALLOWED_PREFIXES = ['receipts', 'claims', 'profile'] as const;

export class CreateUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsIn(ALLOWED_PREFIXES as unknown as string[])
  prefix: string;
}

/**
 * Called by public/js/r2-upload.js just before the browser PUTs the file. It sits among the
 * page routes because the caller is a cookie-authenticated page, so it carries CSRF.
 */
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('sign')
  async sign(@Body() dto: CreateUploadUrlDto) {
    if (!this.storage.isConfigured) {
      throw new ServiceUnavailableException(
        'File storage is not configured on this environment.',
      );
    }

    return this.storage.createUploadUrl(
      dto.prefix,
      dto.fileName,
      dto.contentType,
    );
  }
}
