import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { UserRole } from '../../common/constants/user-role.constants.js';
import { FindFeesReportDto } from './dto/find-fees-report.dto.js';
import { FindFunnelReportDto } from './dto/find-funnel-report.dto.js';
import { FindRevenueReportDto } from './dto/find-revenue-report.dto.js';
import { FindCapacityUtilisationDto } from './dto/find-capacity-utilisation.dto.js';

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Plan I helper — LOCATION_MANAGER's queries are always pinned to their
   * own location.locationId regardless of any query-string override. Any
   * other role passes through with the query value (or undefined).
   */
  private resolveLocationScope(user: any, queryLocationId?: string): string | undefined {
    if (user?.role === UserRole.LOCATION_MANAGER) return user.locationId;
    return queryLocationId;
  }

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
        name: true,
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
        // Plan I (F-25) — surface locationName + utilizationPercent so the
        // dashboard doesn't need a second round-trip to render labels.
        const utilizationPercent = loc.capacity > 0
          ? Number(((used / loc.capacity) * 100).toFixed(2))
          : 0;
        return {
          locationId: loc.id,
          locationName: loc.name,
          used,
          total: loc.capacity,
          utilizationPercent,
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
      // Plan I (F-25) — aggregate "anything that's still in the pipeline"
      // count for at-a-glance dashboards. Sums the 3 mid-funnel statuses.
      pendingRegistrations: newInquiries + pendingDocuments + pendingFees,
      capacityUtilisation,
      totalCollected,
      outstandingBalance,
    };
  }

  async getFeesReport(tenantId: string, user: any, query: FindFeesReportDto) {
    // Plan I (F-27) — LM is pinned to own location; SUPER_ADMIN/FINANCE
    // pass through query.locationId untouched.
    const effectiveLocationId = this.resolveLocationScope(user, query.locationId);

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
    if (effectiveLocationId) {
      invoiceWhere.enrolment = { ...invoiceWhere.enrolment, locationId: effectiveLocationId };
      paymentWhere.enrolment = { ...paymentWhere.enrolment, locationId: effectiveLocationId };
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

    // Plan I (F-27) — groupBy picks the grouping dimension. Default is
    // 'location' which preserves the pre-Plan-I behaviour. 'session'
    // pivots the same aggregations across Session rows instead.
    const groupBy = query.groupBy ?? 'location';
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    let groupings: any[] = [];
    let totalGroups = 0;

    if (groupBy === 'session') {
      const sessionWhere: any = { tenantId, deletedAt: null };
      if (query.sessionId) sessionWhere.id = query.sessionId;
      // For LM, restrict sessions to those offered at their location.
      if (effectiveLocationId) {
        sessionWhere.locations = { some: { locationId: effectiveLocationId } };
      }
      const [sessionsList, total] = await Promise.all([
        this.prisma.session.findMany({
          where: sessionWhere,
          skip,
          take: limit,
          orderBy: { startDate: 'desc' },
          select: { id: true, name: true },
        }),
        this.prisma.session.count({ where: sessionWhere }),
      ]);
      totalGroups = total;

      groupings = await Promise.all(
        sessionsList.map(async (s) => {
          const sInvWhere = {
            ...invoiceWhere,
            enrolment: { ...invoiceWhere.enrolment, sessionId: s.id },
          };
          const sPayWhere = {
            ...paymentWhere,
            enrolment: { ...paymentWhere.enrolment, sessionId: s.id },
          };
          const [iSum, pSum] = await Promise.all([
            this.prisma.invoice.aggregate({ where: sInvWhere, _sum: { amount: true } }),
            this.prisma.payment.aggregate({ where: sPayWhere, _sum: { amount: true } }),
          ]);
          const invoiced = Number(iSum._sum.amount || 0);
          const collected = Number(pSum._sum.amount || 0);
          const outstanding = Math.max(0, invoiced - collected);
          const rate = invoiced > 0 ? Number(((collected / invoiced) * 100).toFixed(2)) : 0;
          return {
            sessionId: s.id,
            sessionName: s.name,
            invoiced,
            collected,
            outstanding,
            collectionRate: rate,
          };
        })
      );
    } else {
      // groupBy === 'location'
      const locWhere: any = { tenantId, deletedAt: null };
      if (effectiveLocationId) locWhere.id = effectiveLocationId;

      const [locationsList, total] = await Promise.all([
        this.prisma.location.findMany({
          where: locWhere,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
        }),
        this.prisma.location.count({ where: locWhere }),
      ]);
      totalGroups = total;

      groupings = await Promise.all(
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
            this.prisma.invoice.aggregate({ where: locInvoiceWhere, _sum: { amount: true } }),
            this.prisma.payment.aggregate({ where: locPaymentWhere, _sum: { amount: true } }),
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
    }

    return {
      summary: {
        totalInvoiced,
        totalCollected,
        totalOutstanding,
        collectionRate,
      },
      groupBy,
      groupings,
      meta: {
        total: totalGroups,
        page,
        limit,
        totalPages: Math.ceil(totalGroups / limit),
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

  async getRevenueReport(tenantId: string, user: any, query: FindRevenueReportDto) {
    const { year } = query;
    // Plan I (F-27 sibling) — LM scope mirrors fees report.
    const locationId = this.resolveLocationScope(user, query.locationId);

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

  /**
   * Plan I (F-29) — capacity utilisation over time.
   *
   * Buckets the requested [from, to] range into day/week/month windows
   * and, for each (location, bucket) pair, reports the count of active
   * enrolments AS OF the bucket end. "Active" = not soft-deleted AND
   * status not in {WAITLISTED, WITHDRAWN}.
   *
   * NOTE: status is read from the current row (we don't reconstruct
   * historical state). The withdraw-after-bucket case will therefore
   * under-report old buckets if a previously-active enrolment is now
   * withdrawn. Acceptable trade-off — historical reconstruction would
   * need an EnrolmentEvent timeline we don't currently maintain.
   */
  async getCapacityUtilisationOverTime(
    tenantId: string,
    user: any,
    query: FindCapacityUtilisationDto,
  ) {
    const interval = query.interval ?? 'day';
    const from = new Date(query.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(query.to);
    to.setHours(23, 59, 59, 999);

    if (to.getTime() < from.getTime()) {
      throw new Error('to must be on or after from');
    }

    const effectiveLocationId = this.resolveLocationScope(user, query.locationId);

    const locWhere: any = { tenantId, deletedAt: null };
    if (effectiveLocationId) locWhere.id = effectiveLocationId;

    const locations = await this.prisma.location.findMany({
      where: locWhere,
      select: { id: true, name: true, capacity: true },
      orderBy: { name: 'asc' },
    });

    // Build inclusive bucket boundaries. Cap at 366 buckets so a
    // mistyped year range can't generate thousands of rows.
    const buckets: Array<{ start: Date; end: Date; label: string }> = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const start = new Date(cursor);
      const end = new Date(cursor);
      let label: string;
      if (interval === 'day') {
        end.setHours(23, 59, 59, 999);
        label = start.toISOString().slice(0, 10);
        cursor.setDate(cursor.getDate() + 1);
      } else if (interval === 'week') {
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        label = `${start.toISOString().slice(0, 10)}_W`;
        cursor.setDate(cursor.getDate() + 7);
      } else {
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        label = start.toISOString().slice(0, 7);
        cursor.setMonth(cursor.getMonth() + 1);
        cursor.setDate(1);
      }
      // Clip last bucket to the requested `to` so we don't over-shoot.
      if (end.getTime() > to.getTime()) end.setTime(to.getTime());
      buckets.push({ start, end, label });
      if (buckets.length > 366) {
        throw new Error('Range too large — max 366 buckets per request');
      }
    }

    // Pull enrolments once per location, group in JS. For typical
    // ranges this is far cheaper than N+1 COUNTs per bucket.
    const series = await Promise.all(
      locations.map(async (loc) => {
        const enrolments = await this.prisma.enrolment.findMany({
          where: {
            tenantId,
            locationId: loc.id,
            deletedAt: null,
            status: { notIn: ['WAITLISTED', 'WITHDRAWN'] },
            enrolledAt: { lte: to },
          },
          select: { enrolledAt: true },
        });

        const points = buckets.map((b) => {
          // enrolledAt is nullable in the schema but in practice always set
          // on creation. Guard with `?? 0` so an unset row simply never
          // counts toward any bucket rather than crashing the report.
          const used = enrolments.filter(
            (e) => (e.enrolledAt?.getTime() ?? 0) <= b.end.getTime() && e.enrolledAt,
          ).length;
          const utilizationPercent = loc.capacity > 0
            ? Number(((used / loc.capacity) * 100).toFixed(2))
            : 0;
          return {
            bucket: b.label,
            bucketStart: b.start,
            bucketEnd: b.end,
            used,
            capacity: loc.capacity,
            remaining: Math.max(0, loc.capacity - used),
            utilizationPercent,
          };
        });

        return {
          locationId: loc.id,
          locationName: loc.name,
          capacity: loc.capacity,
          points,
        };
      })
    );

    return { interval, from, to, series };
  }
}
