# IEM 代码结构

本文说明仓库里**代码怎么分层、文件各管什么**。产品用法见 `GUIDE.md` / 应用内「指南」。

技术栈：**Vue 3 + TypeScript + Tauri 2**。一套 `src/` 同时服务网页、桌面和 Android。业务逻辑几乎全在前端；`src-tauri/` 只做窗口、文件系统和通知监听。

数据流向：**页面 → Store → `domain/engine` → `db`**。页面不直接写 SQL。

---

## 顶层目录

| 路径 | 作用 |
|---|---|
| `src/` | 界面和账本逻辑（日常改这里） |
| `src-tauri/` | 桌面 / Android 壳 |
| `public/` | 静态资源（如 `sql.js` 的 wasm） |
| `dist/` | `vite build` 产物，不必手改 |
| `index.html` | Web 入口 |
| `vite.config.ts` / `package.json` | 构建与依赖 |
| `GUIDE.md` | 使用说明（与指南页内容对应） |

`node_modules/`、`src-tauri/target/`、`src-tauri/gen/` 是依赖和编译产物。

---

## `src/`

```
src/
├── main.ts              启动：主题、布局、Pinia、路由
├── App.vue              根组件：开机、引导、记一笔弹层、Toast
├── style.css            全局主题色、按钮、吸顶栏等
├── types.ts             流水、限额、导入等类型
├── router/index.ts      Hash 路由
│
├── views/               一页一个路由
├── components/          多页共用的块
├── stores/app.ts        全局状态
├── domain/              记账规则（和界面无关）
├── db/                  SQLite 读写
├── import/              解析支付宝 / 微信 / 工行文件
├── platform/            网页 vs App 的差异
├── ui/                  主题、窄屏、Toast
├── composables/         列表过滤等
└── guides/content.ts    指南卡片文案
```

### 路由 `router/index.ts`

Hash 模式（`/#/ledger` 这类）。`AppShell` 包住主界面：

| 路径 | 页面 |
|---|---|
| `/` | 总览 `HomeView` |
| `/ledger` | 账本 `LedgerView` |
| `/import` | 导入 `ImportView` |
| `/report` | 盘点 `ReportView` |
| `/settings` | 设置 `SettingsView` |
| `/budget` | 限额 `BudgetView` |
| `/recurring` | 周期收支 `RecurringView` |
| `/guide` | 指南 `GuideView` |
| `/lab` | 实验室 `LabView`（需解锁） |
| `/onboarding` | 首次引导（在 Shell 外） |

手机底栏：总览 / 账本 / 导入 / 盘点 / 设置。限额、周期收支、指南从设置或电脑侧栏「更多」进入。

### 页面 `views/`

| 文件 | 职责 |
|---|---|
| `HomeView.vue` | 账面余额、周期 KPI、限额进度 |
| `LedgerView.vue` | 按天卡片、搜索、回到顶部 |
| `ImportView.vue` | 文件 / 目录监控 / 通知 / 邮件 |
| `ReportView.vue` | 周期盘点与图表 |
| `SettingsView.vue` | 外观、备份、清空、入口 |
| `BudgetView.vue` | 周期起始日与限额 |
| `RecurringView.vue` | 每月自动生成的收支规则 |
| `GuideView.vue` | 使用指南 |
| `OnboardingView.vue` | 第一次打开 |
| `LabView.vue` | 调试（不是给日常记账用的） |

### 组件 `components/`

| 文件 | 职责 |
|---|---|
| `AppShell.vue` | 电脑侧栏、手机底栏、主滚动区、记一笔 FAB |
| `TxForm.vue` | **记一笔和修改共用**这一份 |
| `TxDayCards.vue` | 按天分组的流水卡片 |
| `FileDropzone.vue` | 选文件 / 拖文件（手机与桌面样式不同） |
| `PeriodSelect.vue` | 周期下拉 |
| `PeriodCharts.vue` | 盘点图表 |
| `PeriodStartDayPicker.vue` | 周期起始日 |
| `ThemePicker.vue` | 外观 |
| `NiceSelect.vue` / `WheelPicker.vue` | 选择器 |
| `ToastHost.vue` / `NavIcon.vue` / `TxPager.vue` | 提示、导航图标、分页 |

### 状态 `stores/app.ts`

开机加载分类和流水、当前周期仪表盘、打开/关闭记一笔（`editingTx` 有值即修改）。页面改账后调 `refreshDashboard()`。

### 领域 `domain/`

和界面无关的规则，测试或改算法优先看这里。

| 文件 | 职责 |
|---|---|
| `engine.ts` | 增删改流水、限额、导入提交、余额、备份导出 |
| `period.ts` | 周期起止（默认每月 16 日切） |
| `money.ts` | 元 / 分 |
| `dedupe.ts` | 导入去重 |
| `tx-display.ts` | 金额展示、不计收支 |
| `chart-data.ts` | 图表用的聚合 |

### 存储 `db/`

- `schema.ts`：表结构
- `client.ts`：网页用 `sql.js`（wasm）；桌面 / App 用原生 SQLite 文件

### 导入 `import/bills.ts`

解析支付宝 CSV、微信 CSV/Excel、工行明细、`.eml`。预览和去重在 `domain/engine.ts`。

### 平台 `platform/`

| 文件 | 职责 |
|---|---|
| `env.ts` | 是否 Tauri / Android / iOS |
| `persist.ts` | 落盘 |
| `notify-listener.ts` | Android 通知入账队列 |
| `watch.ts` | 电脑监控下载目录 |
| `lab-gate.ts` | 实验室是否解锁 |

### `ui/` 与 `composables/`

- `theme.ts`：宣纸 / 墨夜 / 潮蓝 / 朱泥
- `layout.ts`：窄屏或手机 App 加上 `html.is-mobile`
- `toast.ts`：轻提示
- `useLedgerFeed.ts`：账本搜索（数据已在内存）
- `usePagedTransactions.ts`：实验室等分页

### 指南 `guides/content.ts`

`GuideView` 的卡片文案；`id: 'file'` 对应「导入支付宝 / 微信 / 工行账单」。导入页「导出指引」会跳到这一张。

---

## `src-tauri/`

```
src-tauri/
├── src/
│   ├── main.rs / lib.rs   Rust 入口
│   └── notify_bridge.rs   通知桥
├── tauri.conf.json        应用名、窗口、权限
└── gen/android/…          Android 工程
    └── …/IemNotificationListener.kt
```

前端用 `@tauri-apps/api` 和 fs / dialog 插件。Android 通知由 Kotlin 写入队列，前端再 drain。

---

## 一次操作怎么走

以账本里点「修改」为例：

1. `LedgerView` 调用 `store.openRecord(tx)`
2. `App.vue` 弹出 `TxForm`，传入该笔流水
3. 保存时 `TxForm` 调用 `updateTransaction`（`domain/engine.ts`）
4. `engine` 写 `db`，Store 刷新总览

记一笔是同一个 `TxForm`，只是不传 `tx`。

网页和 App 共用 `views` / `domain`；差别主要在 `platform/` 和 `src-tauri`。
