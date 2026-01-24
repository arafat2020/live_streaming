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
    path.join(process.cwd(), 'media'),
    path.join(process.cwd(), 'media', 'live'),
  ];

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // ✅ Increase payload limits for large video metadata/chunks
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigins = [
        'http://localhost:5173',
        'https://rappio-tv.netlify.app',
        'https://rappio.tv',
      ];
      // Allow requests with no origin (like mobile apps or curl)
      if (
        !origin ||
        allowedOrigins.indexOf(origin) !== -1 ||
        origin.includes('localhost')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Serve HLS files from uploads
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Serve live stream HLS files
  app.use(
    '/media',
    express.static(path.join(process.cwd(), 'media'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/mp2t');
        }
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  setupSwagger(app);
  const port = process.env.PORT || 8000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Error during bootstrap:', err);
  process.exit(1);
});
