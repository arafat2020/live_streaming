import { Controller, Get, Param, UseGuards, Res, HttpStatus } from '@nestjs/common';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import sendResponse from '../../utils/sendResponse';

@ApiTags('Admin Stream Management')
@Controller('admin/streams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminStreamsController {
    constructor(private readonly cfService: CloudflareService) { }

    @ApiOperation({ summary: 'Admin: Get real-time health for a live stream' })
    @ApiParam({ name: 'inputId', description: 'Cloudflare live input ID' })
    @Get(':inputId/health')
    async getStreamHealth(@Param('inputId') inputId: string, @Res() res: Response) {
        const data = await this.cfService.getLiveInputHealth(inputId);
        return sendResponse(res, {
            statusCode: HttpStatus.OK,
            success: true,
            message: 'Stream health data retrieved successfully',
            data,
        });
    }
}
