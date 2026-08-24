<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'
import {
  addInboxItem,
  addTransaction,
  clearImportedTransactions,
  commitImport,
  countImportedTransactions,
  listImportBatches,
  clearNotificationInbox,
  countInbox,
  listInbox,
  previewImport,
  setInboxStatus,
  undoImportBatch,
} from '../domain/engine'
import {
  parseBillFile,
  parseEml,
  parseNotificationText,
  composeNotifyText,
  isPlaceholderInboxTitle,
  type OcrLayoutHint,
} from '../import/bills'
import { startDirectoryWatch } from '../platform/watch'
import { isMobileApp, isTauri } from '../platform/env'
import { recognizeImageFile, type OcrResult } from '../platform/ocr'
import {
  drainNotifyQueue,
  isNotificationListenerEnabled,
  openNotificationListenerSettings,
} from '../platform/notify-listener'
import { guessInboxCategoryId } from '../domain/dedupe'
import { amountClass, formatTxAmount, isNonCashflowTx } from '../domain/tx-display'
import type { ImportBatch, ImportPreviewRow } from '../types'
import { toast, trySave } from '../ui/toast'
import { askConfirm } from '../ui/confirm'
import FileDropzone from '../components/FileDropzone.vue'

const store = useAppStore()
const router = useRouter()
const mobile = isMobileApp()
const tab = ref<'file' | 'watch' | 'notify' | 'ocr' | 'email'>('file')
const preview = ref<ImportPreviewRow[]>([])
const fileName = ref('')
const source = ref<ImportPreviewRow['source']>('manual')
const message = ref('')
const watchLabel = ref('')
const watching = ref(false)
let stopWatch: (() => void) | null = null
const pasteText = ref('')
const ocrText = ref('')
/** 最近一次识图的行框；用户改字后仍用来猜对方，但店名必须还在正文里。 */
const ocrLayout = ref<OcrResult | null>(null)
const ocrBusy = ref(false)
const pickEl = ref<HTMLInputElement | null>(null)
const shotEl = ref<HTMLInputElement | null>(null)
const inbox = ref(listInbox())
const listenerOn = ref(false)
const batches = ref(listImportBatches())

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    manual: '手动',
    alipay: '支付宝',
    wechat: '微信',
    icbc: '工行',
    notification: '通知',
    email: '邮件',
  }
  return map[source] ?? source
}

/** 导入批次时间：去掉秒，日期与时间用空格分开，和列表其它处一致。 */
function formatBatchTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

/**
 * 预览主标题：不计收支单独成名（和账本卡片一致），其余优先对方。
 */
function previewTitle(row: ImportPreviewRow): string {
  if (isNonCashflowTx(row.type, row.excludedFromBudget)) return '不计收支'
  return row.counterpart.trim() || row.note.trim() || (row.type === 'income' ? '收入' : '支出')
}

/**
 * 副行后半段：不计收支补对方/备注；普通收支写「收入/支出」，金额颜色已经表达方向。
 */
function previewMeta(row: ImportPreviewRow): string {
  if (isNonCashflowTx(row.type, row.excludedFromBudget)) {
    return row.counterpart.trim() || row.note.trim() || '—'
  }
  return row.type === 'income' ? '收入' : '支出'
}

function previewStatus(status: ImportPreviewRow['status']): string {
  if (status === 'duplicate') return '重复'
  if (status === 'possible_duplicate') return '疑似重复'
  return ''
}

function reloadBatches(): void {
  batches.value = listImportBatches()
}

async function undoBatch(batch: ImportBatch): Promise<void> {
  const ok = await askConfirm({
    title: '确认撤销？',
    message: `撤销「${batch.fileName}」这次导入？将删除其中 ${batch.importedCount} 笔流水。`,
  })
  if (!ok) return
  if (!trySave(() => undoImportBatch(batch.id), `已撤销 ${batch.importedCount} 笔`)) return
  reloadBatches()
  store.refreshDashboard()
}

