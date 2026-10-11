import { Injectable } from '@nestjs/common';
import { FileRepository } from '../../file.repository';
import { FileMapper } from '../mappers/file.mapper';
import { FileType } from '../../../../domain/file';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { PrismaService } from '../../../../../prisma/prisma.service';

@Injectable()
export class FileRelationalRepository implements FileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get files() {
    return this.prisma.db.orm.public.File;
  }

  async create(data: FileType): Promise<FileType> {
    // id comes from the column default unless the caller already has one.
    const row = await this.files.create(
      data.id ? { id: data.id, path: data.path } : { path: data.path },
    );
    return FileMapper.toDomain(row);
  }

  async findById(id: FileType['id']): Promise<NullableType<FileType>> {
    const row = await this.files.where({ id }).first();
    return row ? FileMapper.toDomain(row) : null;
  }

  async findByIds(ids: FileType['id'][]): Promise<FileType[]> {
    if (!ids.length) return [];
    const rows = await this.files.where((f) => f.id.in(ids)).all();
    return rows.map((row) => FileMapper.toDomain(row));
  }
}
