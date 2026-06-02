import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { FindFeesReportDto } from './dto/find-fees-report.dto.js';
import { FindFunnelReportDto } from './dto/find-funnel-report.dto.js';
import { FindRevenueReportDto } from './dto/find-revenue-report.dto.js';

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string, user: any) {
    const isLocationManager = user.role === UserRole.LOCATION_MANAGER;
    const locationId = isLocationManager ? user.locationId : undefined;

    const [activeParticipants, newInquiries, pendingDocuments, pendingFees] = await Promise.all([
      this.prisma.participant.count({
        where: {
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
          ...(locationId ? { locationId } : {}),
        },
      }),
      this.prisma.participant.count({
        where: {
          tenantId,
          status: 'INQUIRY',
          deletedAt: null,
          ...(locationId ? { locationId } : {}),
        },
      }),
      this.prisma.participant.count({
        where: {
          tenantId,
          status: 'DOCUMENTS_PENDING',
          deletedAt: null,
          ...(locationId ? { locationId } : {}),
        },
      }),
      this.prisma.participant.count({
        where: {
          tenantId,
          status: 'FEE_PENDING',
          deletedAt: null,
          ...(locationId ? { locationId } : {}),
        },
      }),
    ]);

    const locations = await this.prisma.location.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(locationId ? { id: locationId } : {}),
      },
      select: {
        id: true,
        capacity: true,
      },
    });

    const capacityUtilisation = await Promise.all(
      locations.map(async (loc) => {
        const used = await this.prisma.enrolment.count({
          where: {
            tenantId,
            locationId: loc.id,
            deletedAt: null,
            status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
          },
        });
        return {
          locationId: loc.id,
          used,
          total: loc.capacity,
        };
      })
    );

    const paymentWhere: any = {
      tenantId,
      status: 'COMPLETED',
    };
    if (locationId) {
      paymentWhere.enrolment = { locationId };
    }
    const sumCollected = await this.prisma.payment.aggregate({
      where: paymentWhere,
      _sum: {
        amount: true,
      },
    });
    const totalCollected = Number(sumCollected._sum.amount || 0);

    const enrolmentWhere: any = {
      tenantId,
      deletedAt: null,
    };
    if (locationId) {
      enrolmentWhere.locationId = locationId;
    }
    const sumBalance = await this.prisma.enrolment.aggregate({
      where: enrolmentWhere,
      _sum: {
        balance: true,
      },
    });
    const outstandingBalance = Number(sumBalance._sum.balance || 0);

    return {
      activeParticipants,
      newInquiries,
      pendingDocuments,
      pendingFees,
      capacityUtilisation,
      totalCollected,
      outstandingBalance,
    };
  }

  async getFeesReport(tenantId: string, query: FindFeesReportDto) {
    const invoiceWhere: any = {
      tenantId,
      status: { not: 'CANCELLED' },
      deletedAt: null,
    };
    const paymentWhere: any = {
      tenantId,
      status: 'COMPLETED',
    };

    if (query.sessionId) {
      invoiceWhere.enrolment = { ...invoiceWhere.enrolment, sessionId: query.sessionId };
      paymentWhere.enrolment = { ...paymentWhere.enrolment, sessionId: query.sessionId };
    }
    if (query.locationId) {
      invoiceWhere.enrolment = { ...invoiceWhere.enrolment, locationId: query.locationId };
      paymentWhere.enrolment = { ...paymentWhere.enrolment, locationId: query.locationId };
    }

    if (query.month) {
      const [yearStr, monthStr] = query.month.split('-');
      const year = parseInt(yearStr);
      const monthIndex = parseInt(monthStr) - 1;
      const startDate = new Date(year, monthIndex, 1);
      const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

      invoiceWhere.dueDate = {
        gte: startDate,
        lte: endDate,
      };
      paymentWhere.paidAt = {
        gte: startDate,
        lte: endDate,
      };
    }

    const [sumInvoiced, sumPaid] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: invoiceWhere,
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: paymentWhere,
        _sum: { amount: true },
      }),
    ]);

    const totalInvoiced = Number(sumInvoiced._sum.amount || 0);
    const totalCollected = Number(sumPaid._sum.amount || 0);
    const totalOutstanding = Math.max(0, totalInvoiced - totalCollected);
    const collectionRate = totalInvoiced > 0 ? Number(((totalCollected / totalInvoiced) * 100).toFixed(2)) : 0;

    // Grouping by location
    const locWhere: any = {
      tenantId,
      deletedAt: null,
    };
    if (query.locationId) {
      locWhere.id = query.locationId;
    }

    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const [locationsList, totalLocations] = await Promise.all([
      this.prisma.location.findMany({
        where: locWhere,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.count({ where: locWhere }),
    ]);

    const groupings = await Promise.all(
      locationsList.map(async (loc) => {
        const locInvoiceWhere = {
          ...invoiceWhere,
          enrolment: { ...invoiceWhere.enrolment, locationId: loc.id },
        };
        const locPaymentWhere = {
          ...paymentWhere,
          enrolment: { ...paymentWhere.enrolment, locationId: loc.id },
        };

        const [locInvoicedSum, locCollectedSum] = await Promise.all([
          this.prisma.invoice.aggregate({
            where: locInvoiceWhere,
            _sum: { amount: true },
          }),
          this.prisma.payment.aggregate({
            where: locPaymentWhere,
            _sum: { amount: true },
          }),
        ]);

        const invoiced = Number(locInvoicedSum._sum.amount || 0);
        const collected = Number(locCollectedSum._sum.amount || 0);
        const outstanding = Math.max(0, invoiced - collected);
        const rate = invoiced > 0 ? Number(((collected / invoiced) * 100).toFixed(2)) : 0;

        return {
          locationId: loc.id,
          locationName: loc.name,
          invoiced,
          collected,
          outstanding,
          collectionRate: rate,
        };
      })
    );

    return {
      summary: {
        totalInvoiced,
        totalCollected,
        totalOutstanding,
        collectionRate,
      },
      groupings,
      meta: {
        total: totalLocations,
        page,
        limit,
        totalPages: Math.ceil(totalLocations / limit),
      },
    };
  }

  async getFunnelReport(tenantId: string, user: any, query: FindFunnelReportDto) {
    const isLocationManager = user.role === UserRole.LOCATION_MANAGER;
    const locationId = isLocationManager ? user.locationId : undefined;
    const { sessionId, startDate, endDate } = query;

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const baseWhere: any = {
      tenantId,
      deletedAt: null,
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (locationId) {
      baseWhere.locationId = locationId;
    }

    if (sessionId) {
      baseWhere.enrolments = {
        some: {
          sessionId,
        },
      };
    }

    const inquiryCount = await this.prisma.participant.count({
      where: baseWhere,
    });

    const docPendingCount = await this.prisma.participant.count({
      where: {
        ...baseWhere,
        status: { not: 'INQUIRY' },
      },
    });

    const feePendingCount = await this.prisma.participant.count({
      where: {
        ...baseWhere,
        status: { notIn: ['INQUIRY', 'DOCUMENTS_PENDING'] },
      },
    });

    const activeCount = await this.prisma.participant.count({
      where: {
        ...baseWhere,
        status: { in: ['ACTIVE', 'COMPLETED', 'ON_HOLD'] },
      },
    });

    const stages = [
      {
        stage: 'INQUIRY',
        count: inquiryCount,
        dropOffRate: 0,
      },
      {
        stage: 'DOCUMENTS_PENDING',
        count: docPendingCount,
        dropOffRate: inquiryCount > 0 ? Number(((inquiryCount - docPendingCount) / inquiryCount * 100).toFixed(2)) : 0,
      },
      {
        stage: 'FEE_PENDING',
        count: feePendingCount,
        dropOffRate: docPendingCount > 0 ? Number(((docPendingCount - feePendingCount) / docPendingCount * 100).toFixed(2)) : 0,
      },
      {
        stage: 'ACTIVE',
        count: activeCount,
        dropOffRate: feePendingCount > 0 ? Number(((feePendingCount - activeCount) / feePendingCount * 100).toFixed(2)) : 0,
      },
    ];

    return stages;
  }

  async getRevenueReport(tenantId: string, query: FindRevenueReportDto) {
    const { year, locationId } = query;

    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const monthlyReport = await Promise.all(
      months.map(async (month) => {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);

        const prevStartDate = new Date(year - 1, month - 1, 1);
        const prevEndDate = new Date(year - 1, month, 0, 23, 59, 59, 999);

        const paymentWhere: any = {
          tenantId,
          status: 'COMPLETED',
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
        };
        if (locationId) {
          paymentWhere.enrolment = { locationId };
        }
        const collectedSum = await this.prisma.payment.aggregate({
          where: paymentWhere,
          _sum: { amount: true },
        });
        const collected = Number(collectedSum._sum.amount || 0);

        const prevPaymentWhere: any = {
          tenantId,
          status: 'COMPLETED',
          paidAt: {
            gte: prevStartDate,
            lte: prevEndDate,
          },
        };
        if (locationId) {
          prevPaymentWhere.enrolment = { locationId };
        }
        const prevCollectedSum = await this.prisma.payment.aggregate({
          where: prevPaymentWhere,
          _sum: { amount: true },
        });
        const prevCollected = Number(prevCollectedSum._sum.amount || 0);

        const invoiceWhere: any = {
          tenantId,
          status: { in: ['PENDING', 'OVERDUE'] },
          deletedAt: null,
          dueDate: {
            gte: startDate,
            lte: endDate,
          },
        };
        if (locationId) {
          invoiceWhere.enrolment = { locationId };
        }
        const outstandingSum = await this.prisma.invoice.aggregate({
          where: invoiceWhere,
          _sum: { amount: true },
        });
        const outstanding = Number(outstandingSum._sum.amount || 0);

        let collectedYoY = 0;
        if (prevCollected > 0) {
          collectedYoY = Number(((collected - prevCollected) / prevCollected * 100).toFixed(2));
        }

        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];

        return {
          month: monthNames[month - 1],
          collected,
          outstanding,
          collectedYoY,
        };
      })
    );

    return monthlyReport;
  }
}
