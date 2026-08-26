import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';

@Injectable()
export class GuardiansService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string, user: any) {
    if (user.role !== 'PARENT') {
      throw new Error('Only parents can access this dashboard');
    }

    const guardians = await this.prisma.guardian.findMany({
      where: { userId: user.id || user.sub, tenantId, deletedAt: null },
      include: {
        participant: {
          include: {
            location: true,
            enrolments: {
              where: { deletedAt: null },
              include: {
                session: {
                  include: {
                    sessionLocations: true
                  }
                },
                location: true,
                invoices: { where: { deletedAt: null } },
                payments: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        },
      },
    });

    if (!guardians || guardians.length === 0) {
      return { students: [] };
    }

    const students = guardians.map((g) => {
      const p = g.participant;

      const upcomingInvoices: any[] = [];
      const overdueInvoices: any[] = [];
      const paidInvoices: any[] = [];
      const paymentHistory: any[] = [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const e of p.enrolments || []) {
        for (const inv of e.invoices || []) {
          const row = {
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            amount: inv.amount,
            dueDate: inv.dueDate,
            status: inv.status,
            paymentLink: inv.paymentLink,
            sessionName: e.session.name
          };
          if (inv.status === 'PAID') {
            paidInvoices.push(row);
          } else if (new Date(inv.dueDate) < today) {
            overdueInvoices.push(row);
          } else {
            upcomingInvoices.push(row);
          }
        }
        for (const pay of e.payments || []) {
          if (pay.status === 'COMPLETED') {
            paymentHistory.push({
              paymentId: pay.id,
              amount: pay.amount,
              date: pay.createdAt,
              method: pay.method,
              sessionName: e.session.name
            });
          }
        }
      }

      return {
        id: p.id,
        firstNameEn: p.firstNameEn,
        lastNameEn: p.lastNameEn,
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
        status: p.status,
        location: p.location?.name,
        enrolments: p.enrolments,
        invoices: {
          upcoming: upcomingInvoices,
          overdue: overdueInvoices,
          paid: paidInvoices,
        },
        paymentHistory,
      };
    });

    return { students };
  }
}
