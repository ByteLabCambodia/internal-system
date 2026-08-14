import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { RoleEnum } from '../../../../roles/roles.enum';
import { RoleEntity } from '../../../../roles/infrastructure/persistence/relational/entities/role.entity';

const ROLES: { id: number; name: string }[] = [
  { id: RoleEnum.admin, name: 'Admin' },
  { id: RoleEnum.manager, name: 'Manager' },
  { id: RoleEnum.finance, name: 'Finance' },
  { id: RoleEnum.employee, name: 'Employee' },
];

@Injectable()
export class RoleSeedService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly repository: Repository<RoleEntity>,
  ) {}

  async run() {
    for (const role of ROLES) {
      const count = await this.repository.count({ where: { id: role.id } });

      if (!count) {
        await this.repository.save(this.repository.create(role));
      }
    }
  }
}
