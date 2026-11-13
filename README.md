# niko-main

个人网站收藏首页，属于 `niko-archive` 组合站点。

`index.html` 是独立静态页面，保留二次元背景、悬停文字主题、添加网站和自适应分页。轻小说书库默认排在第一张卡片，指向 `/nikowenku-archive/#/library`；第二张是星海余页（StarseaFolio），指向 `/StarseaFolio/`，用于 AI 辅助小说创作。

网站列表和主题选择存储在当前浏览器的 localStorage，不会修改仓库或同步给其他访客。直接打开 HTML 可以预览；书库链接需要通过主仓库的 Nginx 配置访问。背景插画目前沿用原 HTML 的远程图片地址。

静态首页不需要安装依赖或构建，部署时由 Nginx 在根路径提供 `index.html`、`chat.css` 和 `chat.js`。首页包含 DeepSeek、ChatGPT 官网入口，顶部“对话”按钮可展开/收起聊天面板。

## 首页对话与 API 配置

需要 Node.js 22+，无第三方运行依赖：`npm test` 运行测试，`npm run start:chat` 启动仅监听 `127.0.0.1:4181` 的转发服务。本地联调时由同一个静态服务器将 `/chat-api/` 代理至该服务；生产安装见 `deploy/install-chat.sh https://你的域名`。

“API 配置”内置 DeepSeek 官方地址 `https://api.deepseek.com/v1` 与 `deepseek-flash`，只需填写 API Key。也可新增最多 11 个自定义配置，填写名称、OpenAI Chat Completions / Claude Messages 协议、HTTPS Base URL、模型 ID 和 Key。兼容网关可提供 `/v1` 前缀或完整的 `/chat/completions`、`/messages` 地址。请求为流式文本，思考内容单独显示并默认收起，不写回对话历史；不会自动重试失败的模型调用。

Key 通过 HttpOnly、SameSite=Strict 的随机浏览器 Cookie 隔离，用 AES-256-GCM 加密保存在 `CHAT_STATE_DIR`（开发默认 `.chat-state/`，生产 `/var/lib/niko-home-chat`）。配置接口仅返回 `hasApiKey`，空 Key 表示保留已有 Key；删除 DeepSeek 配置会清空其 Key。主密钥 `master.key` 和 `.vault` 文件均为 0600，目录为 0700。服务器运营者有解密能力，这不是端到端加密；上线真实 Key 应使用 HTTPS，HTTP 页面会显示未加密提示。Key 不写入浏览器存储、日志或仓库；浏览器只在当前标签页 sessionStorage 保存对话文字。清除站点 Cookie 后不能恢复原有配置，备份或迁移配置时须一起备份状态目录，不能遗失主密钥。

聊天转发只接受同源请求，拒绝内网、公网解析混入内网、携带账号或非 HTTPS 的上游地址；DNS 校验结果固定到单次 TLS 连接且不跟随重定向。接口有消息大小、并发与频率限制，停止按钮/断开连接会取消上游请求，单次回复最多 5 分钟。测试使用模拟模型流，不使用真实 API Key 或消耗模型额度。

生产安装脚本创建独立的 `niko-home-chat.service`，添加 `/chat-api/` 的 Nginx 流式代理并禁止访问服务源码目录；保留既有书库和星海余页路由，不重启其后台。书库 Node 服务和 80 端口配置见父仓库 README。
