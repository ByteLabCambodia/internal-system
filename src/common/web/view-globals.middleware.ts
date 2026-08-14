import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { AllConfigType } from '../../config/config.type';
import { takeFlash } from './flash';

/** Everything every template can rely on existing, set before the guard runs. */
@Injectable()
export class ViewGlobalsMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  use(request: Request, response: Response, next: NextFunction) {
    response.locals.appName =
      this.configService.get('app.name', { infer: true }) ?? 'Operations';
    response.locals.currentPath = request.path;
    response.locals.currentUser = null;
    response.locals.roleName = '';
    response.locals.can = {};
    response.locals.flash = takeFlash(request, response);

    next();
  }
}
