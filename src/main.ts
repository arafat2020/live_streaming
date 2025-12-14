import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { setupSwagger } from './swagger/swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const dirs = [
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'uploads', 'videos'),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: ['http://localhost:5173', '*'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Serve HLS files
  app.use(
    '/uploads',
    express.static(path.join(process.cwd(), 'uploads')),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  // Swagger setup
  setupSwagger(app);
  const port = process.env.PORT || 8000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap();
