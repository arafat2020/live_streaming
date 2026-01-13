import { Controller, Get, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminDashboardService } from './admin-dashboard.service';
import sendResponse from '../../utils/sendResponse';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin Dashboard')
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
    constructor(private readonly adminDashboardService: AdminDashboardService) { }

    @ApiOperation({ summary: 'Get overview statistics for the admin dashboard' })
    @Get('stats')
    async getStats(@Res() res: Response) {
        const data = await this.adminDashboardService.getStats();
        return sendResponse(res, {
            statusCode: HttpStatus.OK,
            success: true,
            message: 'Admin dashboard statistics retrieved successfully',
            data,
        });
    }
    @ApiOperation({ summary: 'Get storage usage analytics' })
    @Get('storage')
    async getStorageStats(@Res() res: Response) {
        const data = await this.adminDashboardService.getStorageStats();
        return sendResponse(res, {
            statusCode: HttpStatus.OK,
            success: true,
            message: 'Storage analytics retrieved successfully',
            data,
        });
    }
}
