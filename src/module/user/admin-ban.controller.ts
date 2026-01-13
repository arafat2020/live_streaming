import { Controller, Get, Post, Body, Param, Query, UseGuards, Delete } from '@nestjs/common';
import { BanService } from './ban.service';
import { BanUserDto } from './dto/ban-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('AdminBan')
@Controller('admin/ban')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBanController {
    constructor(private readonly banService: BanService) { }

    @Get('search')
    @ApiOperation({ summary: 'Search users for banning with pagination' })
    @ApiQuery({ name: 'q', required: false, description: 'Search query (email, name, or ID)' })
    async search(
        @Query('q') query: string,
        @Query() pagination: PaginationDto
    ) {
        return this.banService.searchUsers(query, pagination.page, pagination.limit);
    }

    @Post(':userId')
    async ban(
        @Param('userId') userId: string,
        @Body() dto: BanUserDto,
        @GetUser('id') adminId: string,
    ) {
        return this.banService.banUser(userId, adminId, dto);
    }

    @Post(':userId/unban')
    async unban(@Param('userId') userId: string) {
        return this.banService.unbanUser(userId);
    }

    @Get('list')
    @ApiOperation({ summary: 'Get all banned users with pagination' })
    async listBanned(@Query() pagination: PaginationDto) {
        return this.banService.getBannedUsers(pagination.page, pagination.limit);
    }

    @Delete(':userId')
    @ApiOperation({ summary: 'Permanently delete a user' })
    async deleteUser(@Param('userId') userId: string) {
        return this.banService.deleteUser(userId);
    }
}
