# Christmas Kitten Studio

把 **Christmas Kitten Advent Calendar · 视频分镜 V2** 制作成 9:16、40 秒的圣诞产品视频。界面内置完整英文字幕、暖色产品摄影提示词、轻音乐与 ASMR 开箱音效要求。12–20 秒保留礼盒包装展示；20–32 秒展示 5 只精选小猫。

技术：React / Vite / TypeScript、Hono、Vercel AI SDK、Cloudflare Workers AI、D1、R2、Cloudflare Access，以及 Seedance 官方异步视频 API。使用 AI SDK 不需要 Vercel 托管。

> 当前源代码可在本地查看和编辑分镜。真正登录、AI 优化和视频生成需要完成下面的生产配置。仅配置管理员邮箱不代表已经登录；生产 API 验证 Cloudflare Access 的签名 JWT。

## 本地运行

需要 Node.js 24 和 npm。

```sh
npm ci
npm run dev
```

打开 Vite 输出的本地地址。编辑草稿、查看分镜、导出脚本无需 API 密钥。`npm ci` 自动复制 FFmpeg wasm 到本项目静态目录，生产导出不依赖外部 FFmpeg CDN。

```sh
npm run typecheck
npm test
npm run build
npm run db:local
npm run dev:worker
```

Worker 在 Wrangler 输出的本地地址运行；`npm run dev:worker` 前先构建前端。本地 D1/R2 由 Wrangler 模拟。生产登录仍要求有效 Access 配置；不提供未验证的管理员身份捷径。

## 全部应用基础设施使用 Cloudflare

| 服务 | 用途 |
| --- | --- |
| Workers + Static Assets | React 前端及 Hono API |
| D1 | 分镜草稿与生成任务 |
| R2 | 私有参考图片及生成视频 |
| Workers AI | 通过 Vercel AI SDK 优化镜头提示词 |
| Cloudflare Access | 向管理员邮箱发送一次性登录验证码 |
| GitHub + GitHub Actions | 源代码与部署工作流 |

**Seedance 本身由字节跳动/火山引擎提供，并非 Cloudflare 模型。** 应用基础设施都在 Cloudflare；调用 Seedance 仍需要火山方舟开通模型权限及 API Key，模型费用由该提供商收取。没有使用 Vercel、Supabase 或额外邮件服务。

## 生产配置与部署

工作流在 push / pull request 时仅执行验证。只有手动运行 Actions 的 **Validate and deploy** 工作流才部署生产；仓库 push 不会自动发布。

### 1. 准备 Cloudflare 账户

创建 Cloudflare API Token，限定目标账户并授予 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit；使用自定义域名时还需要目标 zone 的相关 Workers Routes / DNS 权限。账户应已启用 R2 与 Workers AI，并具有相应计费资格。将 Token 与账户 ID 输入后面的 GitHub `production` Environment Secrets，**不需要把密钥交给开发助手或写进聊天**。

生产工作流会自动查找并复用 `kitten-studio` D1 数据库及 `kitten-studio-media` 私有 R2 bucket；不存在时自动创建。无需先在本地运行资源脚本，也不必预先填写 D1 UUID。不要启用 R2 公共开发 URL；应用通过已认证 API 访问媒体。

如果要在自己的电脑提前准备资源，也可以在本地安全环境变量中配置 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 后运行：

```sh
node scripts/provision.mjs
```

该可选脚本将真实资源标识写入 `wrangler.jsonc`，**不会部署**。可通过 `R2_BUCKET_NAME` 指定桶名，或通过 `D1_DATABASE_ID` 指定已有数据库。

初始配置中的全零 D1 UUID 仅用于本地模拟；生产工作流会在发布前将其替换为真实 UUID。

### 2. 设置邮箱登录和管理员

管理员固定为 **`xiexuanxi@outlook.fr`**。

1. 进入 Cloudflare Zero Trust，设置团队名称，记录 `https://YOURTEAM.cloudflareaccess.com`。
2. 打开 **Integrations → Identity providers → Add new identity provider → One-time PIN**。新 Zero Trust 组织不会自动启用 OTP。
3. 若使用默认 `workers.dev` 地址，先在 **Workers & Pages** 查看账户的 Workers 子域名；完整应用域名为 `christmas-kitten-studio.<你的 Workers 子域名>.workers.dev`。然后在 **Zero Trust → Access → Applications** 添加 Self-hosted 应用，将这个完整域名作为应用域名。可以在 Worker 首次部署前创建这种 hostname-based Access 应用，无需先发布占位 Worker。若使用自定义域名，则填写准备部署的完整自定义域名。
4. 应用的 Allow policy 只允许邮箱 `xiexuanxi@outlook.fr`，登录方式选择 One-time PIN。
5. 在 Access 应用设置中复制 Application Audience (AUD)，这是 64 位十六进制字符串。将 AUD 填入 GitHub `production` Environment 的 `ACCESS_AUDIENCE` Variable，将步骤 1 的团队地址填入 `ACCESS_TEAM_DOMAIN` Variable，再运行部署工作流。

