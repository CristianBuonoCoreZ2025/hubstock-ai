import { NextResponse } from 'next/server'
import { purgeScrappingTablesIfIdleAction } from '@/app/actions/retail-scrapping'
import { apiCatchError } from '@/lib/api-route-helpers'

export async function POST() {
  try {
    const result = await purgeScrappingTablesIfIdleAction()
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/purge-if-idle', e)
  }
}
