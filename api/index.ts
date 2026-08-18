import 'dotenv/config';
import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import expressLayouts from 'express-ejs-layouts';
import express from 'express';
import path from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import serverlessExpress from 'serverless-http';
import { AppModule } from '../src/app.module';
import validationOptions from '../src/utils/validation-options';
import { AllConfigType } from '../src/config/config.type';
import { ResolvePromisesInterceptor } from '../src/utils/serializer.interceptor';
import {
  MINIAPP_SHELL_PATH,
  WEB_ROUTE_PREFIXES,
} from '../src/common/web/web.constants';

/**
 * Vercel serverless entry point (zero-config: Vercel treats any file under /api as a
 * Node.js function and compiles its TypeScript itself, honoring this repo's tsconfig —
 * including emitDecoratorMetadata, which Nest's DI depends on). Mirrors main.ts's
 * bootstrap but never calls .listen() — Vercel hands requests to the exported handler
 * directly instead of a listening socket. The Nest app is built once per cold start and
 * cached across warm invocations of the same function instance.
 */
let cachedHandlerPromise: Promise<ReturnType<typeof serverlessExpress>>;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  app.useStaticAssets(path.join(__dirname, '..', 'public'));
  app.setBaseViewsDir(path.join(__dirname, '..', 'src', 'views'));
  app.setViewEngine('ejs');
  app.use(expressLayouts);
  app.set('layout', 'layouts/app');
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));

  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: WEB_ROUTE_PREFIXES.flatMap((prefix) =>
        prefix === '' ? ['/'] : [`/${prefix}`, `/${prefix}/{*splat}`],
      ).concat(['/resend-invite', `/${MINIAPP_SHELL_PATH}`]),
    },
  );
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalInterceptors(
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  const options = new DocumentBuilder()
    .setTitle('API')
    .setDescription('API docs')
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      in: 'header',
      required: false,
      name: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      schema: {
        example: 'en',
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);

  await app.init();

  return serverlessExpress(app.getHttpAdapter().getInstance());
}

export default async function handler(
  req: express.Request,
  res: express.Response,
) {
  // Cache the in-flight promise, not the resolved value — otherwise concurrent requests
  // arriving before the first bootstrap() finishes each see cachedHandler as still unset
  // and each kick off their own full Nest app boot (including a fresh DB connection),
  // multiplying cold-start cost instead of sharing it.
  if (!cachedHandlerPromise) {
    cachedHandlerPromise = bootstrap();
  }

  const cachedHandler = await cachedHandlerPromise;
  return cachedHandler(req, res);
}
