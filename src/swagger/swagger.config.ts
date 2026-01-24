import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Rappio-TV API Documentation')
  .setDescription(
    'Comprehensive API documentation for the application services',
  )
  .setVersion('1.0')
  .addCookieAuth('refreshToken')
  .addTag('API')
  .addApiKey(
    {
      type: 'apiKey',
      name: 'authorization',
      in: 'header',
    },
    'auth',
  )
  .addSecurityRequirements({
    auth: [],
  })
  .build();
