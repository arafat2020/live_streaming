import { SetMetadata } from '@nestjs/common';

export const SkipTermsCheck = () => SetMetadata('skipTermsCheck', true);