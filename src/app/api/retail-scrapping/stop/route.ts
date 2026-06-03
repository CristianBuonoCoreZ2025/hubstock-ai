import { stopLiderScrappingAction } from '@/app/actions/retail-scrapping'
import { apiCatchError, apiOkWithDiagnostic } from '@/lib/api-route-helpers'

export async function POST(request: Request) {
  const start = Date.now()
  try {
    const result = await stopLiderScrappingAction()
    return apiOkWithDiagnostic(request, result, 'stopLiderScrappingAction', start)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/stop', e)
  }
}
