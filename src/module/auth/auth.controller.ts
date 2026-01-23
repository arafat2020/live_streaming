import {
  Controller,
  Post,
  Body,
  Res,
  HttpStatus,
  Req,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  UsernameLoginDto,
  RegisterDto,
  RequestResetCodeDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/create-auth.dto';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import sendResponse from 'src/utils/sendResponse';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Post('login-username')
  @ApiOperation({ summary: 'Login User with Username' })
  @ApiResponse({ status: 200, description: 'LoggedIn User successfully.' })
  @ApiBody({ type: UsernameLoginDto })
  async loginWithUsername(
    @Body() dto: UsernameLoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';
    const data = await this.authService.loginWithUsername(dto, ip);
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
  async refresh(
    @Body('refreshToken') refreshToken: string,
    @Res() res: Response,
  ) {
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
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.authService.changePassword(req?.user?.email, dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Password changed',
      data: result,
    });
  }

  // forget and reset password
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('request-reset-code')
  async requestResetCode(
    @Body() dto: RequestResetCodeDto,
    @Res() res: Response,
  ) {
    const result = await this.authService.requestResetCode(dto);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'Reset code sent',
      data: result,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Post('google-login')
  @ApiOperation({ summary: 'Google Login with ID Token' })
  @ApiResponse({ status: 200, description: 'User LoggedIn successfully.' })
  async googleLogin(@Body('idToken') idToken: string, @Res() res: Response) {
    const data = await this.authService.googleLoginWithIdToken(idToken);
    return sendResponse(res, {
      statusCode: HttpStatus.OK,
      success: true,
      message: 'User LoggedIn successfully.',
      data,
    });
  }
}
