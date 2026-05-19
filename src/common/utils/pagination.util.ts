export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Extracts Prisma skip/take parameters from pagination query
 */
export function getPaginationParams(query: Partial<PaginationParams>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
  const skip = (page - 1) * limit;
  const take = limit;

  return { skip, take, page, limit };
}

/**
 * Wraps data and total count into a standard paginated response shape
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  params: { page: number; limit: number },
): PaginatedResult<T> {
  return {
    data,
    meta: {
      total,
      page: params.page,
      limit: params.limit,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}
