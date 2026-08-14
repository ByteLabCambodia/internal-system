import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Folds the legacy `profiles` table into the boilerplate's `user` entity.
 *
 * The boilerplate's `role` lookup table is kept as-is (reseeded with the four operations
 * roles); only `status` is dropped, replaced by the `active` flag the brief specifies.
 *
 * Also adds the single-use token store shared by invites and password resets.
 */
export class OperationsUser1785888000000 implements MigrationInterface {
  name = 'OperationsUser1785888000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- status is replaced by the `active` flag; `role` stays ----------------------
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "FK_dc18daa696860586ba4667a9d31"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "statusId"`);
    await queryRunner.query(`DROP TABLE "status"`);

    // --- operations columns on user -------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "user" ADD "active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "must_change_password" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "telegram_id" bigint`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "user_telegram_id_key" UNIQUE ("telegram_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "telegram_username" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "telegram_link_token" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "telegram_link_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "department" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "payment_link" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "payment_qr_object_key" character varying`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "user_telegram_link_token_idx" ON "user" ("telegram_link_token") WHERE "telegram_link_token" IS NOT NULL`,
    );

    // --- invite / reset tokens ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "auth_tokens" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "token_hash" text NOT NULL,
        "purpose" text NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "auth_tokens_token_hash_key" UNIQUE ("token_hash"),
        CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('invite', 'reset')),
        CONSTRAINT "PK_auth_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "user" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" ("user_id", "purpose")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."user_telegram_link_token_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "payment_qr_object_key"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "payment_link"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "department"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "telegram_link_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "telegram_link_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "telegram_username"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "telegram_id"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "must_change_password"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "active"`);

    await queryRunner.query(
      `CREATE TABLE "status" ("id" integer NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_e12743a7086ec826733f54e1d95" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "statusId" integer`);
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_dc18daa696860586ba4667a9d31" FOREIGN KEY ("statusId") REFERENCES "status"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