async function clearAllImported(): Promise<void> {
  const count = countImportedTransactions()
  if (!count) {
    toast('info', '没有可清空的导入流水')
    return
  }
  const ok = await askConfirm({
    title: '确认清空？',
    message: `清空全部 ${count} 笔导入流水？手记和通知入账会保留。`,
  })
  if (!ok) return
  if (!trySave(() => clearImportedTransactions(), `已清空 ${count} 笔导入流水`)) return
  reloadBatches()
  store.refreshDashboard()
}

function reloadInbox(): void {
  inbox.value = listInbox()
}

async function clearInboxList(): Promise<void> {
  const count = countInbox()
  if (!count) {
    toast('info', '通知列表是空的')
    return
  }
  const ok = await askConfirm({
    title: '清空通知列表？',
    message: `将去掉 ${count} 条记录（含已忽略、已入账和待确认）。只清列表，不会改账本流水。`,
  })
  if (!ok) return
  if (!trySave(() => clearNotificationInbox(), `已清空 ${count} 条通知`)) return
  reloadInbox()
  store.refreshDashboard()
}

async function syncNotifyQueue(): Promise<void> {
  const added = await drainNotifyQueue()
  listenerOn.value = await isNotificationListenerEnabled()
  reloadInbox()
  if (added > 0) message.value = `已从通知栏同步 ${added} 条，请在待确认里入账。`
}

async function openListenerSettings(): Promise<void> {
  try {
    await openNotificationListenerSettings()
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法打开系统设置，请手动搜索「通知使用权」'
  }
}

onMounted(() => {
  void syncNotifyQueue()
})

watch(tab, (value) => {
  if (mobile && value === 'watch') {
    tab.value = 'file'
    return
  }
  if (value === 'notify') void syncNotifyQueue()
})

async function loadFile(file: File, asEmail = false): Promise<void> {
  message.value = ''
  const parsed = asEmail || file.name.toLowerCase().endsWith('.eml') ? await parseEml(file) : await parseBillFile(file)
  fileName.value = file.name
  source.value = parsed.source
  preview.value = previewImport(parsed.rows)
  if (!preview.value.length) {
    message.value = '没有解析到有效流水，请确认文件是支付宝/微信/工行账单。'
    toast('error', message.value)
  }
}

function takeFile(file: File): void {
  const asEmail = tab.value === 'email' || file.name.toLowerCase().endsWith('.eml')
  if (file.name.toLowerCase().endsWith('.eml')) tab.value = 'email'
  void loadFile(file, asEmail).catch((error: unknown) => {
    message.value = error instanceof Error ? error.message : '解析失败'
    toast('error', message.value)
  })
}

function openExportGuide(): void {
  void router.push({ name: 'guide', query: { step: 'file' } })
}

function savePreview(): void {
  try {
    const result = commitImport(fileName.value || 'import', source.value, preview.value)
    message.value = `已导入 ${result.imported} 笔，跳过 ${result.skipped} 笔。`
    toast('ok', message.value)
    preview.value = []
    fileName.value = ''
    reloadBatches()
    store.refreshDashboard()
  } catch (error) {
    const text = error instanceof Error ? error.message : '导入失败'
    message.value = text
    toast('error', text)
  }
}

/**
 * 预览尚未写入账本，清掉即可。导错文件时不必先跳去别的页面。
 */
function discardPreview(): void {
  preview.value = []
  fileName.value = ''
  message.value = ''
  toast('info', '已取消这次导入')
}

async function toggleWatch(): Promise<void> {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
    watching.value = false
    watchLabel.value = ''
    return
  }
  try {
    const handle = await startDirectoryWatch((file) => {
      void loadFile(file)
      tab.value = 'file'
      message.value = `监控到新文件：${file.name}`
    })
    watchLabel.value = handle.label
    stopWatch = handle.stop
    watching.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法开启监控'
  }
}

