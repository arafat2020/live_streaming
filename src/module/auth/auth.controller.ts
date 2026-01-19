import {
  Controller,
  Post,
  Body,
  Res,
  HttpStatus,
  Req,
  Patch,
  UseGuards,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  RequestResetCodeDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/create-auth.dto';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import sendResponse from 'src/utils/sendResponse';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  @ApiOperation({ summary: 'Register User' })
  @ApiResponse({ status: 201, description: 'Registered User successfully.' })
  @ApiBody({ type: RegisterDto })
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    const data = await this.authService.register(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.CREATED,
      success: true,
      message: 'User created successfully.',
      data,
    });
  }

  @Post('login')
  @ApiOperation({ summary: 'Login User' })
  @ApiResponse({ status: 201, description: 'LoggedIn User successfully.' })
  @ApiBody({ type: LoginDto })
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const data = await this.authService.login(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User LoggedIn successfully.',
      data,
    });
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh Access Token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully.' })
  async refresh(@Body('refreshToken') refreshToken: string, @Res() res: Response) {
    const data = await this.authService.refreshTokens(refreshToken);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Token refreshed successfully.',
      data,
    });
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout User' })
  async logout(@Body('userId') userId: string, @Res() res: Response) {
    const result = await this.authService.logout(userId);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Logged out successfully',
      data: result,
    });
  }

  // change password
  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any, @Res() res: Response) {
    const result = await this.authService.changePassword(req.user.email, dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Password changed',
      data: result,
    });
  }

  // forget and reset password
  @Post('request-reset-code')
  async requestResetCode(@Body() dto: RequestResetCodeDto, @Res() res: Response) {
    const result = await this.authService.requestResetCode(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Reset code sent',
      data: result,
    });
  }


  @Post('verify-reset-code')
  async verifyResetCode(@Body() dto: VerifyResetCodeDto, @Res() res: Response) {
    const result = await this.authService.verifyResetCode(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'OTP verified',
      data: result,
    });
  }




  @Post('reset-password')
  @ApiOperation({ summary: 'Reset User Password' })
  @ApiResponse({ status: 200, description: 'Password reset successfully.' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Res() res: Response) {
    const result = await this.authService.resetPassword(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Password reset successful',
      data: result,
    });
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth2 Login' })
  @ApiResponse({ status: 302, description: 'Redirects to Google.' })
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async googleAuth(@Req() _req: any) { }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 Callback Handler' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with tokens.' })
  async googleAuthRedirect(@Req() req: any, @Res() res: Response) {
    const data = await this.authService.googleLogin(req);

    // Redirect back to frontend with tokens in the query string
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendUrl}/auth/success?accessToken=${data.accessToken}&refreshToken=${data.refreshToken}`;

    return res.redirect(redirectUrl);
  }
}
