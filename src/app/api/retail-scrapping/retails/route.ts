import { NextResponse } from 'next/server'
import { listRetailTargetsAction } from '@/app/actions/retail-scrapping'
import { apiCatchError } from '@/lib/api-route-helpers'

export async function GET() {
  try {
    const result = await listRetailTargetsAction()
    return NextResponse.json(result)
  } catch (e) {
    return apiCatchError('api/retail-scrapping/retails', e)
  }
}