function ingestText(text: string, title: string, clear?: () => void, layout?: OcrLayoutHint | null): void {
  const parsed = parseNotificationText(text, new Date(), '', layout)
  if (!parsed) {
    message.value = '无法从这段文字里识别金额，请手补一笔。'
    toast('error', message.value)
    return
  }
  try {
    addInboxItem({
      title,
      body: text,
      sourceGuess: parsed.source,
      parsedJson: JSON.stringify(
        layout
          ? {
              ...parsed,
              ocrLayout: {
                imageWidth: layout.imageWidth,
                imageHeight: layout.imageHeight,
                blocks: layout.blocks,
              },
            }
          : parsed,
      ),
    })
    reloadInbox()
    clear?.()
    toast('ok', '已放入待确认')
  } catch (error) {
    toast('error', error instanceof Error ? error.message : '放入待确认失败')
  }
}

function ingestPaste(): void {
  ingestText(pasteText.value, '粘贴的通知', () => {
    pasteText.value = ''
  })
}

function ingestOcr(): void {
  ingestText(ocrText.value, 'OCR识图', undefined, ocrLayout.value)
}

async function onOcrFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  ocrBusy.value = true
  message.value = ''
  ocrLayout.value = null
  try {
    const result = await recognizeImageFile(file)
    ocrText.value = result.text
    ocrLayout.value = result
    message.value = '已识别出文字，可改完再放入待确认。'
    toast('ok', message.value)
  } catch (error) {
    const text = error instanceof Error ? error.message : '识别失败'
    message.value = text
    toast('error', text)
  } finally {
    ocrBusy.value = false
  }
}

function acceptInbox(id: number): void {
  const item = inbox.value.find((row) => row.id === id)
  if (!item) return
  const parsed = readInboxParsed(item)
  if (!parsed) {
    message.value = '这条通知解析失败，请改为手动记账。'
    toast('error', message.value)
    return
  }
  try {
    const source = parsed.source === 'manual' ? 'notification' : parsed.source
    const txType = parsed.isRefund ? 'expense' : parsed.type
    const txId = addTransaction({
      type: txType,
      amountFen: parsed.amountFen,
      occurredAt: parsed.occurredAt,
      categoryId: guessInboxCategoryId(
        parsed.note,
        parsed.counterpart,
        txType,
        store.categories,
        parsed.categoryHint,
        store.transactions,
      ),
      source,
      counterpart: parsed.counterpart,
      note: parsed.note,
      orderNo: parsed.orderNo,
      excludedFromBudget: parsed.excludedFromBudget || txType === 'transfer',
      isRefund: parsed.isRefund,
    })
    if (parsed.relatedRefundFen > 0 && !parsed.isRefund) {
      addTransaction({
        type: 'expense',
        amountFen: parsed.relatedRefundFen,
        occurredAt: parsed.occurredAt,
        categoryId: guessInboxCategoryId(
          parsed.note,
          parsed.counterpart,
          parsed.type,
          store.categories,
          parsed.categoryHint,
          store.transactions,
        ),
        source,
        counterpart: parsed.counterpart,
        note: '关联退款',
        excludedFromBudget: false,
        isRefund: true,
      })
    }
    setInboxStatus(id, 'accepted', txId)
    reloadInbox()
    store.refreshDashboard()
    toast(
      'ok',
      parsed.isRefund
        ? '已记为退款（冲减支出）'
        : parsed.relatedRefundFen > 0
          ? '已入账，并记了一笔关联退款'
          : '已入账',
    )
  } catch (error) {
    toast('error', error instanceof Error ? error.message : '入账失败')
  }
}

function ignoreInbox(id: number): void {
  try {
    setInboxStatus(id, 'ignored')
    reloadInbox()
    toast('ok', '已忽略')
  } catch (error) {
    toast('error', error instanceof Error ? error.message : '操作失败')
  }
}

function inboxStatus(status: string): string {
  if (status === 'pending') return '待确认'
  if (status === 'accepted') return '已入账'
  if (status === 'ignored') return '已忽略'
  return status
}

