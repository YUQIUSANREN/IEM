# IEM

IEM（Income and Expenditure Management）是本地优先的个人收支应用。同一套 Vue 3 界面，可跑：

- 网页（Vite）
- Windows / macOS 桌面（Tauri 2）
- Android / iOS（Tauri 2 移动端）

**给使用者看的功能说明**在 [GUIDE.md](./GUIDE.md)，应用内「指南」页内容一致。  
**本文是开发/编译操作手册**，避免以后忘记命令顺序。

---

## 1. 配置和确认本机环境

请按照下列参考确认是否存在相关SDK。

| 项 | 路径 / 说明 |
|---|---|
| JDK (建议17+) | `Java安装目录\JDK` |
| Android SDK | `Android SDK安装目录` |
| NDK | `AndroidSDK安装目录\ndk\30.0.15729638` |
| Android Studio | `Android Studio安装目录` |
| Rust | `stable-x86_64-pc-windows-msvc`（`rustc` 1.97+） |

系统环境变量（在「系统变量」里，不是用户变量）：

``` 示例路径
JAVA_HOME=D:\CodeSDK\Java\JDK
ANDROID_HOME=D:\CodeSDK\Android\Sdk
ANDROID_SDK_ROOT=D:\CodeSDK\Android\Sdk
```

系统 Path 中应包含：

- `%JAVA_HOME%\bin`
- `%ANDROID_HOME%\platform-tools`
- `%ANDROID_HOME%\emulator`

**不必**再设 `ANDROID_NDK_HOME`。NDK 装在 SDK 的 `ndk` 目录下即可。

改过环境变量后必须**关掉并重开** 终端，旧窗口读不到新变量。

检查：

```powershell
echo $env:JAVA_HOME
echo $env:ANDROID_HOME
echo $env:ANDROID_SDK_ROOT
java -version
adb version
dir $env:ANDROID_HOME\ndk
where.exe link
rustup target list --installed
```

国内镜像已写在仓库里，一般不用再改：

