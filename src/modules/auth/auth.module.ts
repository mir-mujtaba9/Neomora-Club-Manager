import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './auth.strategy';

@Module({
	imports: [
		PassportModule,
		JwtModule.registerAsync({
			inject: [ConfigService],
			useFactory: async (configService: ConfigService) => {
				// Uses config from src/infra/config/jwt.config.ts (namespace: 'jwt')
				const secret =
					configService.get<string>('jwt.secret') ||
					configService.get<string>('JWT_SECRET') ||
					'default-secret-change-me';

				const expiresIn =
					configService.get<string>('jwt.expiresIn') ||
					configService.get<string>('JWT_EXPIRES_IN') ||
					'15m';

				return {
					secret,
					signOptions: { expiresIn: expiresIn as any },
				};
			},
		}),
	],
	controllers: [AuthController],
	providers: [AuthService, JwtStrategy],
	exports: [AuthService],
})
export class AuthModule {}