type InboxItem = ReturnType<typeof listInbox>[number]

function readInboxParsed(item: InboxItem): ReturnType<typeof parseNotificationText> {
  let layout: OcrLayoutHint | undefined
  let storedCounterpart = ''
  if (item.parsed_json) {
    try {
      const stored = JSON.parse(item.parsed_json) as {
        ocrLayout?: OcrLayoutHint
        counterpart?: string
      }
      layout = stored.ocrLayout
      storedCounterpart = stored.counterpart?.trim() ?? ''
    } catch {
      /* 队列里偶发坏 JSON */
    }
  }
  const live = parseNotificationText(
    composeNotifyText(item.title, item.body),
    new Date(item.posted_at),
    item.package_name,
    layout,
  )
  if (live) {
    if (storedCounterpart && !live.counterpart.trim()) live.counterpart = storedCounterpart
    return live
  }
  if (item.parsed_json) {
    try {
      const stored = JSON.parse(item.parsed_json) as Partial<NonNullable<ReturnType<typeof parseNotificationText>>>
      if (stored.amountFen == null) return null
      return {
        source: stored.source ?? 'notification',
        type: stored.type ?? 'expense',
        amountFen: stored.amountFen,
        counterpart: stored.counterpart ?? '',
        occurredAt: stored.occurredAt ?? item.posted_at,
        note: stored.note ?? '',
        excludedFromBudget: stored.excludedFromBudget ?? stored.type === 'transfer',
        orderNo: stored.orderNo ?? '',
        categoryHint: stored.categoryHint ?? '',
        relatedRefundFen: stored.relatedRefundFen ?? 0,
        isRefund: Boolean(stored.isRefund),
      }
    } catch {
      /* 队列里偶发坏 JSON */
    }
  }
  return null
}

function inboxKindLabel(
  type: string | undefined,
  excluded: boolean | undefined,
  isRefund?: boolean,
): string {
  if (isRefund) return '退款'
  if (type === 'transfer' || excluded) return '不计收支'
  if (type === 'income') return '收入'
  return '支出'
}

/**
 * 通知列表：对方优先；副行展示解析出的时间、收支类型和来源。
 */
function inboxView(item: InboxItem): {
  title: string
  source: string
  kind: string
  occurredAt: string
  amountFen: number | null
  type: 'expense' | 'income' | 'transfer'
  excludedFromBudget: boolean
  relatedRefundFen: number
  isRefund: boolean
} {
  const parsed = readInboxParsed(item)
  const party = parsed?.counterpart.trim()
  const title =
    party ||
    (item.title.trim() && !isPlaceholderInboxTitle(item.title)
      ? item.title.trim()
      : parsed?.note?.slice(0, 24) || '通知')
  return {
    title,
    source: sourceLabel(parsed?.source ?? item.source_guess),
    kind: inboxKindLabel(parsed?.type, parsed?.excludedFromBudget, parsed?.isRefund),
    occurredAt: parsed?.occurredAt ?? item.posted_at,
    amountFen: parsed?.amountFen ?? null,
    type: parsed?.type ?? 'expense',
    excludedFromBudget: parsed?.excludedFromBudget ?? false,
    relatedRefundFen: parsed?.relatedRefundFen ?? 0,
    isRefund: Boolean(parsed?.isRefund),
  }
}

const inboxRows = computed(() =>
  inbox.value.map((item) => ({
    item,
    ...inboxView(item),
  })),
)
</script>

