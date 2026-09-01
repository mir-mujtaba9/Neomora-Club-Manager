import { Controller, Get, Post, Req, Res, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { NotificationsService } from './notifications.service.js';
import { NotificationStatus } from '@prisma/client';

@Controller('webhook/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  verifyWebhook(@Req() req: Request, @Res() res: Response) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res.status(HttpStatus.OK).send(challenge);
    }
    return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
  }

  @Post()
  async handleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      const body = req.body;
      
      // Tell Facebook we got it right away
      res.status(HttpStatus.OK).send('ok');
      
      if (body.object !== 'whatsapp_business_account') {
        return;
      }

      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          
          if (change.field === 'message_template_status_update') {
            const templateName = value.message_template_name;
            const newStatus = value.event === 'APPROVED' ? 'Approved' : value.event === 'REJECTED' ? 'Rejected' : 'Pending';
            
            this.notificationsService.updateTemplateStatus(templateName, newStatus).catch(err => {
              console.error('Failed to update template status:', err);
            });
          }
          else if (value.statuses) {
            for (const status of value.statuses) {
              const wamid = status.id;
              const newStatus = status.status;
              const failureReason = status.errors ? JSON.stringify(status.errors) : null;
              
              let mappedStatus: NotificationStatus | undefined = undefined;
              if (newStatus === 'delivered' || newStatus === 'read') {
                mappedStatus = NotificationStatus.DELIVERED;
              } else if (newStatus === 'failed') {
                mappedStatus = NotificationStatus.FAILED;
              } else if (newStatus === 'sent') {
                mappedStatus = NotificationStatus.SENT;
              }

              if (mappedStatus) {
                this.notificationsService.updateNotificationStatus(wamid, mappedStatus, failureReason).catch(err => {
                  console.error('Failed to update notification status:', err);
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Webhook processing error:', err);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('error');
      }
    }
  }
}
