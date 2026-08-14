import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentEntity } from './entities/department.entity';
import { ProjectEntity } from './entities/project.entity';

/** Departments and projects — the dimensions carried on PRs, POs and journal lines. */
@Injectable()
export class OrgService {
  constructor(
    @InjectRepository(DepartmentEntity)
    private readonly departments: Repository<DepartmentEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
  ) {}

  findActiveDepartments(): Promise<DepartmentEntity[]> {
    return this.departments.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  findActiveProjects(): Promise<ProjectEntity[]> {
    return this.projects.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
  }

  // --- admin CRUD --------------------------------------------------------------------
  findAllDepartments(): Promise<DepartmentEntity[]> {
    return this.departments.find({ order: { name: 'ASC' } });
  }

  findAllProjects(): Promise<ProjectEntity[]> {
    return this.projects.find({ order: { name: 'ASC' } });
  }

  private repositoryFor(kind: 'department' | 'project') {
    return kind === 'department' ? this.departments : this.projects;
  }

  async create(kind: 'department' | 'project', name: string): Promise<void> {
    const repository = this.repositoryFor(kind);
    await repository.save(repository.create({ name: name.trim() }));
  }

  async rename(
    kind: 'department' | 'project',
    id: number,
    name: string,
  ): Promise<void> {
    await this.repositoryFor(kind).update(id, { name: name.trim() });
  }

  /** Deactivating hides it from new records without touching the history that used it. */
  async toggleActive(
    kind: 'department' | 'project',
    id: number,
  ): Promise<void> {
    const repository = this.repositoryFor(kind);
    const row = await repository.findOne({ where: { id } });
    if (!row) return;

    await repository.update(id, { active: !row.active });
  }

  async remove(kind: 'department' | 'project', id: number): Promise<void> {
    await this.repositoryFor(kind).delete(id);
  }
}
