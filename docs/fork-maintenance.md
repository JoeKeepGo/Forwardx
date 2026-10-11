# Pocket ID 分支维护

此仓库是 [JoeKeepGo/Forwardx](https://github.com/JoeKeepGo/Forwardx)，上游为
[poouo/Forwardx](https://github.com/poouo/Forwardx)。原项目的许可证和归属保持不变。

## 分支与部署

- `pocket-id-oidc`：本仓库的默认分支，包含 Pocket ID 登录及对应测试。
- `main`：保留上游代码；本次基线为 `fb7e959bf19c80f417c9ff0e01e3d801478553cf`（2.3.282）。
- `origin` 指向本仓库，`upstream` 指向原仓库。

上游 README 的安装脚本、镜像和 Release 链接仍指向原项目，不包含这里新增的 OIDC。
部署本分支时使用 `ghcr.io/joekeepgo/forwardx:oidc`，或按
[Pocket ID 配置与迁移指南](guide/oidc-login.md) 从源码构建。
镜像发布由所有者明确要求后手动触发；不创建 GitHub Release，也不部署线上服务。

## 更新流程

每周检查上游变动和本仓库认证 CI。无变化或不影响本分支时保持安静；仅在更新影响
OIDC/账户兼容性、测试失败或需要仓库所有者处理时通知。

1. 获取上游最新提交，审查认证、配置、会话、2FA、注册限制、数据库和依赖相关变更。
2. 使用独立临时分支/工作目录试合并，保留当前分支和未提交工作。
3. 核对原有 Google 账户兼容、issuer/sub 隔离、禁止邮件自动合并，以及切换提供商的恢复流程。
4. 运行认证测试、类型检查和构建；给出具体可审查的变更及风险。
5. 由所有者确认是否合并。周期检查不自动合并、推送修复、发布或部署。

数据库 schema 与迁移文件、Agent、转发引擎和规则均不在本分支的修改范围内。
如上游变化导致无法继续遵守这些边界，先提交审查结果，不绕过限制。

## 自动测试

`.github/workflows/oidc-auth.yml` 在维护分支推送和面向该分支的 PR 上运行，权限仅为
读取源码。使用 Node.js 22 和锁定的依赖，执行 Google/OIDC 集成测试、认证回归测试、
类型检查、面板构建及文档构建；不发布构建产物。

本地运行 `pnpm install --frozen-lockfile` 后，按该工作流执行同样的检查。
原上游 CI 和手动发布工作流保留，不应将发布工作流作为认证验证手段。

## Docker 镜像发布

`.github/workflows/docker-image.yml` 在本 fork 中发布至
`ghcr.io/joekeepgo/forwardx`，仅允许维护分支。手动选择 **Pocket ID Docker Image**
工作流，且该提交的 **OIDC authentication** CI 必须已成功。

两个原生 runner 分别构建 `linux/amd64` 和 `linux/arm64`，验证 SQLite 原生模块、
架构/版本、OIDC 回调代码，以及隔离容器的启动与 HTTP 回调。全部通过后才合并为
多架构镜像，并标记 `oidc` 和 `oidc-<提交前 12 位>`。固定版本标签可追溯具体源码；
生产固定镜像时也可使用工作流摘要中的 digest。

首次发布后需在 GitHub Package settings 将 `forwardx` 设置为 Public，确认匿名拉取
正常。工作流使用仓库自带的临时 `GITHUB_TOKEN`，不要求用户提供镜像仓库密码。
后续周期维护仍不自动发布镜像；需要所有者明确授权。

实际 Pocket ID 实例仍需按部署指南验证回调、账户绑定、2FA 和密码恢复。
