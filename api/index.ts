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

// Every `response.redirect(url)` call across this app (60+ call sites — login,
// create/cancel/submit actions, etc.) relies on Express's implicit default status, which
// is 302 — a Post/Redirect/Get pattern that needs the browser to switch to GET on the
// follow-up. Confirmed via curl and DevTools that Vercel's platform coerces *any* redirect
// status our function sends (tried the implicit 302, then an explicit 303 — both) into
// 307 on the wire, which preserves the original method instead of switching to GET. A
// POST action's redirect to a GET-only view route then gets replayed as POST and 404s
// ("Cannot POST /purchase-requests/4"). Since no status code survives whatever is doing
// that, don't use an HTTP redirect status at all: send a normal 200 HTML page that
// navigates the browser via <meta refresh> + a JS fallback. That's not a "redirect" from
// the protocol's perspective, so there's nothing for Vercel's platform to coerce — the
// follow-up navigation is always a fresh top-level GET, unconditionally.
//
// A prototype-level patch (mutating express.response.redirect once at module load) looked
// right in an isolated test but silently didn't take effect once actually deployed —
// Vercel's bundler almost certainly tree-shook that bare property assignment away since
// nothing visibly depends on it. Overriding res.redirect as an own-property inside real
// middleware avoids that: Express calls this function for every request, so a bundler has
// no way to prove it's unused and can't drop it.
function noRedirectStatusMiddleware(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  res.redirect = ((url: string) => {
    const escaped = url.replace(/"/g, '&quot;');
    res.status(200);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(
      `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${escaped}">` +
        `<script>location.replace(${JSON.stringify(url)})</script></head>` +
        `<body>Redirecting… <a href="${escaped}">Continue</a></body></html>`,
    );
    return res;
  }) as unknown as typeof res.redirect;

  next();
}

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
  app.use(noRedirectStatusMiddleware);

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
