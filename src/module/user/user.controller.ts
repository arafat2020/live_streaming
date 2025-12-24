import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  Res,
  UseGuards,
  HttpStatus,
  Delete,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { GetMe, RequestWithUser } from './dto/request-with-user.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { Request, Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { UpdateMyProfileDto } from './dto/update-myprofile-dto';
import { Roles } from '../auth/guards/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @ApiOperation({ summary: 'Get all Users' })
  @Get()
  async findAll(@Req() req: RequestWithUser,@Res() res: Response) {
    const data= await this.userService.findAll();
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Users retrieve successfully.',
      data,
    });
  }

  // STATIC route first
  @UseGuards(JwtAuthGuard)
  @Get('get-me')
  @ApiOperation({
    summary: 'Retrieve the profile of the authenticated user.',
    description:
      'Returns the full profile details of the currently logged-in user based on the JWT token.',
  })
  getMe(@Req() req: GetMe, @Res() res: Response) {
    const user = req.user;
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'GetME Retrieve successfully.',
      data: user,
    });
  }
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve User by ID' })
  @ApiResponse({ status: 200, description: 'The requested User.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async findOne(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const data = await this.userService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User Retrieve successfully.',
      data,
    });
  }
  @ApiOperation({ summary: 'Allows only ADMIN to update a user’s role or status' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Res() res: Response) {
    const data = await this.userService.update(id, dto);
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'User updated successfully.',
      data,
    });
  }

  // @ApiOperation({ summary: 'update my profile' })
  // @Patch(':id')
  // async myProfile(@Param('id') id: string,@Body() dto: UpdateMyProfileDto,@Req() req: RequestWithUser, @Res() res: Response) {
  //   const data = await this.userService.myProfile(id, dto);
  //   return sendResponse(res, {
  //     statusCode: HttpStatus.CREATED,
  //     success: true,
  //     message: 'Profile updated successfully.',
  //     data,
  //   });
  // }
@ApiOperation({ summary: 'Update profile with image' })
@ApiConsumes('multipart/form-data')
@ApiBody({
  schema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'Profile image (JPG, PNG, WEBP - Max 5MB)',
      },
      email: {
        type: 'string',
        example: 'user@gmail.com',
      },
      firstName: {
        type: 'string',
        example: 'Sarah',
      },
      lastName: {
        type: 'string',
        example: 'Connor',
      },
      phone: {
        type: 'string',
        example: '0190000000',
      },
    },
  },
})
@Patch(':id')
@UseInterceptors(FileInterceptor('file'))
async uploadProfileImage(
  @Param('id') id: string,
  @UploadedFile() file: Express.Multer.File,
  @Body() dto: UpdateMyProfileDto,
  @Res() res: Response,
) {
  const data = await this.userService.myProfile(id, dto, file);

  return sendResponse(res, {
    statusCode: HttpStatus.OK,
    success: true,
    message: 'Profile updated successfully.',
    data,
  });
}


  @Delete(':id')
  async remove(@Param('id') id: string, @Res() res: Response) {
    const data = await this.userService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User deleted successfully.',
      data,
    })
  }
}
