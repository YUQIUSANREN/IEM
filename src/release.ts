/**
 * 用户可见版本与更新说明。
 * 最新一条必须放在数组最前面，其 version 与 package.json、tauri.conf.json、Cargo.toml 保持同一串。
 */
export interface ReleaseNotes {
  version: string
  /** 发版日期，仅展示用，如 2026-08-25 */
  date: string
  notes: string[]
}

export const CHANGELOG: readonly [ReleaseNotes, ...ReleaseNotes[]] = [
  {
    version: 'Alpha0.2.0',
    date: '2026-08-25',
    notes: [
      '导入新增OCR识别功能',
      '导入通知模块的文本解析功能优化',
      '新增了总览日历显示',
      '修改了总览页面样式',
      '优化布局导览和移动端各模块下滑时的顶部样式',
      '设置中添加余额校准设置，总览余额校准通过双击调整，长按显示说明文本',
      '设置中添加版本号和更新日志',
      '优化了UI细节',
    ],
  },
  {
    version: 'Alpha0.1.0',
    date: '2026-08-19',
    notes: [
      '本地记账，不登录支付宝、微信或网银',
      '导入支持官方账单、通知和邮件',
      '按发薪周期看限额、账本和盘点',
      '盘点直方图添加快速定位账单功能',
      '重构了设置页面布局',
      '优化旧表格展示，修改为卡片式',
    ],
  },
]

export const APP_VERSION = CHANGELOG[0].version

export function latestRelease(): ReleaseNotes {
  return CHANGELOG[0]
}