用户打开受保护的网址后，在 **Cloudflare 托管的登录弹窗/页面**输入邮箱和收到的一次性验证码。Cloudflare 发送验证码，应用验证 Access JWT 的公钥签名、issuer、audience、过期时间和邮箱，服务器决定管理员身份。APP 配置缺少 Access 信息时，生产 API 会保持锁定。

### 3. 设置 GitHub `production` Environment

GitHub repository → Settings → Environments → New environment → `production`。

添加以下 **Secrets**：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 目标 Cloudflare 账户的受限部署 Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `ARK_API_KEY` | 有权调用所选 Seedance 模型的火山方舟 API Key |

添加以下 **Variables**：

| 名称 | 值 |
| --- | --- |
| `D1_DATABASE_ID` | 可选，复用指定数据库的真实 UUID；留空自动复用或创建 `kitten-studio` |
| `R2_BUCKET_NAME` | 默认 `kitten-studio-media` |
| `ACCESS_TEAM_DOMAIN` | `https://YOURTEAM.cloudflareaccess.com`，必填 |
| `ACCESS_AUDIENCE` | Access 应用 AUD，必填 |
| `SEEDANCE_MODEL` | 默认 `doubao-seedance-2-0-260128`；也可设置账户授权的对应模型/推理接入点 |
| `APP_HOSTNAME` | 可选，Cloudflare DNS 内的自定义域名，例如 `kitten.example.com` |

设置 `APP_HOSTNAME` 时，脚本会为 Worker 配置自定义域名并禁用默认 workers.dev 路由；留空则使用 workers.dev，并须为该准确域名启用 Access。版本预览 URL 默认禁用，避免产生额外的未配置 Access 的入口。若要审批每次生产发布，可在 GitHub `production` Environment 添加 required reviewers。

### 4. 手动发布

在 GitHub **Actions → Validate and deploy → Run workflow** 选择 `main`。工作流会：

1. 安装锁定依赖、执行类型检查和测试、构建前端，检查 Worker 与静态文件。
2. 检查必需 Secrets；验证 Access 与域名设置后，自动创建或复用 D1 和私有 R2，并写入本次部署的配置。
3. 构建生产前端，将 D1 migrations 应用到生产数据库。
4. 通过官方 `cloudflare/wrangler-action@v4` 部署 Worker，并安全上传 `ARK_API_KEY` 为 Worker secret。

GitHub 日志不输出密钥。`ARK_API_KEY` 只能在服务端使用；前端看不到原始密钥。

## 视频生成与导出

Seedance 是异步任务：提交镜头后返回 task ID，应用查询 queued / running / succeeded / failed 等状态；成功结果下载到私有 R2，避免依赖提供商临时视频 URL。模型支持的最短生成时长可能长于单个镜头的剪辑时长，最终剪辑依据分镜的时间区间裁切。

素材库支持将产品图私密保存到 R2，供制作时对照；当前视频接口采用文字生视频，尚未将上传的图片作为 Seedance 的参考图输入。纯文字描述无法保证与实体产品完全一致。AI 生成的视觉画面和英文字幕分开处理，避免把生成模型中的文字失真带入字幕。

脚本导出可供人工拍摄/剪辑继续使用。MP4 合成使用浏览器内 FFmpeg：需要各镜头成功生成后再合成；在本机进行裁切、字幕叠加、拼接，保留模型音频并混入附带的原创轻柔圣诞铃声配乐。31 MB FFmpeg WASM 按 16 MiB 拆分、自托管于 Cloudflare，加载时重组，符合静态文件单文件大小限制。完整 40 秒片段的合成对浏览器内存和 CPU 有要求。

## 文档来源

- [Seedance / 火山方舟 API 文档](https://www.volcengine.com/docs/82379)
- [Cloudflare Agents AI SDK provider](https://developers.cloudflare.com/agents/models/ai-sdk/)
- [Cloudflare Access OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Workers 的 Cloudflare Access 与 hostname-based 保护](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Access JWT 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)

研究记录见 `docs/`。

## 验证范围

单元测试覆盖分镜时间轴、Seedance 请求、Cloudflare Access 权限边界与导出前检查；构建及 Worker 打包可在无密钥时完成。真实的邮箱登录、Seedance 付费生成、R2 转存和浏览器内完整 40 秒导出需要生产凭据后进行端到端验证。示意图为 AI 生成的视觉概念，非实体产品照片。
