export enum FileDriver {
  LOCAL = 'local',
  S3 = 's3',
  S3_PRESIGNED = 's3-presigned',
}

export type FileConfig = {
  driver: FileDriver;
  accessKeyId?: string;
  secretAccessKey?: string;
  awsDefaultS3Bucket?: string;
  awsS3Region?: string;
  // R2 is S3-compatible but not on an AWS endpoint, so the endpoint must be given.
  r2Endpoint?: string;
  maxFileSize: number;
};
