import { Module } from '@nestjs/common';
import { GuardianAuthController } from './guardian-auth.controller.js';
import { GuardianAuthService } from './guardian-auth.service.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret') || configService.get<string>('JWT_SECRET') || 'default-secret-change-me',
        signOptions: { expiresIn: '2h' }, // Guardian sessions are typically shorter
      }),
    }),
  ],
  controllers: [GuardianAuthController],
  providers: [GuardianAuthService],
  exports: [GuardianAuthService],
})
export class GuardianAuthModule {}
