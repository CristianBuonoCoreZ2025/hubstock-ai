/** Bucket de Storage en Supabase (crear el bucket y políticas RLS según tu proyecto). */
export function getUploadsBucketName(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? 'stockcasa-uploads'
}
