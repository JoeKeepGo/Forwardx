# OIDC / Pocket ID 登录

这是可选的单一提供商模式：Google 和自定义 OIDC 二选一。默认仍为 Google（未配置时关闭），密码登录保持可用；浏览器登录和注册页显示所选提供商的按钮。原有会话、权限、禁用用户、多设备策略、注册开关、邮箱白名单和 2FA 保持生效。移动 App 请继续使用原有登录方式。

## 企业界面

本 fork 默认隐藏 Telegram/Discord 快捷登录、链接自动登录、账户绑定和绑定状态、
机器人设置、公告机器人推送、社群链接，以及普通用户的商店、账单购买入口和订阅
续费/附加流量购买按钮。保留 Pocket ID、密码登录、2FA、邮件、AI 助手配置、已分配
订阅、管理员套餐管理、项目源码和文档链接。

这是界面隐藏，不会删除既有绑定、关闭已配置的后台机器人、改变 API 权限或禁用交易
接口。企业部署如需停止机器人，应在更新前关闭原通知配置。数据库、Agent 与转发规则
保持原样。更新镜像后界面生效，发布镜像本身不会更新线上容器。

仅在需要恢复原社群界面时，在**前端构建时**设置 `VITE_FORWARDX_COMMUNITY_UI=1`；
运行容器时设置此变量不会改变已构建的界面。

## Pocket ID 配置

1. 在 Pocket ID 创建一个机密 OIDC 客户端，允许回调地址填写 `https://panel.example.com/api/auth/oidc/callback`，不要使用通配符；在客户端 Access 中选择允许的用户组或 All Users。
2. 保留 Pocket ID 默认 RS256 签名密钥；保持默认同源端点，不要将 INTERNAL_APP_URL 配成不同域名。需要 `openid email profile`，授权码流程和 PKCE S256。在 Pocket ID 的 OIDC Data Preview 检查该客户端的 ID token 包含 `sub`、有效邮箱和布尔值 `email_verified: true`；未验证邮箱会拒绝登录。
3. 在 ForwardX “系统设置 → 系统配置 → SSO 账户登录”选择 **OIDC / Pocket ID**，填写以下内容：

| 设置 | 示例 |
| --- | --- |
| OIDC Issuer | `https://id.example.com` |
| 登录按钮名称 | `Pocket ID` |
| Client ID | Pocket ID 创建的客户端 ID |
| Client Secret | Pocket ID 创建的客户端密钥 |
| 授权回调地址 | `https://panel.example.com/api/auth/oidc/callback` |

Issuer 必须与 discovery 的 `issuer` **完全一致**，包括尾部斜杠；不要填写 `/.well-known/openid-configuration` 地址。保存并启用后，浏览器从回调地址的同一域名发起登录。客户端密钥只由服务端使用，设置响应不返回密钥；同一提供商留空保留，切换提供商/issuer 时必须重新填写。

配置继续保存在现有 `system_settings` 的 `googleOAuthCredentials` 记录，配置格式示例如下（说明用，**通过设置 UI 保存**，不要直接改数据库）：

```json
{
  "enabled": true,
  "provider": "oidc",
  "issuer": "https://id.example.com",
  "label": "Pocket ID",
  "clientId": "replace-with-pocket-client-id",
  "clientSecret": "replace-with-pocket-client-secret",
  "redirectUri": "https://panel.example.com/api/auth/oidc/callback"
}
```

不添加 OIDC 环境变量覆盖，以免重启或修改部署环境绕过提供商切换保护。只有管理员设置接口能够更改此配置。

## 拉取已发布镜像

本 fork 的 Pocket ID 镜像为 `ghcr.io/joekeepgo/forwardx:oidc`，支持
`linux/amd64` 和 `linux/arm64`。官方 `ghcr.io/poouo/forwardx` 不包含本分支的 OIDC。

```sh
docker pull ghcr.io/joekeepgo/forwardx:oidc
```

在**原有部署目录**创建或修改 `docker-compose.override.yml`，沿用原来的 `.env`、
Compose 项目名和数据卷：

```yaml
services:
  forwardx:
    image: ghcr.io/joekeepgo/forwardx:oidc
    pull_policy: always
```

```sh
docker compose pull forwardx
docker compose up -d --no-deps forwardx
```

