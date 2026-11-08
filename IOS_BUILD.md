# 课序 iOS 构建 / 安装说明

当前工程是 **Expo SDK 58 + React Native + TypeScript**，功能与 Android 1.3.1 对齐；iOS 原生部分（Live Activity/灵动岛、局域网导入）通过 config plugin/原生模块接入。

## 方式一：GitHub Actions（推荐，无需 Mac）

1. 在 GitHub 创建空的 **private 或 public** 仓库（不要初始化 README）。
2. 本仓库的 CI：`.github/workflows/ios.yml`
   - `macos-15` runner
   - `npm ci`
   - `npx expo prebuild --platform ios --clean --no-install`
   - `pod install`
   - 模拟器 Build 验证
   - iPhoneOS Build（禁用签名）→ `ClassBoard-unsigned.ipa` artifact
3. 运行 workflow（push main 或手动 Run workflow）。
4. 下载 Actions artifact `ClassBoard-unsigned-ipa`。
5. Windows 安装：
   - 安装 Apple Devices（或 iTunes）与 [Sideloadly](https://sideloadly.io/)；
   - iPhone 连接 Windows，信任电脑；
   - Sideloadly 选择 `ClassBoard-unsigned.ipa`，登录免费 Apple ID，开始签名安装；
   - 免费 Apple ID 有效期 7 天，到期在 Sideloadly 重新签名；
   - 长期使用建议 Apple Developer Program（$99/年）。

> Live Activity/Widget 使用 iOS extension；免费签名/Sideloadly 对 extension 的重新签名兼容性需实测。如果 Sideloadly 安装失败，可改用付费开发者账号 + EAS Build/TestFlight，或在你自己的 Mac 上 Xcode 直接运行。

## 方式二：EAS Build（有 Expo/Apple 账号时）

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile preview
```

需要在 `eas.json` 中配置 `preview` 为 `internal` 分发，并让 EAS 管理 Apple 证书/描述文件（通常需要付费 Apple Developer 账号）。

## 本机验证

```bash
npm install
npx tsc --noEmit
npx expo start --web   # 仅 UI/逻辑预览；Live Activity/局域网导入需开发构建
```

## iOS 与 Android 的差异（必须了解）

- **通知栏常驻**：iOS 没有 Android 式常驻通知，使用 Live Activity（锁屏/通知中心）+ 本地通知近似。
- **灵动岛**：ActivityKit，需要 iPhone 14 Pro 及以上 + iOS 16.1+；本工程最低 iOS 16.4。
- **桌面组件**：iOS 对应 WidgetKit，后续以 extension 接入（当前版本先完成 Live Activity）。
- **后台刷新**：iOS 不允许 Android 前台服务式常驻；课程提醒使用本地定时通知，Live Activity 倒计时由系统展示。
- **局域网导入**：使用 `react-native-tcp-socket` + `react-native-udp` 原生模块，Expo Go 不可用，必须 development build/unsigned IPA。
- **教务网导入**：依赖 iOS NSURLSession Cookie；需真机验证学校 SSO/验证码。
