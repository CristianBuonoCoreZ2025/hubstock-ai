import { NextResponse } from 'next/server'
import { listScrappingRunsAction } from '@/app/actions/retail-scrapping'
import { apiCatchError } from '@/lib/api-route-helpers'

export async function GET() {
  try {
    const result = await listScrappingRunsAction()
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/runs', e)
  }
}
