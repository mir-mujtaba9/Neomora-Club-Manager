import { UserRole } from '../constants/user-role.constants';

export interface JwtPayload {
  /** User ID */
  sub: string;
  /** Tenant ID for multi-tenancy context */
  tenantId: string;
  /** Optional location context (when user is scoped to a location) */
  locationId?: string | null;
  /** User Role for authorization */
  role: UserRole;
  /** User Email */
  email: string;
  /** Token Identifier (JWT ID) */
  jti: string;
  /** Issued At (timestamp in seconds) */
  iat: number;
  /** Expiration (timestamp in seconds) */
  exp: number;
}
