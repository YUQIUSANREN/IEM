import type { Transaction, TxType } from '../types'
import { formatYuan } from './money'

/**
 * 支付宝 CSV「不计收支」、以及标记为不计入限额的流水。
 * 会进账本，但不计入收入/支出、限额和账面余额。
 */
export function isNonCashflowTx(type: TxType, excludedFromBudget?: number | boolean): boolean {
  return type === 'transfer' || Boolean(excludedFromBudget)
}

export function isRefundTx(tx: { isRefund?: number | boolean }): boolean {
  return Boolean(tx.isRefund)
}

/**
 * 退款记在支出侧、金额为正，统计时用负号冲减。
 */
export function expenseContributionFen(
  tx: Pick<Transaction, 'type' | 'amountFen' | 'excludedFromBudget' | 'isRefund'>,
): number {
  if (tx.type !== 'expense' || isNonCashflowTx(tx.type, tx.excludedFromBudget)) return 0
  return isRefundTx(tx) ? -tx.amountFen : tx.amountFen
}

export function incomeContributionFen(
  tx: Pick<Transaction, 'type' | 'amountFen' | 'excludedFromBudget' | 'isRefund'>,
): number {
  if (tx.type !== 'income' || isNonCashflowTx(tx.type, tx.excludedFromBudget) || isRefundTx(tx)) {
    return 0
  }
  return tx.amountFen
}

export function amountClass(
  type: TxType,
  excludedFromBudget?: number | boolean,
  isRefund?: number | boolean,
): 'moss' | 'seal' | 'neutral' {
  if (isNonCashflowTx(type, excludedFromBudget)) return 'neutral'
  if (isRefund) return 'moss'
  return type === 'income' ? 'moss' : 'seal'
}

export function formatTxAmount(
  amountFen: number,
  type: TxType,
  excludedFromBudget?: number | boolean,
  isRefund?: number | boolean,
): string {
  const yuan = formatYuan(amountFen)
  if (isNonCashflowTx(type, excludedFromBudget)) return yuan
  if (isRefund || type === 'income') return `+${yuan}`
  return `-${yuan}`
}

/** 剩余额度可正可负；负数保留负号，正数不加 +。 */
export function formatRemainFen(fen: number): string {
  const yuan = formatYuan(fen)
  return fen < 0 ? `-${yuan}` : yuan
}
