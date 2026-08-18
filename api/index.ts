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
// Express loads the view engine dynamically (`require(engine)` built from the
// 'view engine' setting string), which Vercel's dependency tracer can't follow — so it
// silently drops `ejs` from the deployed bundle despite it being a direct dependency.
// This unused import forces the tracer to see it and include it.
import 'ejs';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
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
 *
 * No serverless-http here: that package translates AWS Lambda/API-Gateway-style event
 * objects into an Express-compatible request — it isn't in serverless-http's own list of
 * supported providers, and Vercel's Node.js runtime already hands us real req/res
 * objects. Wrapping them through serverless-http fed it a shape it doesn't understand,
 * which hung forever instead of erroring. An Express app instance is itself a valid
 * (req, res) handler, so it can be called directly.
 */
let cachedAppPromise: Promise<express.Express>;

async function bootstrap(): Promise<express.Express> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  // Every response defaults to no-store — this is a cookie/session-driven app, not a
  // static site, and neither Vercel's edge cache nor the browser should ever cache a
  // redirect or rendered page here. Registered before useStaticAssets so its own
  // middleware (which runs next) still sets its own correct caching headers for actual
  // static files, overriding this default for just those responses.
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );

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

  return app.getHttpAdapter().getInstance();
}

export default async function handler(
  req: express.Request,
  res: express.Response,
) {
  // Cache the in-flight promise, not the resolved value — otherwise concurrent requests
  // arriving before the first bootstrap() finishes each see cachedAppPromise as still
  // unset and each kick off their own full Nest app boot (including a fresh DB
  // connection), multiplying cold-start cost instead of sharing it.
  if (!cachedAppPromise) {
    cachedAppPromise = bootstrap();
  }

  const expressApp = await cachedAppPromise;
  return expressApp(req, res);
}
