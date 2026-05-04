'use client'

import type { ProductPickerRow } from '@/app/actions/receipts'
import type {
  MeasureUnitRow,
  NetContentOptionRow,
  ProfileBrandRow,
  ProfileCatalogRow,
} from '@/app/actions/stock-checks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  emptyStockCheckScanRow,
  formatConfidencePct,
  parseNetFromProductUnit,
  type StockCheckScanRow,
} from '@/lib/stock-check-scan-rows'

const PID_MANUAL = '__manual__'
const CAT_NONE = '__cat_none__'
const CAT_CUSTOM = '__cat_custom__'
const BRAND_NONE = '__brand_none__'
const BRAND_CUSTOM = '__brand_custom__'
const NET_CUSTOM = '__net_custom__'
const QTY_NONE = '__qty_none__'
const QTY_MANUAL = '__qty_manual__'
const UNIT_OTHER = '__unit_other__'

const VISIBLE_QTY_OPTIONS = Array.from({ length: 48 }, (_, i) => i + 1)

function patchRow(
  rows: StockCheckScanRow[],
  index: number,
  patch: Partial<StockCheckScanRow>
): StockCheckScanRow[] {
  const next = [...rows]
  next[index] = { ...next[index], ...patch }
  return next
}

function parseOptionalNumber(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function catalogValue(
  current: string | null,
  catalogNames: Set<string>
): string {
  const t = current?.trim() ?? ''
  if (!t) return CAT_NONE
  if (catalogNames.has(t)) return t
  return CAT_CUSTOM
}

function brandSelectValue(
  current: string | null,
  catalogNames: Set<string>
): string {
  const t = current?.trim() ?? ''
  if (!t) return BRAND_NONE
  if (catalogNames.has(t)) return t
  return BRAND_CUSTOM
}

function matchNetPresetId(
  r: StockCheckScanRow,
  opts: NetContentOptionRow[]
): string {
  if (r.netQuantity == null || !r.netUnit?.trim()) return NET_CUSTOM
  const u = r.netUnit.trim().toLowerCase()
  const q = Number(r.netQuantity)
  const hit = opts.find(
    (o) =>
      Number(o.net_quantity) === q &&
      o.unit_code.trim().toLowerCase() === u
  )
  return hit?.id ?? NET_CUSTOM
}

function netUnitCodeValue(
  code: string | null,
  knownLower: Set<string>
): string {
  const t = code?.trim().toLowerCase() ?? ''
  if (!t) return CAT_NONE
  if (knownLower.has(t)) return t
  return UNIT_OTHER
}

export function StockCheckScanEditTable({
  rows,
  onRowsChange,
  products,
  brands,
  productTypes,
  presentations,
  measureUnits,
  netContentOptions,
  onPersistBrand,
  onPersistProductType,
  onPersistPresentation,
}: {
  rows: StockCheckScanRow[]
  onRowsChange: (next: StockCheckScanRow[]) => void
  products: ProductPickerRow[]
  brands: ProfileBrandRow[]
  productTypes: ProfileCatalogRow[]
  presentations: ProfileCatalogRow[]
  measureUnits: MeasureUnitRow[]
  netContentOptions: NetContentOptionRow[]
  onPersistBrand: (name: string) => Promise<boolean>
  onPersistProductType: (name: string) => Promise<boolean>
  onPersistPresentation: (name: string) => Promise<boolean>
}) {
  if (rows.length === 0) return null

  const brandNameSet = new Set(brands.map((b) => b.name))
  const typeNameSet = new Set(productTypes.map((t) => t.name))
  const presNameSet = new Set(presentations.map((p) => p.name))
  const unitCodeLower = new Set(
    measureUnits.map((u) => u.code.trim().toLowerCase())
  )

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Corrige lo que la IA leyó mal. Estos valores son los que se guardarán al
        pulsar <strong>Guardar chequeo</strong>. Los desplegables usan datos del
        inventario y catálogos en base.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1040px] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-1.5 py-2 font-semibold">Producto</th>
              <th className="px-1.5 py-2 font-semibold">Marca</th>
              <th className="px-1.5 py-2 font-semibold">Tipo</th>
              <th className="px-1.5 py-2 font-semibold">Presentación</th>
              <th className="min-w-[160px] px-1.5 py-2 font-semibold">
                Contenido neto
              </th>
              <th className="w-[80px] px-1.5 py-2 font-semibold">Ud. foto</th>
              <th className="w-[64px] px-1.5 py-2 font-semibold">Conf.</th>
              <th className="min-w-[100px] px-1.5 py-2 font-semibold">Notas</th>
              <th className="w-[72px] px-1.5 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const netPreset = matchNetPresetId(r, netContentOptions)
              const brandVal = brandSelectValue(r.brandGuess, brandNameSet)
              const typeVal = catalogValue(r.productType, typeNameSet)
              const presVal = catalogValue(r.presentation, presNameSet)
              const qtySelectVal = (() => {
                const q = r.quantityGuess
                if (q == null || Number.isNaN(q)) return QTY_NONE
                const ri = Math.round(q)
                if (q === ri && VISIBLE_QTY_OPTIONS.includes(ri)) {
                  return String(ri)
                }
                return QTY_MANUAL
              })()
              const unitCodeVal = netUnitCodeValue(r.netUnit, unitCodeLower)

              return (
                <tr key={i} className="border-b border-border/80 align-top">
                  <td className="p-1">
                    <div className="flex min-w-[140px] flex-col gap-1">
                      <Select
                        value={r.uiProductPickId ?? PID_MANUAL}
                        onValueChange={(v) => {
                          if (v === PID_MANUAL) {
                            onRowsChange(
                              patchRow(rows, i, { uiProductPickId: null })
                            )
                            return
                          }
                          const p = products.find((x) => x.id === v)
                          if (!p) return
                          const net = parseNetFromProductUnit(p.unit)
                          onRowsChange(
                            patchRow(rows, i, {
                              uiProductPickId: p.id,
                              nameGuess: p.name,
                              brandGuess: p.brand?.trim()
                                ? p.brand.trim()
                                : r.brandGuess,
                              presentation: p.format?.trim()
                                ? p.format.trim()
                                : r.presentation,
                              netQuantity:
                                net.quantity != null
                                  ? net.quantity
                                  : r.netQuantity,
                              netUnit:
                                net.unitCode != null
                                  ? net.unitCode
                                  : r.netUnit,
                            })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full min-w-0 border-input text-[12px]">
                          <SelectValue placeholder="Inventario…" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-64">
                          <SelectItem value={PID_MANUAL}>
                            Solo texto / IA
                          </SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="app-input h-9 text-[12px]"
                        value={r.nameGuess}
                        onChange={(e) =>
                          onRowsChange(
                            patchRow(rows, i, {
                              nameGuess: e.target.value,
                              uiProductPickId: null,
                            })
                          )
                        }
                        placeholder="Nombre"
                      />
                    </div>
                  </td>
                  <td className="p-1">
                    <div className="flex min-w-[120px] flex-col gap-1">
                      <Select
                        value={brandVal}
                        onValueChange={(v) => {
                          if (v === BRAND_NONE) {
                            onRowsChange(
                              patchRow(rows, i, { brandGuess: null })
                            )
                            return
                          }
                          if (v === BRAND_CUSTOM) return
                          onRowsChange(
                            patchRow(rows, i, { brandGuess: v })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full border-input text-[12px]">
                          <SelectValue placeholder="Marca" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-56">
                          <SelectItem value={BRAND_NONE}>
                            (Sin marca)
                          </SelectItem>
                          {[...brandNameSet]
                            .sort((a, b) => a.localeCompare(b))
                            .map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          <SelectItem value={BRAND_CUSTOM}>
                            Otro (escribir)…
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {brandVal === BRAND_CUSTOM ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            className="app-input h-9 text-[12px]"
                            value={r.brandGuess ?? ''}
                            onChange={(e) =>
                              onRowsChange(
                                patchRow(rows, i, {
                                  brandGuess:
                                    e.target.value.trim() || null,
                                })
                              )
                            }
                            placeholder="Marca"
                          />
                          {(r.brandGuess?.trim().length ?? 0) > 0 &&
                            !brandNameSet.has(r.brandGuess!.trim()) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() =>
                                  void onPersistBrand(r.brandGuess!.trim())
                                }
                              >
                                Guardar marca
                              </Button>
                            )}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className="flex min-w-[112px] flex-col gap-1">
                      <Select
                        value={typeVal}
                        onValueChange={(v) => {
                          if (v === CAT_NONE) {
                            onRowsChange(
                              patchRow(rows, i, { productType: null })
                            )
                            return
                          }
                          if (v === CAT_CUSTOM) return
                          onRowsChange(
                            patchRow(rows, i, { productType: v })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full border-input text-[12px]">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-56">
                          <SelectItem value={CAT_NONE}>(Sin tipo)</SelectItem>
                          {[...typeNameSet]
                            .sort((a, b) => a.localeCompare(b))
                            .map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          <SelectItem value={CAT_CUSTOM}>
                            Otro (escribir)…
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {typeVal === CAT_CUSTOM ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            className="app-input h-9 text-[12px]"
                            value={r.productType ?? ''}
                            onChange={(e) =>
                              onRowsChange(
                                patchRow(rows, i, {
                                  productType:
                                    e.target.value.trim() || null,
                                })
                              )
                            }
                            placeholder="Tipo"
                          />
                          {(r.productType?.trim().length ?? 0) > 0 &&
                            !typeNameSet.has(r.productType!.trim()) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() =>
                                  void onPersistProductType(
                                    r.productType!.trim()
                                  )
                                }
                              >
                                Guardar tipo
                              </Button>
                            )}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className="flex min-w-[112px] flex-col gap-1">
                      <Select
                        value={presVal}
                        onValueChange={(v) => {
                          if (v === CAT_NONE) {
                            onRowsChange(
                              patchRow(rows, i, { presentation: null })
                            )
                            return
                          }
                          if (v === CAT_CUSTOM) return
                          onRowsChange(
                            patchRow(rows, i, { presentation: v })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full border-input text-[12px]">
                          <SelectValue placeholder="Presentación" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-56">
                          <SelectItem value={CAT_NONE}>
                            (Sin presentación)
                          </SelectItem>
                          {[...presNameSet]
                            .sort((a, b) => a.localeCompare(b))
                            .map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          <SelectItem value={CAT_CUSTOM}>
                            Otro (escribir)…
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {presVal === CAT_CUSTOM ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            className="app-input h-9 text-[12px]"
                            value={r.presentation ?? ''}
                            onChange={(e) =>
                              onRowsChange(
                                patchRow(rows, i, {
                                  presentation:
                                    e.target.value.trim() || null,
                                })
                              )
                            }
                            placeholder="Presentación"
                          />
                          {(r.presentation?.trim().length ?? 0) > 0 &&
                            !presNameSet.has(r.presentation!.trim()) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() =>
                                  void onPersistPresentation(
                                    r.presentation!.trim()
                                  )
                                }
                              >
                                Guardar presentación
                              </Button>
                            )}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className="flex flex-col gap-1">
                      <Select
                        value={netPreset}
                        onValueChange={(v) => {
                          if (v === NET_CUSTOM) {
                            onRowsChange(
                              patchRow(rows, i, {
                                netQuantity: r.netQuantity,
                                netUnit: r.netUnit,
                              })
                            )
                            return
                          }
                          const opt = netContentOptions.find(
                            (o) => o.id === v
                          )
                          if (!opt) return
                          onRowsChange(
                            patchRow(rows, i, {
                              netQuantity: Number(opt.net_quantity),
                              netUnit: opt.unit_code,
                            })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full min-w-[140px] border-input text-[12px]">
                          <SelectValue placeholder="Contenido neto" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-56">
                          <SelectItem value={NET_CUSTOM}>
                            Personalizado…
                          </SelectItem>
                          {netContentOptions.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {netPreset === NET_CUSTOM ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="app-input h-9 w-20 text-[12px] tabular-nums"
                            value={
                              r.netQuantity != null &&
                              !Number.isNaN(r.netQuantity)
                                ? String(r.netQuantity)
                                : ''
                            }
                            onChange={(e) =>
                              onRowsChange(
                                patchRow(rows, i, {
                                  netQuantity: parseOptionalNumber(
                                    e.target.value
                                  ),
                                })
                              )
                            }
                            placeholder="Cant."
                          />
                          <Select
                            value={unitCodeVal}
                            onValueChange={(v) => {
                              if (v === CAT_NONE) {
                                onRowsChange(
                                  patchRow(rows, i, { netUnit: null })
                                )
                                return
                              }
                              if (v === UNIT_OTHER) return
                              const mu = measureUnits.find(
                                (u) =>
                                  u.code.trim().toLowerCase() ===
                                  v.toLowerCase()
                              )
                              onRowsChange(
                                patchRow(rows, i, {
                                  netUnit: mu?.code ?? v,
                                })
                              )
                            }}
                          >
                            <SelectTrigger className="app-input h-9 w-[120px] border-input text-[12px]">
                              <SelectValue placeholder="Unidad" />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              <SelectItem value={CAT_NONE}>(—)</SelectItem>
                              {measureUnits.map((u) => (
                                <SelectItem
                                  key={u.id}
                                  value={u.code.trim().toLowerCase()}
                                >
                                  {u.label}
                                </SelectItem>
                              ))}
                              <SelectItem value={UNIT_OTHER}>Otra…</SelectItem>
                            </SelectContent>
                          </Select>
                          {unitCodeVal === UNIT_OTHER ? (
                            <Input
                              className="app-input h-9 min-w-[72px] flex-1 text-[12px]"
                              value={r.netUnit ?? ''}
                              onChange={(e) =>
                                onRowsChange(
                                  patchRow(rows, i, {
                                    netUnit: e.target.value.trim() || null,
                                  })
                                )
                              }
                              placeholder="ud."
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className="flex min-w-[88px] flex-col gap-1">
                      <Select
                        value={qtySelectVal}
                        onValueChange={(v) => {
                          if (v === QTY_NONE) {
                            onRowsChange(
                              patchRow(rows, i, { quantityGuess: null })
                            )
                            return
                          }
                          if (v === QTY_MANUAL) {
                            onRowsChange(
                              patchRow(rows, i, { quantityGuess: null })
                            )
                            return
                          }
                          const n = Number(v)
                          onRowsChange(
                            patchRow(rows, i, {
                              quantityGuess: Number.isFinite(n) ? n : null,
                            })
                          )
                        }}
                      >
                        <SelectTrigger className="app-input h-9 w-full border-input text-[12px]">
                          <SelectValue placeholder="Ud." />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value={QTY_NONE}>(—)</SelectItem>
                          {VISIBLE_QTY_OPTIONS.map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                          <SelectItem value={QTY_MANUAL}>Otro…</SelectItem>
                        </SelectContent>
                      </Select>
                      {qtySelectVal === QTY_MANUAL ? (
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="app-input h-9 text-[12px] tabular-nums"
                          value={
                            r.quantityGuess != null &&
                            !Number.isNaN(r.quantityGuess)
                              ? String(r.quantityGuess)
                              : ''
                          }
                          onChange={(e) =>
                            onRowsChange(
                              patchRow(rows, i, {
                                quantityGuess: parseOptionalNumber(
                                  e.target.value
                                ),
                              })
                            )
                          }
                          placeholder="Ud."
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="p-1">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="app-input h-9 text-[12px] tabular-nums"
                      title={`Actual: ${formatConfidencePct(r.confidence)}`}
                      value={
                        r.confidence != null && !Number.isNaN(r.confidence)
                          ? String(r.confidence)
                          : ''
                      }
                      onChange={(e) =>
                        onRowsChange(
                          patchRow(rows, i, {
                            confidence: parseOptionalNumber(e.target.value),
                          })
                        )
                      }
                      placeholder="0–1"
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      className="app-input h-9 min-w-[96px] text-[12px]"
                      value={r.notes ?? ''}
                      onChange={(e) =>
                        onRowsChange(
                          patchRow(rows, i, {
                            notes: e.target.value.trim() || null,
                          })
                        )
                      }
                      placeholder="—"
                    />
                  </td>
                  <td className="p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        const next = rows.filter((_, j) => j !== i)
                        onRowsChange(next)
                      }}
                    >
                      Quitar
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRowsChange([...rows, emptyStockCheckScanRow()])}
      >
        Añadir línea
      </Button>
    </div>
  )
}
