# Windows 定制版维护

正式开发仓库是 `JackWenStack/CodexPlusPlus`。`main` 保存通过验证的定制版本，`upstream/main` 跟踪原仓库；本机开发目录为 `F:\CodexPlusPlus`。原来的 `F:\Codex++\repair\source` 仅保留历史基线。

## 当前基线与补丁

- 上游基线：`cf30215583f306c1a590c750e30c2dcdee8c39d8`。
- 迁移前已验证版本：标签 `archive/windows-local-20261020`，分支 `archive/windows-20261020`。
- 当前版本：`1.10.0-jack.6`。同一上游基线递增 `jack.N`；切换上游版本后更新三段基础版本，再从 `jack.1` 开始。
- 原 Windows 备份补丁已由上游 `00dace8` 覆盖，继续使用上游的 `sync_file`，不重复保留旧实现。
- 默认保留历史删除备份。上游新增的七天/十份自动清理仅保留为显式选择能力，普通删除流程不启用。
- 会话同步补丁保留上游隐藏行兜底，并增加旧版原生 dispatcher 识别、删除/撤销通知和超时处理。
- 移除管理器和注入菜单的推荐内容、概览赞助轮播及广告请求；旧广告接口保留空响应，旧推荐路由回到主页。
- 桌面端本地列表过滤明确的 CLI / exec 来源，保留桌面、未知来源和远端会话；只修改 renderer 列表镜像，不改历史文件或数据库。
- 透明遮罩补丁只修改确认样式，保留确认、取消、Esc、备份和撤销。
- 会话对齐缓存节点并在稳定后停止，关闭皮肤的清理只执行一次；插件扩展走专用接口，热更新撤销旧版全局数组筛选补丁。
- Dream Skin 开启时过滤纯文本/注释变更；补丁只在生成运行代码时应用，上游皮肤资源和 CSS 原样保留。新增元素仍沿用原有检查，上游同步需复核筛选补丁锚点及结构选择器是否依赖文本。
- 侧栏“更多操作”菜单随所属行/按钮组失效而回收，复用现有扫描并在热更新时清理；保留正常菜单和无内部归属标记的扩展菜单。

更新比较沿用项目原有数字基础版本语义，并额外比较 `jack.N`。例如 `1.10.0-jack.2` 高于 `1.10.0-jack.1`；普通 `beta.N` 后缀保持上游原有行为。

## 日常开发

```powershell
git remote -v
git switch main
git pull --ff-only origin main
git switch -c feature/session-ui
pwsh -File scripts/build-custom-windows.ps1
```

需要 Node.js 22 或更高版本、Rust MSVC 工具链、MSVC C++ 构建工具和 Windows SDK。`-Package` 另外要求 NSIS。脚本执行前端类型检查、前后端测试、构建；`-SkipTests` 仅用于相同源码已经完成适用测试时。

构建脚本为测试分配独立的临时 `CODEX_HOME` 和 `CODEX_PLUS_STATE_DIR`，结束后恢复调用环境。直接运行集成测试时也必须隔离这两个目录，避免默认路径读取正式皮肤备份或其他用户状态。

CI 使用 `scripts/prepare-windows-native.ps1` 把语音依赖放在 Rust 缓存目录之外，避免缓存清理删除原生 `.lib`。脚本固定 sherpa-onnx 1.13.8，并校验其官方 Release 资产的 SHA-256；升级此依赖时同时更新版本和校验值。

本机已有的隔离构建工具可以这样复用；这些环境变量只作用于当前 PowerShell：

```powershell
. 'F:\Codex++\repair\build-env.ps1'
Set-Location 'F:\CodexPlusPlus'
./scripts/build-custom-windows.ps1
```

构建产物位于 `dist/windows/app/codex-plus-plus.exe`。使用独立的 `CODEX_HOME`、`CODEX_PLUS_STATE_DIR`、guard 端口和 WebView 数据目录进行测试；实际用户目录不作为测试夹具。测试窗口标题和页面内必须标注“隔离测试”，避免将空白测试供应商列表误认为正式配置丢失。涉及可见交互时，在真实桌面 WebView 验收。不要把 `auth.json`、`config.toml`、会话、个人背景图或本机诊断文件提交到仓库。

## 按需同步上游

```powershell
git fetch upstream --tags
git switch main
git pull --ff-only origin main
git switch -c sync/upstream-review
git merge --no-commit upstream/main
```

先检查上游已覆盖的定制修复，再解决剩余冲突。保留 Fork 更新源、版本后缀与发布配置。重新组装注入产物并执行构建脚本：

```powershell
node scripts/assemble-renderer-inject.mjs
pwsh -File scripts/build-custom-windows.ps1
git diff --check
git add -u
git commit
```

根据实际改动另行加入新增文件；确认测试、真实界面和打包验证通过后再合入 `main`。只需要少量上游修复时，可以在同步分支选择性 cherry-pick，维护说明同时记录新的基线或选取的提交。已公开的分支与版本标签不强制改写。

## 版本与发布

升级时同步修改以下版本及其锁文件：根 `Cargo.toml`、`Cargo.lock` 中的四个工作区包、管理器 `package.json` / `package-lock.json`、`src-tauri/tauri.conf.json`。在 `docs/custom-releases` 添加同名版本说明。

`JackWen Windows build` 在 `main` 和 `custom/windows` 推送时运行验证并上传构建附件。上游的双平台构建、发布和网站部署工作流保留，但仅在原仓库运行，避免本 Fork 重复发布。

通过验证并合入 `main` 后，创建与包版本完全一致的标签。下面是首个版本的完整命令：

```powershell
git tag -a v1.10.0-jack.1 -m "Codex++ JackWen 1.10.0-jack.1"
git push origin main v1.10.0-jack.1
gh workflow run custom-windows.yml --repo JackWenStack/CodexPlusPlus --ref main -f tag=v1.10.0-jack.1
```

工作流先创建草稿 Release，包含：

- `CodexPlusPlus-1.10.0-jack.1-windows-x64-setup.exe`
- `CodexPlusPlus-1.10.0-jack.1-windows-x64.zip`
- `latest.json`
- `SHA256SUMS.txt`

下载便携包，核对 SHA-256，并完成独立实例验收后发布：

```powershell
gh release edit v1.10.0-jack.1 --repo JackWenStack/CodexPlusPlus --draft=false --latest --verify-tag
```

构建流程不需要第三方服务密钥；发布任务使用仓库自带的 `GITHUB_TOKEN`。默认更新地址是 `https://github.com/JackWenStack/CodexPlusPlus/releases/latest/download/latest.json`。草稿尚未发布时，这个公开地址不可用。

## 回滚

每次替换本机程序前，备份正在使用的 `codex-plus-plus.exe` 并记录 SHA-256。退出 Codex++ 后换回该副本，再启动确认后台服务就绪。仅回滚程序，不覆盖用户配置或会话库；会话恢复使用对应删除备份的撤销流程。

历史首次迁移前版本可从 `archive/windows-local-20261020` 重建。发现新版本问题时，保留失败日志，在修复分支解决后发布新的 `jack.N`，不覆盖已经公开的安装包或移动既有版本标签。