若此前用了 `forwardx:oidc-local` 和 `pull_policy: never`，需一起替换为上面的配置。
`oidc` 会在经明确授权的后续发布中更新；需要固定版本时，使用
[镜像发布工作流](https://github.com/JoeKeepGo/Forwardx/actions/workflows/docker-image.yml)
摘要中的 `oidc-<提交前 12 位>` 标签或 digest。镜像发布本身不会更改线上容器。

## 本地构建与部署示例

此功能需要包含补丁的面板镜像，官方原镜像不包含补丁。以下仅为操作示例，不会自动部署。Node.js 22 与项目 Dockerfile 一致。

```sh
pnpm install --frozen-lockfile
pnpm test:oidc-auth
pnpm build
# 如需 Docker，在包含补丁的代码目录手动构建：
docker build -t forwardx:oidc-local .
```

在现有 Compose 文件旁创建 `docker-compose.override.yml`，复用原有数据卷、端口和环境配置：

```yaml
services:
  forwardx:
    image: forwardx:oidc-local
    pull_policy: never
```

反向代理照常将 `/api/` 转发到面板，不额外开放 OIDC 端口。生产面板和 issuer 使用有效 HTTPS；面板回调仅在明确的 localhost/127.0.0.1/::1 本机开发时允许 HTTP。浏览器和面板均须能访问 Pocket ID。不要使用面板的官方镜像自动升级覆盖补丁；跟进上游时先重新应用补丁并运行认证测试。

## 旧 Google 账户安全迁移

**不会按邮箱自动合并，也不会把 Google 的原始 sub 当作 Pocket ID 身份。** Google 原有数据不修改；OIDC 使用 `oidc:SHA256(issuer):SHA256(sub)`，长度 134，分别计算散列以保留大小写区别、适配现有 255 字符字段和数据库排序规则。

1. 备份现有数据库及设置。保持原 Google 配置可用，让每个绑定用户通过 Google 登录；有 2FA 的用户仍须完成 2FA。
2. 无密码用户在登录后五分钟内去个人中心设置密码；所有迁移用户实际确认密码登录可用，管理员保留密码恢复入口。服务端只检查密码已设置，无法代替用户确认记得密码。
3. 管理员改为 Pocket ID 配置，阅读并勾选切换提示后保存。**只要还有任何已绑定的无密码账户（包括禁用账户），服务器就会阻止切换**；须先恢复账户/处理密码，或在确认密码后主动解绑。
4. 切换后，旧绑定仍保留；个人中心提示它属于旧提供商。用户用密码进入，验证当前密码解绑旧身份，再点击“绑定 SSO 账户”，通过 Pocket ID 授权。绑定到原用户，角色、权限和 2FA 不变。
5. 使用 Pocket ID 登录验证成功。关闭注册不会阻止已登录用户主动绑定；未绑定身份不能在关闭注册时新建账户。

更换 OIDC issuer、由 OIDC 切回 Google，甚至先关闭再切换，也采用相同保护。不会清空全体绑定或在回调中替换旧绑定。切换前若用户已解绑，随后回滚配置不会恢复已解绑的数据；需用密码重新绑定。不要把 `googleSubject` 从备份批量覆盖到正在使用的新配置。

## 验证边界与限制

- discovery 精确校验 issuer，所有端点必须与 issuer 同源 HTTPS，无 URL 凭据、查询参数或片段；禁止 HTTP 重定向。这是 Pocket ID 所需的较小兼容范围，跨域端点的其他 OIDC 提供商暂不支持。
- 授权码 + PKCE S256；state 在服务端内存中，十分钟有效、浏览器 HttpOnly/SameSite=Lax Cookie 绑定、成功消费即删除。nonce 与验证后的 ID token 严格匹配；配置变化或绑定会话过期时拒绝回调。
- 固定 RS256、discovery JWKS 公钥验证、至少 2048 位 RSA；忽略 token 提供的 jku/x5u，不跟随它们。检查 issuer、audience、azp、exp、最近十分钟的 iat、nonce、sub 和已验证邮箱；不接受 unsigned/HMAC token，也不使用未验证的 userinfo 作为身份。
- 支持 discovery 声明的 `client_secret_basic` 和 `client_secret_post`，优先 basic。请求十秒超时，响应最多 128 KB；discovery、JWKS、state 和并发请求均有上限，未知 kid 触发的刷新每三十秒最多一次。
- 使用原有数据库唯一约束；设置切换与账户解析在同一面板进程内串行，并在写入绑定前再次检查配置。**只支持单面板进程**，不要把多个面板实例接到同一数据库或对登录回调做跨实例负载均衡，内存 state 无法跨实例共享。
- Pocket ID 停用用户或移除客户端权限会影响下一次 OIDC 登录；已签发的 ForwardX 会话仍由原有有效期和禁用用户机制控制。本改动不实现即时跨系统注销、refresh token 或组到角色映射。
- 不修改 schema、迁移、Agent、转发引擎或规则。不存储 access/refresh token，不新增认证框架依赖。数据库内仍使用原 Google 字段和 `!google-only` 无密码标记以保持兼容；回滚到未打补丁的版本后 OIDC 绑定不能用于 Google 登录，需使用密码恢复。

## 测试与排障

`pnpm test:oidc-auth` 包含原 Google 回归、OIDC 错误 token/discovery、浏览器 state/重放、PKCE、客户端认证、JWKS 缓存和轮换，以及真实 SQLite + HTTP 的登录、绑定、迁移、注册限制、禁用用户和 2FA 测试。提供商网络由本地测试替身模拟；上线前仍需用实际 Pocket ID 客户端确认 issuer、证书、claims 与允许回调地址。

- 配置完整但登录失败：检查 issuer 精确值、RS256、S256、已验证邮箱、客户端密钥和服务端网络。
- Cookie/state 不匹配：使用同一浏览器和域名，避免多个标签同时发起流程；重启后重新发起。
- 绑定冲突：先使用已有账户的原方式/密码登录，并主动解绑旧身份；不要修改 sub 或按邮箱批量关联。
- 密钥轮换后短暂失败：三十秒刷新限制内可稍后重试；未知 kid 不会退回未验证登录。
- 日志只记录固定错误原因或本地用户 ID，不记录授权码、token、密钥或原始提供商响应。

参考：[Pocket ID 连接应用](https://pocket-id.org/docs/setup/connect-an-app)、[scopes 和 claims](https://pocket-id.org/docs/guides/scopes-and-claims)、[OIDC Core 验证规则](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)。
