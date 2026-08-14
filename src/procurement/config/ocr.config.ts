import { registerAs } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { OcrConfig } from './ocr-config.type';

class EnvironmentVariablesValidator {
  // Optional: without a key, receipt OCR degrades to "fill it in by hand".
  @IsOptional()
  @IsString()
  OCR_SPACE_API_KEY?: string;
}

export default registerAs<OcrConfig>('ocr', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    apiKey: process.env.OCR_SPACE_API_KEY,
  };
});