- npm：`.npmrc` → `https://registry.npmmirror.com`
- Cargo：`.cargo/config.toml` → [rsproxy](https://rsproxy.cn/)

```powershell
cd IEM根目录
npm install
```

---

## 2. 网页版

```powershell（在项目根目录）
cd IEM根目录
npm run dev
```

浏览器打开 http://127.0.0.1:1420/ 。第一次进入有引导；功能说明见 GUIDE.md。

数据在浏览器 IndexedDB，和桌面/手机**不自动同步**，换端请用「设置」导出备份。

### 端口被占用（关不掉旧进程）

Vite 固定占用 **1420**。若提示 `Port 1420 is already in use`，多半是上次 Vite 没退干净。当前终端 Ctrl+C 杀不到那个旧进程。

```powershell
netstat -ano | findstr ":1420"
taskkill /PID 上面列出的PID /F
```

然后再 `npm run dev`。

---

## 3. Windows 桌面

MSVC / `link.exe` **只给桌面用**，和 Android 无关。

需要：Visual Studio 或 [C++ 生成工具](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **「使用 C++ 的桌面开发」**。Windows 10/11 一般已有 WebView2。

```powershell
where.exe link
```

应能看到 `...\Hostx64\x64\link.exe`。找不到就重开终端；仍没有就检查 VS 是否装完。

开发（打开桌面窗口）：

```powershell
npm run tauri:dev
```

打安装包（exe / msi 等）：

```powershell
npm run tauri:build
```

桌面数据在应用数据目录的 SQLite，和网页版不是同一份库。

---

## 4. Android（详细）

Android Studio、SDK、NDK、JDK、Rust Android 目标都齐了之后，按下面做。界面仍是这套 Vue，**不要另起项目**。

**命令在哪跑：** `npx tauri android init` / `dev` / `build` 都是在项目根目录的 **PowerShell / Cursor 终端**里执行，**不是**在 Android Studio 里点 Build。

Android Studio 只用来：

- 装 SDK、NDK、平台工具
- Device Manager 里开模拟器
- 需要改原生代码（例如通知监听）时，打开 `src-tauri/gen/android` 这个 Gradle 工程

日常出包不要走 Android Studio 的 Run / Build，否则容易绕过 Tauri 对前端和 Rust 的打包。

Rust 目标（只需装一次，不是在 Android Studio 里装）：

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
```

`rustup target list --installed` 里应能看到这四个 `*-android`。

### 4.1 初始化安卓工程（每个克隆/本机只需一次）

在**项目根目录**：

```powershell
cd IEM根目录
npx tauri android init
```

作用：生成 `src-tauri/gen/android/`（Gradle / 清单 / 包名等）。  
**不要反复 init。** 以后改 Vue 代码，直接走 4.3 / 4.4。

失败时先新开 PowerShell，确认 `$env:ANDROID_HOME` 和 `$env:JAVA_HOME` 有值。

### 4.2 init 之后：准备设备

任选其一：

- Android Studio → Device Manager → 启动模拟器  
- 手机打开「开发者选项 + USB 调试」，用数据线连接  

确认：

```powershell
adb devices
```

至少有一行状态为 `device`。若是 `unauthorized`，在手机上点允许调试。

### 4.3 init 之后：开发运行

仍在**项目根目录终端**（不要开 Android Studio 再点 Run）：

```powershell
cd IEM根目录
npx tauri android dev
```

会编译 debug 包并安装到 4.2 里那台设备。第一次很慢。改前端后保存，按终端提示热更新或再跑一次该命令。

### 4.4 init 之后：打安装包

同样在**项目根目录终端**：

```powershell
cd IEM根目录
npx tauri android build
```

不要在 Android Studio 里点 Generate Signed Bundle / APK 来代替这条命令。需要改 Kotlin/清单时，可以先用 Studio 打开 `src-tauri/gen/android`，改完再回到终端执行上面的 `build`。

产物不在 `apk` 这一层，还要再往下两级。资源管理器里会先看到一堆文件夹，**文件名要进到 `universal\release` 才看得到**。本次成功构建的实际路径：

| 文件 | 完整路径 | 用途 |
|---|---|---|
| **未签名 APK** | `src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk` | 不能直接装，要先签名 |
| **已签名 APK** | `dist-android\IEM.apk` | 拷到手机安装 |
| **AAB** | `src-tauri\gen\android\app\build\outputs\bundle\universalRelease\app-universal-release.aab` | 上架商店，不要直接装手机 |

在资源管理器地址栏粘贴：

```text
IEM根目录\src-tauri\gen\android\app\build\outputs\apk\universal\release
```

或在项目根目录搜索 `*.apk`。

**注意：不要拿文件名带 `unsigned` 的包去装。** 未签名 APK 在国产机（小米 / 华为 / OPPO 等）上常提示 **`packageInfo is null`** 或「解析包失败」。

本次已签好的安装包（约 23MB）：

```text
IEM根目录\dist-android\IEM.apk
```

用数据线拷到手机后安装；不要走微信/QQ 传文件（容易损坏或改后缀）。手机需允许「安装未知来源应用」。

以后每次 `npx tauri android build` 之后再签一次：

```powershell
npm run android:sign
```

连着电脑时也可以：

```powershell
adb install -r "IEM根目录\dist-android\IEM.apk"
```

调试包（自带 debug 签名，不必再签）：

```powershell
npx tauri android build --debug
npx tauri android dev
```

正式发给别人或上架，需要自己的签名密钥，不要用这份调试证书。

### 4.5 Windows 打安卓包失败：符号链接

`android build` / `android dev` 会把编译出的 `.so` **符号链接**到 `src-tauri/gen/android/app/src/main/jniLibs/`。普通用户默认没有这个权限，会看到：

```text
Creation symbolic link is not allowed for this system.
You should use developer mode.
```

这和有没有打开 Android Studio 无关。处理：

1. `Win + I` → **系统** → **开发者选项**（或设置搜索「开发人员」）
2. 打开 **开发人员模式**（Developer Mode），同意提示
3. **关掉并重开** 终端（必要时重启一次 Windows）
4. 再执行：

```powershell
cd IEM根目录
npx tauri android build
```

若仍报同一错，可先删掉半成品再打：

```powershell
Remove-Item -Recurse -Force "src-tauri\gen\android\app\src\main\jniLibs" -ErrorAction SilentlyContinue
npx tauri android build
```

项目在 D 盘没问题，前提是该分区是 **NTFS**（资源管理器 → 盘符右键 → 属性）。exFAT / FAT32 不支持符号链接。

### 4.6 Gradle 报 `BuildScopeCompileServices.configure()`

符号链接过了之后，下一关是 Gradle。若看到：

```text
Could not configure services using BuildScopeServices.configure().
> Could not configure services using BuildScopeCompileServices.configure().
```

真正原因在 `--stacktrace` 里，本机是：

```text
ClassCastException: PlatformClassLoader cannot be cast to URLClassLoader
```

安装的JDK 名义上是 **JDK 17**，但目录里还留着旧 **JDK 8** 的文件（`lib\tools.jar`、`jre\` 实际是 `1.8.0_221`）。Gradle 8 发现 `tools.jar` 就会走 Java 8 那套注入逻辑，在 JDK 17 上直接崩。建议删除所有旧文件重新安装JDK 17，JDK8如果需要建议安装在其他目录。

**本工程已改用 Android Studio 自带 JDK**（`src-tauri/gen/android/gradle.properties` 里的 `org.gradle.java.home`）。若重新执行 `npx tauri android init` 冲掉了该文件，把下面这一行加回去：

```properties
org.gradle.java.home=Android Studio安装目录\\Android Studio\\jbr
```

并确保存在 `src-tauri/gen/android/local.properties`（此文件不进 Git）：

```properties
sdk.dir=Android SDK安装目录\\Sdk
```

长期建议：JDK 17 装到空目录，不要覆盖旧 JDK 8 文件夹。残留已隔离后，`JAVA_HOME` 可以继续给网页/桌面用；Android Gradle 仍优先走上面的 `org.gradle.java.home`。

另外，当前工程 `compileSdk = 36`，SDK 里需要 **Android API 36**。本机目前只有 34/35。没有 36 时，打开 Android Studio → SDK Manager → SDK Platforms → 勾选 **Android 16.0 (API 36)** → Apply。没有 cmdline-tools 时只能用 Studio 装平台。

### 4.7 通知栏自动记账（Android）

Android APK 已接入通知监听。用户打开系统「通知使用权」后，支付宝/微信等付款通知会进入「导入 → 通知」待确认，点入账才写入账本。

1. 真机：系统设置搜索「通知使用权」→ 允许 IEM  
2. 国产机：允许自启动，省电策略选无限制  
3. 若重新 `android init` 覆盖了工程，按 [native/android/README.md](./native/android/README.md) 把 Kotlin 服务再拷回去  

网页 / 桌面 / iPhone 仍用粘贴通知原文。iOS 没有对等能力。

### 4.8 和桌面命令不要混

| 目的 | 命令 |
|---|---|
| 网页 | `npm run dev` |
| Windows 窗口 | `npm run tauri:dev` |
| 安卓调试安装 | `npx tauri android dev` |
| 安卓 APK/AAB | `npx tauri android build` |

---

## 5. iOS

必须在 **Mac + Xcode** 上，Windows 打不出 iOS 包。

```bash
rustup target add aarch64-apple-ios
npx tauri ios init    # 一次
npx tauri ios dev
npx tauri ios build
```

真机/上架需要 Apple 开发者账号。记账用手动和文件导入。

建议顺序：网页 → Windows 桌面 → Android →（有 Mac 再）iOS。

---

## 6. 常用命令速查

```powershell
cd IEM根目录

npm install
npm run dev                 # 网页 http://127.0.0.1:1420
npm run tauri:dev           # Windows 桌面
npm run tauri:build         # Windows 安装包

npx tauri android init      # 仅一次，生成安卓工程
npx tauri android dev       # 安装到模拟器/真机
npx tauri android build     # 输出 APK / AAB

.\build-android-apk.ps1     # 编译并签名，输出 dist-android\IEM.apk（也可双击 build-android-apk.bat）
```

开发自测（不面向使用者）：
- 网页 / 桌面：设置里不放入口，浏览器打开 `#/lab`
- 手机：设置 → 关于 → 连点「版本 0.1.0」7 次露出入口，再输口令 `114514`（本次会话有效，杀进程后要再点再输）

---

## 7. 目录

- `src/` Vue 3 + TypeScript 界面与账本逻辑
- `src-tauri/` Tauri 桌面/移动壳
- `src-tauri/gen/android/` `android init` 之后才有，勿手改关键配置除非你知道在做什么
- `native/android/` 通知监听接入说明与 Kotlin 源文件
- `samples/` 示例账单格式
- `GUIDE.md` 使用者操作说明

网页数据在 IndexedDB；桌面/移动在各自应用目录。三端不自动同步。

---

## 8. 安全边界

不会模拟登录支付宝、微信或网银，也不会抓取未授权接口。导入只处理你提供的官方导出文件、邮件附件、系统通知或粘贴文本。
