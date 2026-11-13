# niko-main

个人网站收藏首页，属于 `niko-archive` 组合站点。

`index.html` 是独立静态页面，保留二次元背景、悬停文字主题、添加网站和自适应分页。轻小说书库默认排在第一张卡片，指向 `/nikowenku-archive/#/library`；第二张是星海余页（StarseaFolio），指向 `/StarseaFolio/`，用于 AI 辅助小说创作。

网站列表和主题选择存储在当前浏览器的 localStorage，不会修改仓库或同步给其他访客。直接打开 HTML 可以预览；书库链接需要通过主仓库的 Nginx 配置访问。背景插画目前沿用原 HTML 的远程图片地址。

静态首页不需要安装依赖或构建，部署时由 Nginx 在根路径提供 `index.html`、`chat.css`、`chat.js`、`chat-settings.js` 和 `browser-settings.js`。首页包含 DeepSeek、ChatGPT 官网入口，顶部“对话”按钮展开时隐藏网站卡片和分页，对话面板占满下方空间；收起后恢复卡片。

`ui-motion.js` 和 `motion.css` 提供浏览器原生动画，无额外运行依赖。对话面板向下滑入、卡片和分页向下滑出，收起时反向恢复；连续切换从当前位置衔接，调整窗口会清理过渡并恢复正确布局。按钮、文字、输入框和卡片悬停使用统一过渡，主题菜单和弹窗有进出动画，手机 API 配置面板从底部滑入。系统启用“减少动态效果”时取消位移和过渡。对话流式文本不反复触发入场动画。

## 首页对话与 API 配置

需要 Node.js 22+，无第三方运行依赖：`npm test` 运行测试，`npm run start:chat` 启动仅监听 `127.0.0.1:4181` 的转发服务。本地联调时由同一个静态服务器将 `/chat-api/` 代理至该服务；生产安装见 `deploy/install-chat.sh https://你的域名`。

“API 配置”内置 DeepSeek 官方地址 `https://api.deepseek.com/v1` 与 `deepseek-flash`，只需填写 API Key。也可新增最多 11 个自定义配置，填写名称、OpenAI Chat Completions / Claude Messages 协议、HTTPS Base URL、模型 ID 和 Key。兼容网关可提供 `/v1` 前缀或完整的 `/chat/completions`、`/messages` 地址。请求为流式文本，思考内容单独显示并默认收起，不写回对话历史；不会自动重试失败的模型调用。

API Key、配置和当前选择在浏览器端通过 Web Crypto 的 AES-256-GCM 加密后保存在 localStorage（`site-shelf.chat.settings.v1`，v2 加密记录），每次写入使用新的随机 IV。加密密钥是当前浏览器 IndexedDB（`site-shelf.chat.crypto.v1`）内不可导出的 CryptoKey，不上传服务端。保存、切换、删除配置均不发送网络请求。空 Key 保留已有 Key；清除 DeepSeek Key 会恢复默认配置，删除自定义配置会移除其 Key。旧版同源明文配置仅在成功加密后升级；存储权限、解密或写入失败不会回退到明文，也不会覆盖原记录。损坏的配置可由用户确认后重置。

清除站点数据后需重新填写；不同浏览器、HTTP 与 HTTPS 不共享配置。HTTP 升级 HTTPS 后需在新地址重新填写一次，不自动传输旧 Key。对话文字只保存在当前标签页 sessionStorage，思考内容不写回模型上下文。浏览器私密模式可能不保留数据。本地加密保护存储内容，不保证抵御已控制此浏览器、操作系统或同源脚本的攻击。

发送消息时，浏览器解密当前 Key，经 HTTPS 将本次配置和对话临时交给同源 `/chat-api/chat` 转发，再通过 HTTPS 访问供应商，兼容不允许浏览器跨域调用的供应商。服务端不创建、读取或写入密钥库，不记录 Key、请求体或上游错误正文；它仍会在请求内存中接触本次 Key，并非端到端加密。HttpOnly、SameSite=Strict、Secure 的随机 Cookie 仅用于并发限制，不携带 Key。旧配置接口返回刷新提示，不再接受持久保存；旧版服务器保存的 Key 不自动导出，升级后需重新填写，并清理旧 `.vault` 和 `master.key` 文件。生产入口强制 HTTPS；浏览器不支持安全上下文时拒绝保存 Key，不伪装成安全存储。本地回环开发地址可使用浏览器认可的安全上下文。

现有 Nginx 站点可运行 `sudo bash deploy/enable-https.sh 公网IPv4` 配置受信任的 IP 证书。脚本通过 HTTP-01 webroot 校验申请 Let's Encrypt 短期证书，添加 443 监听并仅将首页资源升级到 HTTPS，保留既有书库和写作路径；HTTP 聊天接口拒绝提交。独立 systemd timer 每六小时检查续期，成功续期后校验并重载 Nginx。部署前需放行公网 80/443；不会导出用户浏览器 Key，也不会将其保存到服务端。证书属于服务器 TLS 凭据，与用户的模型 API Key 无关。

聊天转发只接受同源请求，拒绝内网、公网解析混入内网、携带账号或非 HTTPS 的上游地址；DNS 校验结果固定到单次 TLS 连接且不跟随重定向。接口有消息大小、并发与频率限制，停止按钮/断开连接会取消上游请求，单次回复最多 5 分钟。测试使用模拟模型流，不使用真实 API Key 或消耗模型额度。

生产安装脚本创建独立的 `niko-home-chat.service`，添加 `/chat-api/` 的 Nginx 流式代理并禁止访问服务源码目录；保留既有书库和星海余页路由，不重启其后台。书库 Node 服务和 80 端口配置见父仓库 README。
