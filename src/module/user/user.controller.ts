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
  UploadedFile,
  UseInterceptors,
  Post,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { GetMe, RequestWithUser } from './dto/request-with-user.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { Request, Response } from 'express';
import sendResponse from '../../utils/sendResponse';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

import { UpdateMyProfileDto } from './dto/update-myprofile-dto';
import { Roles } from '../auth/guards/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AcceptTermsDto } from './dto/user-confirmation.dto';
import { TermsAcceptedGuard } from 'src/common/guards/terms-accepted.guard';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('check-availability')
  @ApiOperation({ summary: 'Check username availability' })
  async checkUsernameAvailability(
    @Query('username') username: string,
    @Res() res: Response,
  ) {
    if (!username || username.length < 3) {
      return sendResponse(res, {
        statusCode: HttpStatus.BAD_REQUEST,
        success: false,
        message: 'Username must be at least 3 characters long',
        data: { available: false },
      });
    }

    const isAvailable =
      await this.userService.checkUsernameAvailability(username);

    const userData = { available: isAvailable };

    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: isAvailable
        ? 'Username is available'
        : 'Username is already taken',
      data: userData,
    });
  }

  @ApiOperation({ summary: 'Get all Users' })
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.ADMIN)
  async findAll(@Req() req: RequestWithUser, @Res() res: Response) {
    const data = await this.userService.findAll();
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'Users retrieve successfully.',
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('accept-terms')
  @ApiOperation({ summary: 'Accept Terms of Service and Privacy Policy' })
  async acceptTerms(
    @Req() req: GetMe,
    @Body() dto: AcceptTermsDto,
    @Res() res: Response,
  ) {
    const data = await this.userService.acceptTermsAndConditions(
      req.user.id,
      dto,
    );
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User Accept Terms and Conditions successfully.',
      data,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('terms-status')
  //@ApiBearerAuth()
  @ApiOperation({ summary: 'Get terms acceptance status' })
  async getTermsStatus(@Req() req: GetMe) {
    //console.log("getTermsStatus hit ---------------------->")
    return this.userService.getTermsStatus(req.user.id);
  }

  // @Get('terms-status')
  // @UseGuards(JwtAuthGuard)
  // @SkipTermsCheck()
  // @ApiBearerAuth()
  // @ApiOperation({ summary: 'Get terms acceptance status' })
  // async getTermsStatus(@Req() req: any) {
  //   return this.userService.getTermsStatus(req.user.id);
  // }

  // STATIC route first
  @UseGuards(JwtAuthGuard, TermsAcceptedGuard)
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
  // @UseGuards(JwtAuthGuard,TermsAcceptedGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve User by ID' })
  @ApiResponse({ status: 200, description: 'The requested User.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = await this.userService.findOne(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User Retrieve successfully.',
      data,
    });
  }
  @ApiOperation({
    summary: 'Allows only ADMIN to update a user’s role or status',
  })
  @UseGuards(JwtAuthGuard, RolesGuard, TermsAcceptedGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Res() res: Response,
  ) {
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
        username: {
          type: 'string',
          example: 'johndoe',
        },
        firstName: {
          type: 'string',
          example: 'Sarah',
        },
        phone: {
          type: 'string',
          example: '0190000000',
        },
        chatColor: {
          type: 'string',
          example: '#FF5733',
          description: 'Chat username color (Hex code)',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard, TermsAcceptedGuard)
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

  @UseGuards(JwtAuthGuard, TermsAcceptedGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @Res() res: Response) {
    const data = await this.userService.remove(id);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User deleted successfully.',
      data,
    });
  }
}
