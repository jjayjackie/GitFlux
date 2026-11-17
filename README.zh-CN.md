# Paseo 高级 Git

[English](README.md)

在每个 [Paseo](https://paseo.sh) 工作区旁提供完整的图形化 Git 客户端：左侧是仓库、分支、远程、标签、储藏、工作树和子模块；中间是更改、提交编辑区和提交图；右侧是差异、提交详情、文件历史、逐行追溯（blame）和冲突解决。所有 Git 命令都通过系统 `git` 在工作区所属的主机上执行，无论该主机是本地还是远程。

本插件由 [Source Control for Paseo](https://github.com/KosmoCHE/paseo-source-control) 深度重构而来，保留了其提交历史和许可证。

面板各部分的功能见 [docs/features.md](docs/features.md)；实现方式见 [docs/architecture.md](docs/architecture.md)。

## 环境要求

- Paseo 0.14.0 或更高版本，并已启用插件（设置 → 插件）。
- 运行插件的每台主机上：守护进程的 `PATH` 中有 `git` 2.35 或更高版本，以及 `npm`（Paseo 用它安装插件的三个运行时依赖）。
- 如需获取、拉取或推送，需在该主机上为守护进程所属用户配置好 Git 凭据（SSH 密钥或凭据助手）。插件从不索取、保存或传输密码或令牌。

## 安装

插件按主机安装：需要在每个要使用它的守护进程上分别安装。

### 从 GitHub 安装

```bash
paseo plugin install git:jjayjackie/paseo-advanced-git --ref v0.1.0
```

省略 `--ref` 则安装默认分支。也可以在应用中把 `git:jjayjackie/paseo-advanced-git` 粘贴到 **设置 → 插件 → 插件来源**，然后选择 **安装插件**。Paseo 会在插件目录中运行 `npm ci --omit=dev`，然后在主机上编译插件。

### 从发布归档安装

每个 [Release](https://github.com/jjayjackie/paseo-advanced-git/releases) 附带两个归档及其 `SHA256SUMS`：

| 归档 | 内容 | 适用场景 |
| --- | --- | --- |
| `paseo-advanced-git-<版本>.tgz` | Paseo 编译所需的源码 | 有 `npm` 且能联网的主机 |
| `paseo-advanced-git-<版本>-bundled.tgz` | 同上，另含 `node_modules` | 无法联网的主机 |

```bash
shasum -a 256 -c SHA256SUMS
tar -xzf paseo-advanced-git-0.1.0-bundled.tgz
paseo plugin install "$(pwd)/paseo-advanced-git-0.1.0"
```

从目录安装不会执行清单中的构建步骤：使用不含依赖的归档时，请先在解压后的目录中运行 `npm ci --omit=dev`。

### 检查安装

```bash
paseo plugin ls
paseo plugin logs advanced-git
```

打开一个工作区：**高级 Git** 会作为工作区标签页出现，也会出现在资源管理器中。它还会向命令中心添加命令（获取、拉取、推送、提交、创建分支、切换分支……）以及一个设置页面。

## 语言

面板通过 Paseo 自身的翻译 API 跟随 Paseo 的语言设置，包括“跟随系统”。插件提供英文和简体中文；其他语言回退为英文。Git 的输出、提交信息、分支名和路径按原样显示，不做翻译。

## 安全

- 破坏性操作——强制推送、硬重置、删除未合并的分支、移除有更改的工作树、清空所有储藏、删除远程上的分支或标签——**默认全部禁止**。每项操作在该主机的插件设置中都有独立开关；即使已允许，执行前仍会要求确认，并列出将丢失的内容。
- 强制推送始终使用 `--force-with-lease --force-if-includes`，从不使用单独的 `--force`。从不跳过 Git 钩子。
- 受保护的分支（默认 `main`、`master`、`develop`、`release/*`，可在设置中修改）无论开关如何设置，都不会被强制推送、硬重置或删除。
- 在可能丢弃已跟踪更改的操作之前，插件会把这些更改记录到 `refs/advanced-git/snapshots/` 下，可通过提交图的“安全快照…”菜单恢复（开关位于设置中）。这些引用会保留在仓库中，直到你删除它们。
- 拒绝内嵌凭据的远程 URL，任何地方显示的 URL 都会脱敏。

以上规则在主机侧强制执行，而不只是在面板中。

## 远程主机

面板只负责界面；每条 Git 命令都通过 Paseo 的插件 RPC，在工作区所属主机上的插件守护进程侧执行。插件不自行开放任何网络服务。切换主机时，面板会丢弃为上一台主机保存的所有内容：查询、缓存、选择状态和正在进行的操作状态都按主机隔离。主机离线时，面板会给出提示、禁用依赖主机的操作，并在主机恢复后重新读取全部数据。对同一仓库的操作串行执行，每条 Git 命令都有超时限制。

## 已知限制

- **凭据。** Git 在无终端的环境中运行，因此无法响应密码、密钥口令或主机密钥确认提示：这类操作会失败并给出说明。请为守护进程所属用户配置 SSH agent 或凭据助手。
- **设置按主机生效。** Paseo 0.14 只提供主机级设置，因此视图偏好（差异布局、字号、自动获取等）与安全开关一样，由该主机上所有使用本插件的人共享。
- **键盘快捷键**仅在桌面应用和浏览器中可用；iOS 和 Android 上没有快捷键。
- **打开文件**仅在桌面应用和浏览器中提供（与上游一样，需要网页环境）。
- **提交图**最多并排绘制十条泳道。
- **比较**只能在两个提交或分支之间进行；与工作树的比较请在“更改”窗格中查看。
- **交互式变基**支持 pick、reword、edit、squash、fixup、drop 和重新排序；不提供 `exec`、`break`、`label`、`merge` 行以及 `--rebase-merges`。
- **大型仓库**按有限的分段读取：列表、日志、差异和 blame 在达到 [shared/limits.ts](shared/limits.ts) 中的上限时停止，并会提示。
- **翻译**使用 Paseo 的 `defineTranslations` / `useTranslation`。它们已存在于 0.14.0 SDK 的类型声明和更新日志中，但 Paseo 插件参考文档仍将其标为“未发布 API”。

### 未在 CI 中验证

CI 在 Linux 和 Windows 上用临时仓库测试守护进程侧逻辑，把插件加载进真实的无界面 Paseo 守护进程（0.14.0 和最新版本，单主机和双主机），并在浏览器中驱动面板。以下内容无法在 CI 中验证：

- 使用真实凭据通过 SSH 或 HTTPS 对真实代码托管平台执行获取、拉取和推送（CI 使用本地裸仓库）；
- 通过 Paseo 中继或真实网络访问的远程主机，以及真实断网后的重连（CI 在浏览器预览中模拟主机离线）；
- iOS 和 Android 应用中的渲染（CI 只通过 React Native Web 渲染）；
- Paseo 桌面应用自身的窗口、菜单和文件标签页；
- macOS 上的守护进程侧逻辑（由于 GitHub 的 macOS 运行器资源紧张，CI 不使用 macOS），包括大小写不敏感的路径以及把放弃的未跟踪文件移到 macOS 废纸篓。

## 开发

开发者本机不进行任何构建或测试：类型检查、lint、单元测试、集成测试、端到端测试、插件加载和打包全部在 GitHub Actions 上运行。详见 [docs/development.md](docs/development.md)。

## 致谢与许可证

除图标外，本插件采用 MIT 许可证，见 [LICENSE](LICENSE)。

- 基于 [Source Control for Paseo](https://github.com/KosmoCHE/paseo-source-control)，Copyright (c) 2026 Kosmo CHE，MIT 许可证。
- 面板图标为 VS Code 的 codicons，© Microsoft Corporation，来自 [vscode-codicons](https://github.com/microsoft/vscode-codicons)，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可。仅保留每个图标的 SVG 路径，放在由 Paseo 设置颜色的内联 SVG 中。存放这些图标的 `client/ui/codicons.ts` 不受 MIT 许可证约束。其他图标为 Paseo 提供的 Lucide 图标。
- 仓库发现、差异布局（自动换行、折叠未更改的行、概览标尺）、冲突标记检测和配色的部分代码改编自 [VS Code](https://github.com/microsoft/vscode) 1.142.0，Copyright (c) Microsoft Corporation，采用 [MIT 许可证](https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt)。每个文件都注明了改编自何处。
- 运行时依赖：[vscode-diff](https://www.npmjs.com/package/vscode-diff)（MIT）、[strip-json-comments](https://www.npmjs.com/package/strip-json-comments)（MIT）和 [Prism](https://prismjs.com)（MIT）。
