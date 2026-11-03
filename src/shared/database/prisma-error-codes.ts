import { Prisma } from '../../generated/prisma/client.js';

export const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
