/**
 * Bucket de Storage en Supabase para capturas, boletas y fotos de chequeo.
 * Crear el bucket en el panel y políticas RLS según el proyecto.
 */
export function getPublicUploadBucket(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? 'stockcasa'
}
