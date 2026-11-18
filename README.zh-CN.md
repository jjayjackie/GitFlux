<div align="center">

<img src="assets/icon.png" alt="GitFlux 图标" width="128" height="128">

# GitFlux

**在每个 [Paseo](https://paseo.sh) 工作区中使用完整的图形化 Git 客户端。**

逐行暂存、阅读提交图、交互式变基、解决冲突，<br>
在 Paseo 能连接的任何主机上，从桌面到手机都能使用。

[![CI](https://github.com/jjayjackie/GitFlux/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jjayjackie/GitFlux/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jjayjackie/GitFlux?sort=semver)](https://github.com/jjayjackie/GitFlux/releases)
[![Paseo](https://img.shields.io/badge/Paseo-%E2%89%A5%200.14.0-5b6cff)](https://paseo.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[English](README.md) · **简体中文**

[功能](#功能) · [界面一览](#界面一览) · [安装](#安装) · [安全](#默认安全) · [文档](#文档)

</div>

<br>

![GitFlux：导航、更改与提交图，以及提交详情和差异](media/commit.png)

## 功能

GitFlux 在工作区所属的主机上（无论本地还是远程）调用系统 `git`，并以三栏面板呈现一切。凡是 VS Code 源代码管理已有的行为都与其保持一致，VS Code 没有的部分则参考 GitLens、Git Graph 和 Fork。

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>📁 所有仓库</h3>
      嵌套仓库、子模块和关联工作树集中在同一个导航中，各自显示分支、领先 / 落后的提交数和状态；分支、远程、标签、储藏、工作树和子模块也都在旁边。
    </td>
    <td width="50%" valign="top">
      <h3>✏️ 精确暂存</h3>
      按文件、文件夹、代码块或单行暂存、取消暂存或放弃更改。提交、修补、签收、提交并推送、提交并同步，每个仓库各自保留草稿。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🌳 可操作的提交图</h3>
      显示所有分支或仅当前分支，标出传入与传出的更改，可按消息、作者、哈希、路径或内容搜索。拣选、还原、重置、比较，每个分支和标签徽标都有完整菜单。
    </td>
    <td valign="top">
      <h3>🔀 从容改写历史</h3>
      交互式变基支持 pick、reword、edit、squash、fixup、drop 和调整顺序，并随时检查计划。合并、变基和拣选进行中时，横幅提供继续、跳过和中止。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🧩 差异与冲突</h3>
      采用 VS Code 的差异算法和布局，支持并排或内联显示，约 40 种语言的语法着色。可逐块解决冲突、整体采用某一方，或直接编辑结果。
    </td>
    <td valign="top">
      <h3>🛡️ 默认安全</h3>
      强制推送、硬重置和删除操作在主机允许之前一律禁止，执行前始终确认，且永远不会作用于受保护的分支。即将被放弃的更改会先保存快照。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>📱 从桌面到手机</h3>
      三栏布局可拖动调整，在窄屏上折叠为标签页。浅色与深色主题跟随 Paseo。
    </td>
    <td valign="top">
      <h3>🌐 English 与简体中文</h3>
      界面跟随 Paseo 的语言设置。Git 自身的输出、提交消息、名称和路径不会被翻译。
    </td>
  </tr>
</table>

逐个窗格的完整功能说明见 [docs/features.zh-CN.md](docs/features.zh-CN.md)。

## 界面一览

### 差异

并排或内联显示，标出改动的词语，折叠未更改的区域，可显示或忽略空白更改。在 **代码块** 模式下，可以暂存、取消暂存或放弃单个代码块或选中的行。

![带语法着色的文件差异](media/diff.png)

### 冲突

以 Git 自己的标签显示当前与传入两侧，以及共同祖先和合并结果。逐块选择采用哪一方、编辑文本，没有冲突标记后即可将文件标记为已解决。

![正在解决的合并冲突](media/conflict.png)

### 随处可用

<table>
  <tr>
    <td width="30%" align="center" valign="top">
      <img src="media/narrow.png" alt="手机宽度下的 GitFlux" width="240"><br>
      <sub>手机宽度：一次显示一个窗格，以标签切换</sub>
    </td>
    <td width="70%" align="center" valign="top">
      <img src="media/zh-CN-light.png" alt="浅色主题下的简体中文界面"><br>
      <sub>简体中文，浅色主题</sub>
    </td>
  </tr>
</table>

### 键盘快捷键

| 按键 | 操作 |
| --- | --- |
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> | 提交 |
| <kbd>Alt</kbd> + <kbd>B</kbd> | 切换分支 |
| <kbd>Alt</kbd> + <kbd>E</kbd> | 显示或隐藏导航 |
| <kbd>F7</kbd> / <kbd>Shift</kbd> + <kbd>F7</kbd> | 差异中的下一处 / 上一处更改 |
| <kbd>?</kbd> | 查看全部快捷键 |

快捷键在桌面应用和浏览器中可用。每个操作也都有按钮和右键菜单项（手机上为长按），常用操作还出现在命令中心里。

## 安装

**环境要求：** Paseo 0.14.0 或更高版本；运行插件的每台主机上，守护进程的 `PATH` 中需要有 `git` 2.35+ 和 `npm`。

**从 Git 安装**（推荐）：

```bash
paseo plugin install git:jjayjackie/GitFlux
```

也可以在 **设置 → 插件 → 插件来源** 中粘贴 `git:jjayjackie/GitFlux`。如需固定版本，请加上 `--ref v<版本>`，标签见 [Releases](https://github.com/jjayjackie/GitFlux/releases)。

**无法联网的主机：** 从 [Releases](https://github.com/jjayjackie/GitFlux/releases) 下载 `gitflux-<版本>-bundled.tgz` 和 `SHA256SUMS`，然后：

```bash
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf gitflux-<版本>-bundled.tgz
paseo plugin install "$(pwd)/gitflux-<版本>"
```

打开一个工作区：**GitFlux** 会作为标签页出现，也会出现在资源管理器中，它的命令在命令中心里。

> [!IMPORTANT]
> **从 0.2.0 或更早版本（当时名为“高级 Git”）升级：** 插件 ID 已从 `advanced-git` 改为 `gitflux`，Paseo 会把 GitFlux 当作新插件。请先卸载 `advanced-git`，再安装 GitFlux，并重新开启安全设置。改名前的安全快照仍保存在各仓库的 `refs/advanced-git/snapshots/` 下，但不再列出。

## 默认安全

![安全设置：所有破坏性操作的开关默认关闭](media/safety.png)

| 防护 | 含义 |
| --- | --- |
| **默认禁止** | 强制推送、硬重置、强制删除和删除远程上的内容，在主机设置允许之前都会被主机拒绝。 |
| **始终确认** | 每个破坏性操作都会列出将丢失的内容并先询问；硬重置需要输入分支名称。 |
| **带 lease 的强制推送** | 强制推送始终使用 `--force-with-lease`，从不使用单独的 `--force`。 |
| **受保护的分支** | 默认 `main`、`master`、`develop` 和 `release/*` 永远不会被强制推送、硬重置或删除。 |
| **安全快照** | 即将被放弃的已跟踪更改会先记录到 `refs/gitflux/snapshots/` 下，一键即可恢复。 |
| **不经手凭据** | GitFlux 从不索取、保存或发送密码和令牌：Git 使用主机上的 SSH 密钥或凭据助手。 |
| **钩子照常运行** | Git 钩子始终运行，从不使用 `--no-verify` 提交或推送。 |

<details>
<summary><strong>已知限制</strong></summary>

<br>

- Git 在没有终端的情况下运行，无法回答密码或主机密钥提示：请在主机上配置 SSH 代理或凭据助手。
- 设置按主机保存（Paseo 0.14 没有按设备保存的设置），因此同一主机上的所有人共享视图偏好。
- 键盘快捷键和“打开文件”仅在桌面应用和浏览器中可用，iOS 和 Android 应用中不可用。
- 交互式变基支持 pick、reword、edit、squash、fixup 和 drop，不支持 `exec`、`break` 和 `--rebase-merges`。
- 未在 CI 中验证：使用真实凭据访问真实代码托管平台、通过真实网络连接的远程主机、iOS / Android 原生渲染，以及 macOS。详见 [docs/design.md](docs/design.md) 和 [docs/development.md](docs/development.md)。

</details>

## 文档

| 文档 | 内容 |
| --- | --- |
| [功能详解](docs/features.zh-CN.md) · [Features](docs/features.md) | 面板的全部功能，逐个窗格说明 |
| [Design](docs/design.md)（英文） | GitFlux 在哪些方面遵循 VS Code、哪些方面不同，以及原因 |
| [Architecture](docs/architecture.md)（英文） | 开发约定：标识、目录结构、RPC、安全规则、上限 |
| [Development](docs/development.md)（英文） | CI 如何检查每次更改，以及如何添加功能 |

## 参与开发

本地不进行任何构建或测试：类型检查、lint、单元测试、集成测试、浏览器测试、加载到真实 Paseo 守护进程以及打包，全部在 GitHub Actions 上运行。推送分支、创建拉取请求，然后查看检查结果即可。请先阅读 [docs/development.md](docs/development.md) 和 [docs/architecture.md](docs/architecture.md) 第 1 节中的规则。

## 致谢

- 基于 Kosmo CHE 的 [Source Control for Paseo](https://github.com/KosmoCHE/paseo-source-control)（MIT）。
- 仓库发现、差异布局、冲突标记解析和配色的部分代码改编自 [VS Code](https://github.com/microsoft/vscode) 1.142.0，© Microsoft Corporation（MIT）；每个文件都注明了所借鉴的内容。
- 图标：VS Code 的 [codicons](https://github.com/microsoft/vscode-codicons)，© Microsoft Corporation，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（位于 `client/ui/codicons.ts`，不适用 MIT 许可证），以及由 Paseo 提供的 [Lucide](https://lucide.dev) 图标。
- 设计参考：VS Code 源代码管理、[GitLens](https://github.com/gitkraken/vscode-gitlens)、[Git Graph](https://github.com/mhutchie/vscode-git-graph) 和 [Fork](https://git-fork.com)。
- 运行时依赖：[vscode-diff](https://www.npmjs.com/package/vscode-diff)、[strip-json-comments](https://www.npmjs.com/package/strip-json-comments) 和 [Prism](https://prismjs.com)，均为 MIT 许可证。

## 许可证

[MIT](LICENSE)，`client/ui/codicons.ts` 中的 codicons 除外（CC BY 4.0）。
