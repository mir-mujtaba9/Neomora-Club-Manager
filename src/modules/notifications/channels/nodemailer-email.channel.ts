import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { INotificationChannel, ChannelSendPayload, DispatchResult } from './notification-channel.interface.js';
import { NotificationChannel } from '@prisma/client';

@Injectable()
export class NodemailerEmailChannel implements INotificationChannel {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(NodemailerEmailChannel.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async send(payload: ChannelSendPayload): Promise<DispatchResult> {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      this.logger.warn('SMTP_USER or SMTP_PASS not configured. Skipping email.');
      return { success: false, externalId: null, failureReason: 'SMTP not configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"Club Manager" <${process.env.SMTP_USER}>`,
        to: payload.recipient,
        subject: 'Notification from Club Manager',
        text: payload.body,
      });
      this.logger.log(`Email sent successfully to ${payload.recipient}`);
      return { success: true, externalId: info.messageId, failureReason: null };
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${payload.recipient}`, error);
      return { success: false, externalId: null, failureReason: error.message };
    }
  }
}
