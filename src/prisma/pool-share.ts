/**
 * TypeORM and Prisma each open their own pg pool while the move between them is under
 * way. Split DATABASE_MAX_CONNECTIONS between them so the app as a whole still stays
 * within that limit (the production db.t4g.micro allows only ~80-110 connections).
 * Remove this once TypeORM is gone and Prisma gets the whole budget again.
 */
export function poolShare(maxConnections: number): {
  typeorm: number;
  prisma: number;
} {
  const prisma = Math.max(1, Math.floor(maxConnections / 2));
  return { typeorm: Math.max(1, maxConnections - prisma), prisma };
}
