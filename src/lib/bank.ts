/** Bank bulk-transfer (payment batch) file for outstanding invoices. */

import { billingAmounts } from '../store'
import { exportCsv } from './csv'
import type { BillingRecord, TransportPartner } from '../types'

/**
 * Export a bank payment batch CSV — one line per partner with an outstanding
 * balance (approved or draft, not yet paid), summing their net payable and
 * listing the invoices covered. Columns follow a common Thai bulk-transfer
 * template.
 */
export function exportBankBatch(billings: BillingRecord[], partners: TransportPartner[]): number {
  const partnerById = new Map(partners.map((p) => [p.id, p]))
  const byPartner = new Map<string, { amount: number; refs: string[] }>()

  for (const b of billings) {
    if (b.status === 'paid') continue
    const g = byPartner.get(b.partnerId) ?? { amount: 0, refs: [] }
    g.amount += billingAmounts(b).netPayable
    g.refs.push(b.invoiceNo)
    byPartner.set(b.partnerId, g)
  }

  const today = new Date().toISOString().slice(0, 10)
  const rows = [...byPartner.entries()].map(([pid, g]) => {
    const p = partnerById.get(pid)
    return [
      p?.bankAccountName || p?.name || '',
      p?.bankName || '',
      p?.bankAccountNo || '',
      (Math.round(g.amount * 100) / 100).toFixed(2),
      g.refs.join(' '),
      today,
    ]
  })

  if (rows.length === 0) return 0
  exportCsv(
    `tms-payment-batch-${today}`,
    ['Recipient Name', 'Bank', 'Account No.', 'Amount (THB)', 'Reference', 'Payment Date'],
    rows,
  )
  return rows.length
}
