import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deviation from Part 2.7's T6, on the user's explicit instruction: manager/admin may
 * approve or reject their own purchase request. Since `pr.decide` is already restricted to
 * those two roles (Part 1 §1), this removes the self-approval block entirely rather than
 * carving out a role-specific exception — there is no third role it would ever apply to.
 *
 * The service layer (`PurchaseRequestsService.decide`) no longer throws on self-approval
 * either, and instead flags it in the activity log (`selfApproved: true`), which is the
 * "explicit and logged" condition the brief attaches to any C2 escape hatch.
 */
export class AllowPrSelfApproval1785888300000 implements MigrationInterface {
  name = 'AllowPrSelfApproval1785888300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "purchase_requests_guard_self_approval" ON "purchase_requests"`,
    );
    await queryRunner.query(`DROP FUNCTION guard_pr_self_approval()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_pr_self_approval() RETURNS trigger AS $$
      BEGIN
        IF NEW.status IN ('approved', 'rejected')
           AND OLD.status IS DISTINCT FROM NEW.status
           AND NEW.approver_id IS NOT NULL
           AND NEW.approver_id = NEW.requester_id THEN
          RAISE EXCEPTION
            'a purchase request cannot be decided by its own requester (user %)',
            NEW.requester_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER "purchase_requests_guard_self_approval"
      BEFORE UPDATE OF status ON "purchase_requests"
      FOR EACH ROW EXECUTE FUNCTION guard_pr_self_approval();
    `);
  }
}
