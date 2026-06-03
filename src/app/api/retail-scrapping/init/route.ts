import { getScrappingInitAction } from '@/app/actions/retail-scrapping'
import { apiCatchError, apiOkWithDiagnostic } from '@/lib/api-route-helpers'

export async function GET(request: Request) {
  const start = Date.now()
  try {
    const result = await getScrappingInitAction()
    return apiOkWithDiagnostic(request, result, 'getScrappingInitAction', start)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/init', e)
  }
}
