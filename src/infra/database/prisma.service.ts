import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit, OnModuleDestroy
{
	constructor() {
		const databaseUrl = process.env.DATABASE_URL
		if (!databaseUrl) {
			throw new Error('DATABASE_URL environment variable is required')
		}

		const adapter = new PrismaNeon({ connectionString: databaseUrl })

		super({ adapter })
	}

	async onModuleInit(): Promise<void> {
		await this.$connect()
	}

	async onModuleDestroy(): Promise<void> {
		await this.$disconnect()
	}
}
