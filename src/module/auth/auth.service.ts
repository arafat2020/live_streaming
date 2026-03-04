/**
 * @fileoverview Authentication Service
 *
 * Handles all authentication operations including registration, login
 * (username + Google OAuth), token management (access/refresh), password
 * change/reset, and WebSocket token validation.
 *
 * @module AuthService
 */

import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthLogStatus, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';

import { checkAndHandleBan } from '../../common/helpers/ban-check.helper';
import { generateStreamKey } from '../../common/helpers/stream-key.helper';
import {
    generateAccessToken,
    generateRefreshToken,
    generateTempToken,
    TokenPayload,
} from '../../common/helpers/token.helper';
import { sanitizeUser } from '../../common/helpers/user-sanitizer.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { generateOtpCode, hashOtpCode } from '../../utils/generateOtpCode';
import { MailService } from '../mail/mail.service';
import {
    ChangePasswordDto,
    RegisterDto,
    RequestResetCodeDto,
    ResetPasswordDto,
    UsernameLoginDto,
    VerifyResetCodeDto,
} from './dto/create-auth.dto';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailerService: MailService,
  ) {
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  // ──────────────────────────────────────────────
  //  Google Authentication
  // ──────────────────────────────────────────────

  /**
   * Authenticates an existing user via Google OAuth ID token.
   * If the user exists but has no linked `googleId`, it is linked automatically.
   *
   * @param idToken - Google OAuth2 ID token from the client.
   * @returns Access token, refresh token, and sanitized user object.
   * @throws {NotFoundException} If no account exists for the email.
   * @throws {UnauthorizedException} If Google token verification fails.
   */
  async googleLogin(idToken: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const googlePayload = ticket.getPayload();
      if (!googlePayload) {
        throw new BadRequestException('Invalid google token');
      }

      const { email, sub: googleId } = googlePayload;
      if (!email) {
        throw new BadRequestException('Email not provided by Google');
      }

      let user = await this.prisma.user.findUnique({ where: { email } });

      if (!user) {
        throw new NotFoundException(
          'No account found with this email. Please sign up first.',
        );
      }

      // Link Google ID if not yet linked
      if (!user.googleId) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId },
        });
      }

      return this.generateAuthTokens(user);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Google authentication failed');
    }
  }

  /**
   * Registers a new user via Google OAuth ID token.
   * Requires a username and date of birth in addition to the Google token.
   *
   * @param dto - Object containing `idToken`, `username`, and `dateOfBirth`.
   * @returns Access token, refresh token, and sanitized user object.
   * @throws {ConflictException} If an account or username already exists.
   */
  async googleSignup(dto: {
    idToken: string;
    username: string;
    dateOfBirth: string;
  }) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const googlePayload = ticket.getPayload();
      if (!googlePayload) {
        throw new BadRequestException('Invalid google token');
      }

      const { email, family_name, picture, sub: googleId } = googlePayload;
      if (!email) {
        throw new BadRequestException('Email not provided by Google');
      }

      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingUser) {
        throw new ConflictException(
          'An account with this email already exists. Please use login instead.',
        );
      }

      const normalizedUsername = dto.username.toLowerCase();
      const existingUsername = await this.prisma.user.findUnique({
        where: { username: normalizedUsername },
      });
      if (existingUsername) {
        throw new ConflictException('Username is already taken.');
      }

      const user = await this.prisma.user.create({
        data: {
          email,
          username: normalizedUsername,
          firstName: normalizedUsername,
          lastName: family_name || '',
          profileImage: picture,
          googleId,
          dateOfBirth: new Date(dto.dateOfBirth),
          role: UserRole.CREATOR,
          status: UserStatus.ACTIVE,
        },
      });

      // Create channel for new user
      await this.prisma.channel.create({
        data: {
          ownerId: user.id,
          name: user.username,
          handle: user.username!,
          description: null,
          streamKey: generateStreamKey(),
        } as any,
      });

      return this.generateAuthTokens(user);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Google signup failed');
    }
  }

  // ──────────────────────────────────────────────
  //  Email/Password Authentication
  // ──────────────────────────────────────────────

  /**
   * Registers a new user with email and password credentials.
   * Automatically creates a channel for the user.
   *
   * @param dto - Registration data (email, username, password, etc.).
   * @returns Sanitized user object (without tokens — login is separate).
   * @throws {ConflictException} If email or username already exists.
   * @throws {BadRequestException} If password confirmation doesn't match.
   */
  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingEmail) {
      throw new ConflictException('User with this email already exists.');
    }

    const normalizedUsername = dto.username.toLowerCase();
    const existingUsername = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    if (existingUsername) {
      throw new ConflictException('Username is already taken.');
    }

    if (dto.confirmPassword && dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Password not match.');
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      parseInt(process.env.SALT_ROUND!),
    );

    const payload = {
      email: dto.email,
      username: normalizedUsername,
      password: hashedPassword,
      firstName: normalizedUsername,
      lastName: dto.lastName ?? null,
      phone: dto.phone ?? null,
      profileImage: dto.profileImage ?? null,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      is2FAEnabled: dto.is2FAEnabled ?? false,
      twoFactorSecret: null,
      passwordResetToken: null,
      passwordResetExpires: null,
    };

    try {
      const user = await this.prisma.user.create({ data: payload });

      await this.prisma.channel.create({
        data: {
          ownerId: user.id,
          name: user.username,
          handle: user.username!,
          description: null,
          streamKey: generateStreamKey(),
        } as any,
      });

      return sanitizeUser(user);
    } catch (_err) {
      throw new InternalServerErrorException('Failed to create user.');
    }
  }

  /**
   * Authenticates a user by username and password.
   * Includes brute-force protection (IP-level and account-level lockout).
   *
   * @param dto - Login credentials (username + password).
   * @param ip  - Client IP address for rate-limiting.
   * @returns Access token, refresh token, and sanitized user. If 2FA is enabled, returns `tempToken` instead.
   * @throws {UnauthorizedException} On invalid credentials, locked account, or banned user.
   */
  async loginWithUsername(dto: UsernameLoginDto, ip: string) {
    const normalizedUsername = dto.username.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    return this.processUserLogin(user, dto.password, dto.username, ip);
  }

  // ──────────────────────────────────────────────
  //  Token Management
  // ──────────────────────────────────────────────

  /**
   * Refreshes an expired access token using a valid refresh token.
   * Implements refresh token rotation (old token is invalidated).
   *
   * @param token - The current refresh token.
   * @returns New access and refresh tokens.
   * @throws {UnauthorizedException} If the refresh token is invalid, expired, or mismatched.
   */
  async refreshTokens(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret:
          process.env.JWT_REFRESH_SECRET ||
          process.env.JWT_SECRET ||
          'replace_with_a_strong_secret',
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshToken) {
        throw new UnauthorizedException('Access Denied');
      }

      const refreshTokenMatches = await bcrypt.compare(
        token,
        user.refreshToken,
      );
      if (!refreshTokenMatches) {
        throw new UnauthorizedException('Access Denied');
      }

      // Check ban status (auto-unbans expired temp bans)
      await checkAndHandleBan(user, this.prisma);

      // Generate new token pair
      const tokenPayload: TokenPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        tf: true,
      };

      const accessToken = generateAccessToken(this.jwtService, tokenPayload);
      const newRefreshToken = generateRefreshToken(
        this.jwtService,
        tokenPayload,
      );

      // Store hashed refresh token (rotation)
      const hashedRefreshToken = await bcrypt.hash(
        newRefreshToken,
        parseInt(process.env.SALT_ROUND!),
      );
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: hashedRefreshToken },
      });

      return { accessToken, refreshToken: newRefreshToken };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Logs out a user by clearing their stored refresh token.
   *
   * @param userId - ID of the user to log out.
   * @returns Success message.
   */
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return { message: 'Logged out successfully' };
  }

  /**
   * Validates a JWT token for WebSocket connections.
   * Verifies the token signature, checks 2FA flag, user status, and ban state.
   *
   * @param token      - JWT token to validate.
   * @param require2FA - Whether 2FA completion is required (default: true).
   * @returns Sanitized user object, or `null` if validation fails.
   */
  async validateToken(token: string, require2FA = true) {
    try {
      const payload: any = this.jwtService.verify(token);

      const userId = payload?.sub;
      if (!userId) return null;

      if (require2FA && payload.tf !== true) {
        return null;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          isBanned: true,
          banExpiresAt: true,
          banReason: true,
          password: true,
          twoFactorSecret: true,
          passwordResetToken: true,
          passwordResetExpires: true,
        },
      });

      if (!user) return null;
      if (user.status !== UserStatus.ACTIVE) return null;

      // Check ban status silently (returns null instead of throwing)
      try {
        await checkAndHandleBan(user, this.prisma);
      } catch {
        return null;
      }

      return sanitizeUser(user);
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  Password Management
  // ──────────────────────────────────────────────

  /**
   * Changes the password for an authenticated user.
   *
   * @param email - Email of the authenticated user.
   * @param dto   - Old and new password.
   * @returns Success message.
   * @throws {NotFoundException} If user is not found.
   * @throws {BadRequestException} If old password is incorrect.
   */
  async changePassword(email: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Old password is incorrect');
    }

    const hashed = await bcrypt.hash(
      dto.newPassword,
      parseInt(process.env.SALT_ROUND!),
    );
    await this.prisma.user.update({
      where: { email },
      data: { password: hashed },
    });

    return { message: 'Password changed successfully' };
  }

  /**
   * Sends a password reset OTP code to the user's email.
   *
   * @param dto - Contains the user's email address.
   * @returns Success message.
   * @throws {NotFoundException} If user is not found.
   */
  async requestResetCode(dto: RequestResetCodeDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException('User not found');

    const code = generateOtpCode();
    const hashedCode = await hashOtpCode(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { email: dto.email },
      data: { passwordResetToken: hashedCode, passwordResetExpires: expiresAt },
    });

    await this.mailerService.sendMail({
      to: dto.email,
      subject: 'Reset Password Code',
      html: `Your OTP code is ${code}. It will expire in 5 minutes.`,
    });

    return { message: 'Reset code sent' };
  }

  /**
   * Verifies a password reset OTP code.
   *
   * @param dto - Contains email and the OTP code to verify.
   * @returns Success message.
   * @throws {BadRequestException} If code is invalid or expired.
   */
  async verifyResetCode(dto: VerifyResetCodeDto) {
    const otpRecord = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        verified: false,
        passwordResetToken: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !otpRecord ||
      !otpRecord.passwordResetExpires ||
      otpRecord.passwordResetExpires < new Date()
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    const isValid = await bcrypt.compare(
      dto.code,
      otpRecord.passwordResetToken!,
    );
    if (!isValid) {
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.user.update({
      where: { email: dto.email },
      data: {
        verified: true,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    return { message: 'OTP verified successfully' };
  }

  /**
   * Resets a user's password after OTP verification.
   *
   * @param dto - Contains email, new password, and password confirmation.
   * @returns Success message.
   * @throws {BadRequestException} If passwords don't match or OTP not verified.
   */
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException("Passwords don't match");
    }

    const verified = await this.prisma.user.findFirst({
      where: { email: dto.email, verified: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!verified) {
      throw new BadRequestException('OTP not verified');
    }

    const hashed = await bcrypt.hash(
      dto.password,
      parseInt(process.env.SALT_ROUND!),
    );
    await this.prisma.user.update({
      where: { email: dto.email },
      data: { password: hashed, verified: false },
    });

    return { message: 'Password reset successful' };
  }

  // ──────────────────────────────────────────────
  //  Private Helpers
  // ──────────────────────────────────────────────

  /**
   * Core login logic shared by all credential-based login methods.
   * Handles IP rate limiting, account lockout, ban checks, and 2FA flow.
   */
  private async processUserLogin(
    user: any,
    passwordToCheck: string,
    attemptedUsername: string,
    ip: string,
  ) {
    // IP-wide abuse protection (20 failures in 15 minutes)
    const checkTime = new Date(Date.now() - 15 * 60 * 1000);
    const recentIpFailures = await this.prisma.authLog.count({
      where: {
        ip,
        status: { in: [AuthLogStatus.FAILED, AuthLogStatus.LOCKED] },
        createdAt: { gte: checkTime },
      },
    });

    if (recentIpFailures >= 20) {
      throw new UnauthorizedException(
        'Too many failed attempts from this IP address. Please try again in 15 minutes.',
      );
    }

    // Helper: record failed login and increment lockout counter
    const failLogin = async (
      userId: string | null,
      reason: string,
      locked: boolean = false,
    ) => {
      await this.prisma.authLog.create({
        data: {
          userId,
          username: attemptedUsername,
          ip,
          status: locked ? AuthLogStatus.LOCKED : AuthLogStatus.FAILED,
          reason,
        },
      });

      if (userId) {
        const updatedAttempts = (user?.failedLoginAttempts || 0) + 1;
        const lockUpdate: any = { failedLoginAttempts: updatedAttempts };

        if (updatedAttempts >= 5) {
          const lockTime = new Date();
          lockTime.setHours(lockTime.getHours() + 12);
          lockUpdate.lockedUntil = lockTime;
        }

        await this.prisma.user.update({
          where: { id: userId },
          data: lockUpdate,
        });
      }

      throw new UnauthorizedException('Invalid credentials.');
    };

    // User not found — don't leak existence
    if (!user) {
      await this.prisma.authLog.create({
        data: {
          username: attemptedUsername,
          ip,
          status: AuthLogStatus.FAILED,
          reason: 'User not found',
        },
      });
      throw new UnauthorizedException('Invalid credentials.');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const hoursRemaining = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / (1000 * 60 * 60),
      );
      await this.prisma.authLog.create({
        data: {
          userId: user.id,
          username: attemptedUsername,
          ip,
          status: AuthLogStatus.LOCKED,
          reason: `Account locked. ${hoursRemaining} hours remaining.`,
        },
      });
      throw new UnauthorizedException(
        `Account locked due to too many failed attempts. Try again in ${hoursRemaining} hours.`,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Your account is currently inactive.');
    }

    // Check ban status (auto-unbans expired temp bans)
    await checkAndHandleBan(user, this.prisma);

    // Validate password
    if (!user.password) {
      await failLogin(
        user.id,
        'No password set on account (Social login only?)',
      );
      return;
    }

    const isPasswordValid = await bcrypt.compare(
      passwordToCheck,
      user.password,
    );
    if (!isPasswordValid) {
      await failLogin(user.id, 'Incorrect password');
      return;
    }

    // Success — reset lockout counters
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await this.prisma.authLog.create({
      data: {
        userId: user.id,
        username: user.username,
        ip,
        status: AuthLogStatus.SUCCESS,
      },
    });

    const tokenPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tf: true,
    };

    // 2FA flow: issue temp token requiring OTP verification
    if (user.is2FAEnabled) {
      const tempToken = generateTempToken(this.jwtService, {
        ...tokenPayload,
        tf: false,
      });
      return { twoFactorRequired: true, tempToken };
    }

    // Standard flow: issue full token pair
    const accessToken = generateAccessToken(this.jwtService, tokenPayload);
    const refreshToken = generateRefreshToken(this.jwtService, tokenPayload);

    // Store hashed refresh token
    const hashedRefreshToken = await bcrypt.hash(
      refreshToken,
      parseInt(process.env.SALT_ROUND!),
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    return {
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    };
  }

  /**
   * Generates access + refresh tokens for a user and stores the
   * hashed refresh token in the database.
   */
  private async generateAuthTokens(user: any) {
    const tokenPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tf: true,
    };

    const accessToken = generateAccessToken(this.jwtService, tokenPayload);
    const refreshToken = generateRefreshToken(this.jwtService, tokenPayload);

    const hashedRefreshToken = await bcrypt.hash(
      refreshToken,
      parseInt(process.env.SALT_ROUND!),
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken, lastLogin: new Date() },
    });

    return {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }
}