<template>
  <section class="page">
    <h1>导入</h1>
    <p class="muted">
      {{ mobile ? '日常用通知自动记账；每个周期再用官方账单在「文件」里对账。' : '日常用通知或目录监控；每个周期再用官方账单对账。' }}
      不会登录你的支付宝、微信或网银。
    </p>
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'file' }" @click="tab = 'file'">文件</button>
      <button class="tab" :class="{ active: tab === 'notify' }" @click="tab = 'notify'">通知</button>
      <button class="tab" :class="{ active: tab === 'ocr' }" @click="tab = 'ocr'">OCR识图</button>
      <button class="tab" :class="{ active: tab === 'email' }" @click="tab = 'email'">邮件</button>
      <button
        v-if="!mobile"
        class="tab"
        :class="{ active: tab === 'watch' }"
        @click="tab = 'watch'"
      >
        目录监控
      </button>
    </div>

    <FileDropzone
      v-if="tab === 'file'"
      accept=".csv,.xlsx,.xls,.txt"
      hint="支持支付宝、微信、工行账单（CSV / Excel）"
      guide-label="导入指引"
      @file="takeFile"
      @guide="openExportGuide"
    />

    <article v-if="tab === 'notify'" class="card">
      <h2>通知自动记账</h2>
      <template v-if="mobile">
        <p class="muted">
          当前：{{ listenerOn ? '已开启通知使用权' : '尚未开启通知使用权' }}。
          打开后，支付宝/微信付款成功的通知会进入下面的待确认，不会自动改账本。
        </p>
        <p class="muted">
          以小米澎湃 OS 为例：设置里搜索「通知使用权」→ 允许 IEM。再到应用管理 → IEM → 省电策略选「无限制」，并允许自启动。
        </p>
        <div class="row">
          <button class="btn" @click="openListenerSettings">打开通知使用权</button>
          <button class="btn secondary" @click="syncNotifyQueue">立即同步</button>
        </div>
      </template>
      <p v-else class="muted">电脑和 iPhone 读不到别人 App 的通知，把通知原文粘贴到下面即可。</p>
      <textarea
        v-model="pasteText"
        rows="4"
        placeholder="可粘贴付款通知，或支付宝/微信账单详情全文（含支付时间、订单号）"
      />
      <div class="row">
        <button class="btn" @click="ingestPaste">放入待确认</button>
        <button v-if="inboxRows.length && tab === 'notify'" class="btn ghost" type="button" @click="clearInboxList">清空列表</button>
      </div>
    </article>

    <article v-if="tab === 'ocr'" class="card">
      <h2>OCR识图</h2>
      <p class="muted">
        选一张账单截图或当场拍照，用系统识字抽出文字，再按通知同一套规则放入待确认。
        没有商户标签时会按版式猜对方，放入前请核对。
        {{ isTauri() ? '识别在本机完成，不上传图片。轻量级OCR，识别结果可能会存在误差，请仔细核对。' : '浏览器没有系统 OCR，请用 Windows 或 Android 版 IEM。' }}
      </p>
      <input
        ref="pickEl"
        class="file-hide"
        type="file"
        accept="image/*"
        @change="onOcrFile"
      />
      <input
        ref="shotEl"
        class="file-hide"
        type="file"
        accept="image/*"
        capture="environment"
        @change="onOcrFile"
      />
      <div class="row">
        <button class="btn" type="button" :disabled="ocrBusy" @click="pickEl?.click()">
          {{ ocrBusy ? '识别中…' : '选图' }}
        </button>
        <button
          class="btn secondary"
          type="button"
          :disabled="ocrBusy"
          @click="shotEl?.click()"
        >
          拍照
        </button>
      </div>
      <textarea
        v-model="ocrText"
        rows="8"
        :disabled="ocrBusy"
        placeholder="识别出的文字会出现在这里，可改完再放入待确认"
      />
      <div class="row">
        <button class="btn" type="button" :disabled="ocrBusy || !ocrText.trim()" @click="ingestOcr">放入待确认</button>
        <button v-if="inboxRows.length" class="btn ghost" type="button" @click="clearInboxList">清空列表</button>
      </div>
    </article>

    <article v-if="(tab === 'notify' || tab === 'ocr') && inboxRows.length" class="card">
      <div class="preview-list">
        <div
          v-for="row in inboxRows"
          :key="row.item.id"
          class="tx-row inbox"
          :class="{ done: row.item.status !== 'pending' }"
        >
          <div class="tx-main">
            <div class="tx-cat">
              <span class="tx-name">{{ row.title }}</span>
              <span v-if="row.item.status !== 'pending'" class="tag">{{ inboxStatus(row.item.status) }}</span>
            </div>
            <div class="tx-meta muted">
              {{ formatBatchTime(row.occurredAt) }}
              <span class="sep">|</span>
              {{ row.kind }}
              <span class="sep">|</span>
              {{ row.source }}
              <template v-if="row.relatedRefundFen > 0">
                <span class="sep">|</span>
                含退款 {{ formatTxAmount(row.relatedRefundFen, 'expense', false, true) }}
              </template>
            </div>
          </div>
          <div class="tx-side">
            <div
              class="tx-amt"
              :class="row.amountFen == null ? 'neutral' : amountClass(row.type, row.excludedFromBudget, row.isRefund)"
            >
              {{
                row.amountFen == null
                  ? '—'
                  : formatTxAmount(row.amountFen, row.type, row.excludedFromBudget, row.isRefund)
              }}
            </div>
            <div v-if="row.item.status === 'pending'" class="tx-actions inbox-actions">
              <button class="btn ghost inbox-skip" type="button" @click="ignoreInbox(row.item.id)">忽略</button>
              <button class="btn inbox-ok" type="button" @click="acceptInbox(row.item.id)">入账</button>
            </div>
          </div>
        </div>
      </div>
    </article>

    <article v-if="tab === 'email'" class="email-block">
      <p class="muted">
        工行可开通 Email 电子对账单。将邮件另存为 .eml，或把附件放到这里。支付宝/微信仍需在 App 里申请账单。
      </p>
      <FileDropzone
        accept=".eml,.csv,.xlsx,.xls"
        hint="支持邮件 .eml，或账单附件 CSV / Excel"
        @file="takeFile"
      />
    </article>

    <article v-if="!mobile && tab === 'watch'" class="card">
      <h2>监控下载目录</h2>
      <p class="muted">授权一个文件夹后，新出现的账单会自动进入预览。网页请用 Chrome 或 Edge。</p>
      <div class="row">
        <button class="btn" @click="toggleWatch">{{ watching ? '停止监控' : '选择并开始监控' }}</button>
        <span class="muted">{{ watchLabel }}</span>
      </div>
    </article>

    <p v-if="message" class="banner info">{{ message }}</p>

    <article v-if="preview.length" class="card">
      <div class="preview-head">
        <h2>预览 {{ fileName }}（{{ sourceLabel(source) }}）</h2>
        <button class="btn ghost" type="button" @click="discardPreview">取消</button>
      </div>
      <p class="muted">重复项默认不导入。支付宝「不计收支」（充值、提现、余额宝调动等）会单独标记，导入后不计入收入/支出和限额。</p>
      <div class="preview-list">
        <label
          v-for="(row, index) in preview"
          :key="index"
          class="tx-row"
          :class="{ dup: row.status === 'duplicate' }"
        >
          <div class="tx-main">
            <div class="tx-cat">
              <span class="tx-name">{{ previewTitle(row) }}</span>
              <span v-if="row.status !== 'new'" class="tag">{{ previewStatus(row.status) }}</span>
            </div>
            <div class="tx-meta muted">
              {{ formatBatchTime(row.occurredAt) }}
              <span class="sep">|</span>
              {{ previewMeta(row) }}
            </div>
          </div>
          <div class="tx-side">
            <div class="tx-amt" :class="amountClass(row.type, row.excludedFromBudget)">
              {{ formatTxAmount(row.amountFen, row.type, row.excludedFromBudget) }}
            </div>
            <div class="tx-actions">
              <input
                v-model="row.selected"
                class="preview-check"
                type="checkbox"
                :disabled="row.status === 'duplicate'"
                :aria-label="`导入 ${previewTitle(row)}`"
              />
            </div>
          </div>
        </label>
      </div>
      <div class="page-actions">
        <button class="btn save" type="button" @click="savePreview">确认导入勾选项</button>
        <button class="btn secondary" type="button" @click="discardPreview">取消这次导入</button>
      </div>
    </article>

    <article class="card">
      <h2>导入记录</h2>
      <p class="muted">导错文件可整批撤销，不必一笔笔删。撤销只影响该文件写入的流水，手记和通知入账会留下。</p>
      <div v-if="batches.length" class="row">
        <button class="btn ghost" type="button" @click="clearAllImported">清空全部导入流水</button>
      </div>
      <p v-if="!batches.length" class="muted">还没有导入记录。</p>
      <div v-else class="batch-list">
        <dl v-for="batch in batches" :key="batch.id" class="desc">
          <dt>时间</dt>
          <dd>{{ formatBatchTime(batch.importedAt) }}</dd>
          <dt>来源</dt>
          <dd><span class="tag">{{ sourceLabel(batch.source) }}</span></dd>
          <dt>笔数</dt>
          <dd>{{ batch.importedCount }} 笔</dd>
          <dt>跳过</dt>
          <dd>{{ batch.skippedCount }} 笔</dd>
          <dt>文件</dt>
          <dd class="span">
            <span class="desc-file">{{ batch.fileName }}</span>
            <button class="btn ghost desc-undo" type="button" @click="undoBatch(batch)">撤销</button>
          </dd>
        </dl>
      </div>
    </article>
  </section>
