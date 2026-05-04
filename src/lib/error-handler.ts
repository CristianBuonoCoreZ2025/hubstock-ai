import logger from '@/lib/logger';

export async function withErrorHandling<T>(
  action: () => Promise<T>,
  context: { actionName: string; userId?: string }
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    return { success: true, data: await action() };
  } catch (error) {
    logger.error({
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Ocurrió un error inesperado',
    };
  }
}
