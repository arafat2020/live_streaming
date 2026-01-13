import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { R2UploadService } from '../video/r2-upload.service';
import { subDays } from 'date-fns';

@Injectable()
export class StorageCleanupService {
    private readonly logger = new Logger(StorageCleanupService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly r2Service: R2UploadService,
    ) { }

    /**
     * Run daily at midnight to clean up old stream recordings
     * Stream VOD recordings should auto-delete after 7 days
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleStorageCleanup() {
        this.logger.log('🧹 Starting storage cleanup job...');

        const sevenDaysAgo = subDays(new Date(), 7);

        try {
            // Find all live stream recordings older than 7 days
            const oldStreams = await this.prisma.content.findMany({
                where: {
                    contentType: 'LIVE_STREAM',
                    createdAt: {
                        lt: sevenDaysAgo,
                    },
                },
                select: {
                    id: true,
                    r2Prefix: true,
                    title: true,
                },
            });

            if (oldStreams.length === 0) {
                this.logger.log('✅ No old stream recordings found for cleanup.');
                return;
            }

            this.logger.log(`🔍 Found ${oldStreams.length} old stream recordings to delete.`);

            for (const stream of oldStreams) {
                try {
                    this.logger.log(`🗑️ Deleting stream: ${stream.title} (ID: ${stream.id})`);

                    // 1. Delete from R2 storage
                    if (stream.r2Prefix) {
                        await this.r2Service.deletePrefix(stream.r2Prefix);
                    }

                    // 2. Delete from database
                    await this.prisma.content.delete({
                        where: { id: stream.id },
                    });

                    this.logger.log(`✅ Successfully deleted stream: ${stream.id}`);
                } catch (error) {
                    this.logger.error(`❌ Failed to delete stream ${stream.id}: ${error.message}`);
                }
            }

            this.logger.log('✅ Storage cleanup job completed.');
        } catch (error) {
            this.logger.error(`❌ Storage cleanup job failed: ${error.message}`);
        }
    }

    /**
     * Manual trigger for testing purposes
     */
    async manualCleanup() {
        return this.handleStorageCleanup();
    }
}
