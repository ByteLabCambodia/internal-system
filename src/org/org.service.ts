import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type OrgKind = 'department' | 'project';

/** Departments and projects — the dimensions carried on PRs, POs and journal lines. */
@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  private get departments() {
    return this.prisma.db.orm.public.Department;
  }

  private get projects() {
    return this.prisma.db.orm.public.Project;
  }

  async findActiveDepartments() {
    return await this.departments
      .where({ active: true })
      .orderBy((d) => d.name.asc())
      .all();
  }

  async findActiveProjects() {
    return await this.projects
      .where({ active: true })
      .orderBy((p) => p.name.asc())
      .all();
  }

  // --- admin CRUD --------------------------------------------------------------------
  async findAllDepartments() {
    return await this.departments.orderBy((d) => d.name.asc()).all();
  }

  async findAllProjects() {
    return await this.projects.orderBy((p) => p.name.asc()).all();
  }

  // Department and Project have the same shape; one collection type keeps the CRUD
  // below shared without a cast at every call.
  private collectionFor(kind: OrgKind) {
    return kind === 'department' ? this.departments : this.projects;
  }

  async create(kind: OrgKind, name: string): Promise<void> {
    await this.collectionFor(kind).create({ name: name.trim() });
  }

  async rename(kind: OrgKind, id: number, name: string): Promise<void> {
    await this.collectionFor(kind).where({ id }).update({ name: name.trim() });
  }

  /** Deactivating hides it from new records without touching the history that used it. */
  async toggleActive(kind: OrgKind, id: number): Promise<void> {
    const row = await this.collectionFor(kind).where({ id }).first();
    if (!row) return;

    await this.collectionFor(kind)
      .where({ id })
      .update({ active: !row.active });
  }

  async remove(kind: OrgKind, id: number): Promise<void> {
    await this.collectionFor(kind).where({ id }).delete();
  }
}
