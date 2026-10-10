import { poolShare } from './pool-share';

describe('poolShare', () => {
  it('should split the budget so the two pools never exceed it', () => {
    for (const max of [1, 2, 3, 10, 99, 100]) {
      const { typeorm, prisma } = poolShare(max);
      expect(typeorm).toBeGreaterThanOrEqual(1);
      expect(prisma).toBeGreaterThanOrEqual(1);
      if (max >= 2) expect(typeorm + prisma).toBe(max);
    }
  });

  it('should give 50/50 of the production default', () => {
    expect(poolShare(100)).toEqual({ typeorm: 50, prisma: 50 });
  });
});
