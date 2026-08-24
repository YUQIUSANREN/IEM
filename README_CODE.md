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
| `GUIDE.md` | 使用说明（应用内指南和首次引导只读这一份） |

`node_modules/`、`src-tauri/target/`、`src-tauri/gen/` 是依赖和编译产物。

---

## `src/`

```
src/
├── main.ts              启动：主题、布局、Pinia、路由
├── App.vue              根组件：开机、引导、记一笔弹层、Toast、更新说明
├── style.css            全局主题色、按钮、吸顶栏等
├── types.ts             流水、限额、导入等类型
├── release.ts           用户可见版本号与更新说明文案
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
└── guides/content.ts    从 GUIDE.md 解析指南卡片
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
| `ImportView.vue` | 文件 / 通知 / OCR / 邮件；目录监控仅电脑 |
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
| `ChangelogHost.vue` / `ConfirmHost.vue` | 更新说明弹层、确认框 |

### 状态 `stores/app.ts`

开机加载分类和流水、当前周期仪表盘、打开/关闭记一笔（`editingTx` 有值即修改）。页面改账后调 `refreshDashboard()`。

### 领域 `domain/`

和界面无关的规则，测试或改算法优先看这里。

| 文件 | 职责 |
|---|---|
| `engine.ts` | 增删改流水、限额、导入提交、余额、备份导出 |
| `changelog.ts` | 本机是否已看过当前版更新说明 |
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
- `changelog.ts`：升级后弹一次最新更新说明
- `useLedgerFeed.ts`：账本搜索（数据已在内存）
- `usePagedTransactions.ts`：实验室等分页

### 指南 `guides/content.ts`

从仓库根目录 `GUIDE.md` 解析卡片。改说明只改 `GUIDE.md`。`id: 'file'` 对应「导入支付宝 / 微信 / 工行文件」，导入页「导出指引」会跳到这一张。手机端会去掉「目录监控」那一节。

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

## 版本号与更新日志（发版时改）

用户能看到的版本串来自 `IEM根目录\src\release.ts` 里 **CHANGELOG 第一条** 的 `version`（当前 **`0.2.0`**）。打包用的号还要在 npm / Tauri / Cargo 里写成同一串。不要改依赖库自己的 version，也不要改 `Cargo.toml` 里的 `rust-version`（那是 Rust 编译器最低版本）。

新用户：先走完首次指南，进入账本后再弹**当前这一版**的说明。老用户：版本号变了才弹一次。设置 → 关于里可以随时翻全部历史。点「知道了」或点遮罩即记下「这版看过了」，同一版本不再弹。

### 必须手改（四处同一串，例如 `0.2.0` → `0.2.0`）

| 路径 | 改什么 | 作用 |
|---|---|---|
| `IEM根目录\src\release.ts` | 在 `CHANGELOG` **最上面**加一条：`version`、`date`、若干条用户能感知的 `notes` | 应用内「关于」列表、升级弹窗文案，以及设置页显示的版本号 |
| `IEM根目录\package.json` | 顶层 `"version"` | npm / 网页包版本 |
| `IEM根目录\src-tauri\tauri.conf.json` | 顶层 `"version"` | Windows 安装包、Android `versionName`；打包时还会据此生成 Android `versionCode` |
| `IEM根目录\src-tauri\Cargo.toml` | `[package]` 下的 `version` | Rust 壳 crate 版本 |

不要改 `SettingsView.vue` 里的版本数字，它读 `APP_VERSION`。

### 更新说明怎么写

- 只写用户能觉察的变化（新入口、行为变了、要重新授权）。重构、依赖升级、内部警告不要写。
- 新的一条放在数组**最前面**，旧的不要删。
- 弹窗只取第一条（当前版）。从 0.1 跳到 0.3 也只弹 0.3。
- 3～7 条为宜，用短句，不要贴 git commit。
- `version` 必须和上面三个配置文件里的号相同，否则界面是新号、安装包仍是旧号（或反过来）。

### 会跟着变、一般不用手改

| 路径 | 说明 |
|---|---|
| `IEM根目录\package-lock.json` | 文件开头 `"version"` 和 `packages.""` 里的 `"version"`。改完 `package.json` 后跑一次 `npm install` 会对齐；也可两处手改成同一串 |
| `IEM根目录\src-tauri\Cargo.lock` | 搜 `name = "iem"` 那一段的 `version`。下次 `cargo` / `tauri` 编译会自动改 |

Android 工程 `IEM根目录\src-tauri\gen\android\app\build.gradle.kts` 从打包时生成的 `tauri.properties` 读 `versionName` / `versionCode`，**不要手改 gradle**。覆盖安装 APK 时系统看的是 `versionCode`（随 `tauri.conf.json` 的主.次.修订递增）；只加功能不升这个号，手机上可能装不上或仍显示旧版。

### 文档里若写了具体版本

`IEM根目录\README.md` 实验室说明已改成「连点版本号」，一般不必跟着改数字。若别处文档又写死了版本串，发版时一并改掉。

### 建议步骤

1. 定新号（semver：修 bug 升最后一位，有功能升中间位）。
2. 在 `src\release.ts` 最上面加一条更新说明，`version` 写成新号。
3. 把 `package.json`、`tauri.conf.json`、`Cargo.toml` 改成同一串。
4. 跑 `npm install`（或手改 lock）；编译一次桌面或 Android，让 `Cargo.lock` 跟上。
5. 再打包。Windows 用 `npm run tauri:build`；Android 签好的包在 `IEM根目录\dist-android\IEM.apk`。
6. 打开应用：设置 → 关于，确认版本号和新说明都在；用旧数据升级安装时，应弹出当前这一版（不是全部历史）。

---

## 一次操作怎么走

以账本里点「修改」为例：

1. `LedgerView` 调用 `store.openRecord(tx)`
2. `App.vue` 弹出 `TxForm`，传入该笔流水
3. 保存时 `TxForm` 调用 `updateTransaction`（`domain/engine.ts`）
4. `engine` 写 `db`，Store 刷新总览

记一笔是同一个 `TxForm`，只是不传 `tx`。

网页和 App 共用 `views` / `domain`；差别主要在 `platform/` 和 `src-tauri`。
