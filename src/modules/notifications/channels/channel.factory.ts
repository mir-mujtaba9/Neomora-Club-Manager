import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import type { INotificationChannel } from './notification-channel.interface.js';
import { StubEmailChannel } from './stub-email.channel.js';
import { StubWhatsAppChannel } from './stub-whatsapp.channel.js';

/**
 * Picks a channel implementation given the `NotificationChannel` enum value.
 *
 * Centralizing this lookup means swapping a stub for a real provider is
 * a one-line change in the factory's constructor injection — no callers
 * need updating.
 *
 * NOT a dynamic plugin loader: keeping the wiring explicit makes the
 * dependency graph obvious in PR review.
 */
@Injectable()
export class NotificationChannelFactory {
  private readonly registry: Map<NotificationChannel, INotificationChannel>;

  constructor(
    whatsapp: StubWhatsAppChannel,
    email: StubEmailChannel,
  ) {
    this.registry = new Map<NotificationChannel, INotificationChannel>([
      [NotificationChannel.WHATSAPP, whatsapp],
      [NotificationChannel.EMAIL, email],
    ]);
  }

  /**
   * @throws Error when no impl is registered for the given channel — that
   *   indicates a programmer error (added a new NotificationChannel enum
   *   value without registering a channel impl).
   */
  get(channel: NotificationChannel): INotificationChannel {
    const impl = this.registry.get(channel);
    if (!impl) {
      throw new Error(
        `No channel implementation registered for NotificationChannel='${channel}'. ` +
          `Register one in NotificationChannelFactory before enqueueing.`,
      );
    }
    return impl;
  }
}
