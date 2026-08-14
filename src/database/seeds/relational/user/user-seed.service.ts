import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { RoleEnum } from '../../../../roles/roles.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

// One account per role for local development. Password for all of them: "secret".
const USERS: {
  firstName: string;
  lastName: string;
  email: string;
  roleId: RoleEnum;
}[] = [
  {
    firstName: 'Super',
    lastName: 'Admin',
    email: 'admin@example.com',
    roleId: RoleEnum.admin,
  },
  {
    firstName: 'Molly',
    lastName: 'Manager',
    email: 'manager@example.com',
    roleId: RoleEnum.manager,
  },
  {
    firstName: 'Fiona',
    lastName: 'Finance',
    email: 'finance@example.com',
    roleId: RoleEnum.finance,
  },
  {
    firstName: 'Eddie',
    lastName: 'Employee',
    email: 'employee@example.com',
    roleId: RoleEnum.employee,
  },
];

@Injectable()
export class UserSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async run() {
    await this.seedUsers(USERS);
    await this.seedOwnerAdmin();
  }

  /**
   * Bootstraps the first real admin from the environment, so a `db:reset` does not cost you
   * your own account. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env; the account is created
   * with must_change_password so the seeded password is never the long-term one.
   */
  private async seedOwnerAdmin() {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) return;

    const existing = await this.repository.count({ where: { email } });
    if (existing) return;

    const salt = await bcrypt.genSalt();

    await this.repository.save(
      this.repository.create({
        firstName: process.env.ADMIN_FIRST_NAME ?? 'Owner',
        lastName: process.env.ADMIN_LAST_NAME ?? 'Admin',
        email,
        password: await bcrypt.hash(password, salt),
        role: { id: RoleEnum.admin },
        active: true,
        mustChangePassword: true,
      }),
    );
  }

  private async seedUsers(users: typeof USERS) {
    for (const user of users) {
      const count = await this.repository.count({
        where: { email: user.email },
      });

      if (count) continue;

      const salt = await bcrypt.genSalt();
      const password = await bcrypt.hash('secret', salt);

      const { roleId, ...rest } = user;

      await this.repository.save(
        this.repository.create({
          ...rest,
          password,
          role: { id: roleId },
          active: true,
        }),
      );
    }
  }
}
