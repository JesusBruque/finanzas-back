import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import express from 'express';
import { AppModule } from '../src/app.module';

let cachedHandler: ((req: Request, res: Response) => void) | null = null;

async function bootstrap() {
  if (cachedHandler) {
    return cachedHandler;
  }

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  app.enableCors({
    origin: true,
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  cachedHandler = server;
  return cachedHandler;
}

export default async function handler(req: Request, res: Response) {
  const appHandler = await bootstrap();
  return appHandler(req, res);
}
