export enum SessionStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  ONGOING = 'ONGOING',
  CLOSED = 'CLOSED',
  ARCHIVED = 'ARCHIVED',
}

export const SESSION_STATUS = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  ONGOING: 'ONGOING',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;

/** Valid status transitions for Terms (managed by SeasonsService). */
export const TERM_STATUS_TRANSITIONS: Record<string, string> = {
  DRAFT: 'OPEN',
  OPEN: 'ONGOING',
  ONGOING: 'CLOSED',
};
