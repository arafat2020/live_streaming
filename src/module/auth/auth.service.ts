import {
    Injectable,
    UnauthorizedException,
    ConflictException,
    InternalServerErrorException,
    NotFoundException,
    BadRequestException
} from '@nestjs/common';
import {
    ChangePasswordDto,
    LoginDto,
    RegisterDto,
    RequestResetCodeDto,
    ResetPasswordDto,
    VerifyResetCodeDto,
} from './dto/create-auth.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus, BanType } from '@prisma/client';
import { generateOtpCode, hashOtpCode } from '../../utils/generateOtpCode';
import { MailService } from '../mail/mail.service';
//import { MailerService } from '@nestjs-modules/mailer';
import { v4 as uuidv4 } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { generateUniqueUsername } from '../../utils/generateUsername';

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

    async googleLoginWithIdToken(idToken: string) {
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: process.env.GOOGLE_CLIENT_ID,
            });

            const googlePayload = ticket.getPayload();
            if (!googlePayload) {
                throw new BadRequestException('Invalid google token');
            }

            const { email, given_name, family_name, picture, sub: googleId } = googlePayload;

            if (!email) {
                throw new BadRequestException('Email not provided by Google');
            }

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                // Generate unique username from email using utility function
                const username = await generateUniqueUsername(email, this.prisma);

                user = await this.prisma.user.create({
                    data: {
                        email,
                        username: username,
                        firstName: username, // Always set firstName to username
                        lastName: family_name || '',
                        profileImage: picture,
                        googleId,
                        role: UserRole.CREATOR,
                        status: UserStatus.ACTIVE,
                    },
                });

                // Create channel for new user
                const channelPayload = {
                    ownerId: user.id,
                    name: user.username, // Use username (which is now same as firstName)
                    handle: user.username!,
                    description: null,
                    streamKey: this.generateStreamKey(),
                } as any; // Type assertion to bypass strict typing
                await this.prisma.channel.create({ data: channelPayload });
            } else if (!user.googleId) {
                // Link existing user with Google account if not linked
                user = await this.prisma.user.update({
                    where: { id: user.id },
                    data: { googleId },
                });
            }

            // Generate tokens
            const payloadBase = {
                sub: user.id,
                email: user.email,
                role: user.role,
            };

            const accessToken = this.jwtService.sign(
                { ...payloadBase, tf: true },
                {
                    secret: process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                    expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
                },
            );

            const refreshToken = this.jwtService.sign(
                { ...payloadBase, tf: true },
                {
                    secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
                },
            );

            const hashedRefreshToken = await bcrypt.hash(refreshToken, parseInt(process.env.SALT_ROUND!));
            await this.prisma.user.update({
                where: { id: user.id },
                data: { refreshToken: hashedRefreshToken, lastLogin: new Date() },
            });

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { password, refreshToken: _, twoFactorSecret, passwordResetToken, passwordResetExpires, ...rest } = user;

            return {
                user: rest,
                accessToken,
                refreshToken,
            };
        } catch (error) {
            console.error('Google login error:', error);
            throw new UnauthorizedException('Google authentication failed');
        }
    }
    private generateStreamKey(): string {
        return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    }
    async register(dto: RegisterDto) {
        const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existingEmail) {
            throw new ConflictException('User with this email already exists.');
        }

        // Username is now required and validated at DTO level
        const username = dto.username;

        if (dto.confirmPassword && dto.password !== dto.confirmPassword) {
            throw new BadRequestException('Password not match.');
        }
        const hashedPassword = await bcrypt.hash(dto.password, parseInt(process.env.SALT_ROUND!));
        const payload = {
            email: dto.email,
            username: username,
            password: hashedPassword,
            firstName: username, // Always set firstName to username
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
            const channelPayload = {
                ownerId: user.id,
                name: user.username, // Use username (which is now same as firstName)
                handle: user.username!, // Use unique username as handle
                description: null,
                streamKey: this.generateStreamKey(),
            } as any; // Type assertion to bypass strict typing

            await this.prisma.channel.create({ data: channelPayload });
            // sanitize sensitive fields before returning
            const {
                password: _password,
                twoFactorSecret: _twoFactorSecret,
                passwordResetToken: _passwordResetToken,
                passwordResetExpires: _passwordResetExpires,
                ...safeUser
            } = user;
            void _password;
            void _twoFactorSecret;
            void _passwordResetToken;
            void _passwordResetExpires;
            return safeUser;
        } catch (err) {
            void err;
            //console.error("err------>",err);
            throw new InternalServerErrorException('Failed to create user.');
        }
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        if (user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException(
                'Your account is currently inactive.'
            );
        }

        // ✅ Check if user is banned
        if (user.isBanned) {
            // Check if temporary ban has expired
            if (user.banExpiresAt && user.banExpiresAt < new Date()) {
                // Auto-unban expired temporary bans
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        isBanned: false,
                        banExpiresAt: null,
                        banReason: null,
                    },
                });
            } else {
                // User is still banned
                if (user.banExpiresAt) {
                    // Temporary ban
                    throw new UnauthorizedException({
                        message: `Your account has been temporarily banned${user.banReason ? ` for: ${user.banReason}` : ''}.`,
                        banType: BanType.TEMPORARY,
                        expiresAt: user.banExpiresAt,
                        reason: user.banReason
                    });
                } else {
                    // Permanent ban
                    throw new UnauthorizedException({
                        message: `Your account has been permanently banned${user.banReason ? ` for: ${user.banReason}` : ''}. Please contact support for more information.`,
                        banType: BanType.PERMANENT,
                        reason: user.banReason
                    });
                }
            }
        }

        if (!user.password) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials.');
        }

        // Update lastLogin AFTER successful authentication
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
        });

        // Prepare common payload fields 
        const payloadBase = {
            sub: user.id,
            email: user.email,
            role: user.role
        };

        // If the user has 2FA enabled, issue a short-lived temp token and require OTP
        if (user.is2FAEnabled) {
            const tempToken = this.jwtService.sign(
                { ...payloadBase, tf: false }, // tf=false indicates 2FA not yet completed
                {
                    secret: process.env.JWT_SECRET,
                    expiresIn: process.env.TEMP_JWT_EXPIRES_IN ?? '5m', // very short
                },
            );

            return {
                twoFactorRequired: true,
                tempToken,
            };
        }

        // Otherwise issue full access token
        const accessToken = this.jwtService.sign(
            { ...payloadBase, tf: true }, // tf=true indicates 2FA satisfied (or not required)
            {
                secret: process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
            },
        );

        // ✅ NEW: create refresh token
        const refreshToken = this.jwtService.sign(
            { ...payloadBase, tf: true },
            {
                secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
            },
        );

        // ✅ Store refresh token in database (hashed for security)
        const hashedRefreshToken = await bcrypt.hash(refreshToken, parseInt(process.env.SALT_ROUND!));
        await this.prisma.user.update({
            where: { id: user.id },
            data: { refreshToken: hashedRefreshToken },
        });

        // Sanitize user object before returning
        const {
            password: _password,
            twoFactorSecret: _twoFactorSecret,
            passwordResetToken: _passwordResetToken,
            passwordResetExpires: _passwordResetExpires,
            refreshToken: _refreshToken,
            ...safeUser
        } = user;
        void _password;
        void _twoFactorSecret;
        void _passwordResetToken;
        void _passwordResetExpires;
        void _refreshToken;

        return {
            accessToken,
            refreshToken,
            user: safeUser,
        };
    }

    async refreshTokens(token: string) {
        try {
            // 1. Verify refresh token
            const payload = this.jwtService.verify(token, {
                secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'replace_with_a_strong_secret',
            });

            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
            });

            if (!user || !user.refreshToken) {
                throw new UnauthorizedException('Access Denied');
            }

            // 2. Compare hashed tokens
            const refreshTokenMatches = await bcrypt.compare(token, user.refreshToken);
            if (!refreshTokenMatches) {
                throw new UnauthorizedException('Access Denied');
            }

            // 2.5. Check if user is banned
            if (user.isBanned) {
                // Check if temporary ban has expired
                if (user.banExpiresAt && user.banExpiresAt < new Date()) {
                    // Auto-unban expired temporary bans
                    await this.prisma.user.update({
                        where: { id: user.id },
                        data: {
                            isBanned: false,
                            banExpiresAt: null,
                            banReason: null,
                        },
                    });
                } else {
                    // User is still banned
                    if (user.banExpiresAt) {
                        throw new UnauthorizedException({
                            message: `Your account has been temporarily banned${user.banReason ? ` for: ${user.banReason}` : ''}.`,
                            banType: BanType.TEMPORARY,
                            expiresAt: user.banExpiresAt,
                            reason: user.banReason
                        });
                    } else {
                        throw new UnauthorizedException({
                            message: `Your account has been permanently banned${user.banReason ? ` for: ${user.banReason}` : ''}. Please contact support for more information.`,
                            banType: BanType.PERMANENT,
                            reason: user.banReason
                        });
                    }
                }
            }

            // 3. Generate new tokens
            const payloadBase = {
                sub: user.id,
                email: user.email,
                role: user.role,
            };

            const accessToken = this.jwtService.sign(
                { ...payloadBase, tf: true },
                {
                    secret: process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                    expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
                },
            );

            const newRefreshToken = this.jwtService.sign(
                { ...payloadBase, tf: true },
                {
                    secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
                },
            );

            // 4. Update refresh token in DB
            const hashedRefreshToken = await bcrypt.hash(newRefreshToken, parseInt(process.env.SALT_ROUND!));
            await this.prisma.user.update({
                where: { id: user.id },
                data: { refreshToken: hashedRefreshToken },
            });

            return {
                accessToken,
                refreshToken: newRefreshToken,
            };
        } catch (e) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }

    async logout(userId: string) {
        await this.prisma.user.update({
            where: { id: userId },
            data: { refreshToken: null },
        });
        return { message: 'Logged out successfully' };
    }
    // add inside AuthService class (place anywhere among other methods)
    async validateToken(token: string, require2FA = true) {
        try {
            // 1. Verify and decode token
            const payload: any = this.jwtService.verify(token);

            const userId = payload?.sub;
            if (!userId) return null;

            // 2. Check 2FA flag if required for WS connections
            if (require2FA && payload.tf !== true) {
                return null;
            }

            // 3. Fetch user (minimum data needed for security check)
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

            // 4. Ensure user is active
            if (user.status !== UserStatus.ACTIVE) return null;

            // 5. Check if user is banned
            if (user.isBanned) {
                // Check if temporary ban has expired
                if (user.banExpiresAt && user.banExpiresAt < new Date()) {
                    // Auto-unban expired temporary bans
                    await this.prisma.user.update({
                        where: { id: user.id },
                        data: {
                            isBanned: false,
                            banExpiresAt: null,
                            banReason: null,
                        },
                    });
                } else {
                    // User is still banned - reject access
                    return null;
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { password, twoFactorSecret, passwordResetToken, passwordResetExpires, isBanned, banExpiresAt, banReason, ...safeUser } = user;

            return safeUser;
        } catch (err) {
            console.error("err------>", err);
            return null;
        }
    }

    // change password
    async changePassword(email: string, dto: ChangePasswordDto) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) {
            throw new NotFoundException('User not found');
        }

        const isMatch = await bcrypt.compare(dto.oldPassword, user.password);
        if (!isMatch) {
            throw new BadRequestException('Old password is incorrect');
        }
        const hashed = await bcrypt.hash(dto.newPassword, parseInt(process.env.SALT_ROUND!));
        await this.prisma.user.update({
            where: { email },
            data: { password: hashed },
        });

        return { message: 'Password changed successfully' };
    }

    // forget and reset password
    async requestResetCode(dto: RequestResetCodeDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) throw new NotFoundException('User not found');

        const code = generateOtpCode();
        console.log("reset password code----->", code);
        const hashedCode = await hashOtpCode(code);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await this.prisma.user.update({ where: { email: dto.email }, data: { passwordResetToken: hashedCode, passwordResetExpires: expiresAt } });


        await this.mailerService.sendMail({
            to: dto.email,
            subject: 'Reset Password Code',
            html: `Your OTP code is ${code}. It will expire in 5 minutes.`,
        });
        return { message: 'Reset code sent' };
    }

    async verifyResetCode(dto: VerifyResetCodeDto) {
        const otpRecord = await this.prisma.user.findFirst({
            where: { email: dto.email, verified: false, passwordResetToken: { not: null } },
            orderBy: { createdAt: 'desc' },
        });

        if (
            !otpRecord ||
            !otpRecord.passwordResetExpires ||
            otpRecord.passwordResetExpires < new Date()
        ) {
            throw new BadRequestException('Invalid or expired code');
        }

        // Non-null assertion fixes TS error
        const isValid = await bcrypt.compare(dto.code, otpRecord.passwordResetToken!);
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

        const hashed = await bcrypt.hash(dto.password, parseInt(process.env.SALT_ROUND!));
        await this.prisma.user.update({
            where: { email: dto.email },
            data: { password: hashed, verified: false },
        });
        return { message: 'Password reset successful' };
    }

    async googleLogin(req: any) {
        if (!req.user) {
            throw new BadRequestException('No user from google');
        }

        let user = await this.prisma.user.findUnique({
            where: { email: req.user.email },
        });

        if (!user) {
            // Generate unique username from email using utility function
            const username = await generateUniqueUsername(req.user.email, this.prisma);

            user = await this.prisma.user.create({
                data: {
                    email: req.user.email,
                    username: username,
                    firstName: username, // Always set firstName to username
                    lastName: req.user.lastName,
                    profileImage: req.user.picture,
                    googleId: req.user.googleId,
                    role: UserRole.CREATOR,
                    status: UserStatus.ACTIVE,
                },
            });

            // Create channel for new user
            const channelPayload = {
                ownerId: user.id,
                name: user.username, // Use username (which is now same as firstName)
                handle: user.username!,
                description: null,
                streamKey: this.generateStreamKey(),
            } as any; // Type assertion to bypass strict typing
            await this.prisma.channel.create({ data: channelPayload });
        } else if (!user.googleId) {
            // Link existing user with Google account if not linked
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: { googleId: req.user.googleId },
            });
        }

        // Generate tokens
        const payloadBase = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        const accessToken = this.jwtService.sign(
            { ...payloadBase, tf: true },
            {
                secret: process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                expiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
            },
        );

        const refreshToken = this.jwtService.sign(
            { ...payloadBase, tf: true },
            {
                secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'replace_with_a_strong_secret',
                expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
            },
        );

        const hashedRefreshToken = await bcrypt.hash(refreshToken, parseInt(process.env.SALT_ROUND!));
        await this.prisma.user.update({
            where: { id: user.id },
            data: { refreshToken: hashedRefreshToken, lastLogin: new Date() },
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, refreshToken: _, twoFactorSecret, passwordResetToken, passwordResetExpires, ...rest } = user;

        return {
            user: rest,
            accessToken,
            refreshToken,
        };
    }
}
