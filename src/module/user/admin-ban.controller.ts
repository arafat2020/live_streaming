import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BanService } from './ban.service';
import { BanUserDto } from './dto/ban-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { UserRole } from '@prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('admin/ban')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBanController {
    constructor(private readonly banService: BanService) { }

    @Get('search')
    async search(@Query('q') query: string) {
        return this.banService.searchUsers(query);
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
    async listBanned() {
        return this.banService.getBannedUsers();
    }
}
