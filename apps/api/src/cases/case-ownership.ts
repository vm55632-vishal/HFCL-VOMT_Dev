/**
 * Who owns a case. Normally the proposer who raised it; when it was raised on someone else's
 * behalf, both the person who raised it (`createdById`) and the proposer it is for
 * (`onBehalfOfId`) own it: both can see it, edit and resubmit it, and are notified about it.
 */
export interface Owned {
  createdById: string;
  onBehalfOfId?: string | null;
}

export const isCaseOwner = (c: Owned, userId: string): boolean =>
  c.createdById === userId || (!!c.onBehalfOfId && c.onBehalfOfId === userId);

/** Everyone to notify about a case, without duplicates. */
export const caseOwnerIds = (c: Owned): string[] => [
  ...new Set([c.createdById, c.onBehalfOfId].filter((v): v is string => !!v)),
];

/** Prisma filter: cases this user owns. */
export const ownedBy = (userId: string) => [{ createdById: userId }, { onBehalfOfId: userId }];
