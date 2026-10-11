import { FileType } from '../../../../domain/file';

export class FileMapper {
  static toDomain(raw: { id: string; path: string }): FileType {
    const domainEntity = new FileType();
    domainEntity.id = raw.id;
    domainEntity.path = raw.path;
    return domainEntity;
  }
}
