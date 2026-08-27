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
      const safeBody = payload.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const htmlBody = `
        <div style="margin:0;padding:32px 16px;background:#f5f7f6;font-family:Arial,sans-serif;color:#13211b;">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e9e5;border-radius:18px;overflow:hidden;">
            <div style="padding:28px 32px;background:#075d47;color:#ffffff;">
              <div style="font-size:24px;font-weight:700;letter-spacing:.02em;">Neomora</div>
              <div style="margin-top:8px;font-size:14px;opacity:.88;">Notification</div>
            </div>
            <div style="padding:32px;">
              <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#4c5a52;">
                ${safeBody.replace(/\n/g, '<br />')}
              </p>
            </div>
          </div>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"Neomora" <${process.env.SMTP_USER}>`,
        to: payload.recipient,
        subject: 'Notification from Neomora',
        text: payload.body,
        html: htmlBody,
      });
      this.logger.log(`Email sent successfully to ${payload.recipient}`);
      return { success: true, externalId: info.messageId, failureReason: null };
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${payload.recipient}`, error);
      return { success: false, externalId: null, failureReason: error.message };
    }
  }
}
