import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manager approval limit removed: manager is now unlimited (null), same as admin.
 */
export class RemoveManagerApprovalLimit1785888600000
  implements MigrationInterface
{
  name = 'RemoveManagerApprovalLimit1785888600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "approval_thresholds"
      SET "max_amount_usd" = NULL
      WHERE "role_id" = 2
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "approval_thresholds"
      SET "max_amount_usd" = '1000.0000'
      WHERE "role_id" = 2
    `);
  }
}
