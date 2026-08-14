import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';
import { numericTransformer } from '../../utils/transformers/numeric.transformer';
import { DepartmentEntity } from '../../org/entities/department.entity';
import { ProjectEntity } from '../../org/entities/project.entity';

@Entity({ name: 'budgets' })
export class BudgetEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DepartmentEntity, { nullable: true })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;

  @ManyToOne(() => ProjectEntity, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity | null;

  @Column({ name: 'category', type: 'text', nullable: true })
  category: string | null;

  // first day of the budget month
  @Column({ name: 'period', type: 'date' })
  period: string;

  @Column({
    name: 'amount_usd',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  amountUsd: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