</template>

<style scoped>
.batch-list {
  display: grid;
  gap: 12px;
  margin-top: 4px;
}

/*
 * 描述列表：1px 间隙当内部分割线，避免 2 列/4 列切换时去抠 nth-child 边框。
 * 窄屏每行一对（标签 | 值）；宽屏两对并排，文件名跨到行尾。
 */
.desc {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 1px;
  margin: 0;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  font-size: 13px;
}

.desc dt,
.desc dd {
  margin: 0;
  padding: 10px 12px;
}

.desc dt {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--soft-2);
  color: var(--muted);
  white-space: nowrap;
}

.desc dd {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  background: var(--card);
  color: var(--ink);
}

.desc-file {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.desc-undo {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 13px;
}

@media (min-width: 801px) {
  html:not(.is-mobile) .desc {
    grid-template-columns: 4.5em minmax(0, 1fr) 4.5em minmax(0, 1fr);
  }

  html:not(.is-mobile) .desc .span {
    grid-column: span 3;
  }
}

.file-hide {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-head h2 {
  margin: 0;
  min-width: 0;
  flex: 1;
}

.preview-head .btn {
  flex: 0 0 auto;
}

.page-actions .btn.secondary {
  width: 100%;
}

.tx-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  min-width: 0;
  cursor: pointer;
}

.tx-row:last-child {
  border-bottom: 0;
}

.tx-row.dup {
  opacity: 0.55;
  cursor: default;
}

.tx-main {
  flex: 1;
  min-width: 0;
}

.tx-cat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  min-width: 0;
}

.tx-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-cat .tag {
  flex-shrink: 0;
}

.tx-meta {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sep {
  margin: 0 4px;
  opacity: 0.6;
}

.tx-side {
  flex: 0 0 auto;
  text-align: right;
  max-width: 46%;
}

.tx-amt {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tx-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.preview-check {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--moss);
  cursor: pointer;
}

.tx-row.dup .preview-check {
  cursor: not-allowed;
}

.tx-row.inbox,
.tx-row.done {
  cursor: default;
}

.tx-row.done {
  opacity: 0.55;
}

.tx-row.inbox .tx-side {
  max-width: none;
}

.inbox-actions {
  gap: 8px;
  align-items: center;
}

.inbox-ok {
  padding: 5px 14px;
  min-height: 32px;
  font-size: 13px;
  font-weight: 700;
}

.inbox-skip {
  padding: 5px 10px;
  min-height: 32px;
  font-size: 13px;
}
</style>
