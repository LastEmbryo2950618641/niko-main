# niko-main

个人网站收藏首页，属于 `niko-archive` 组合站点。

`index.html` 是独立静态页面，保留二次元背景、悬停文字主题、添加网站和自适应分页。轻小说书库默认排在第一张卡片，指向 `/nikowenku-archive/#/library`；第二张是星海余页（StarseaFolio），指向 `/StarseaFolio/`，用于 AI 辅助小说创作。

网站列表和主题选择存储在当前浏览器的 localStorage，不会修改仓库或同步给其他访客。直接打开 HTML 可以预览；书库链接需要通过主仓库的 Nginx 配置访问。背景插画目前沿用原 HTML 的远程图片地址。

静态首页不需要安装依赖或构建，部署时由 Nginx 在根路径提供 `index.html`、`chat.css`、`chat.js` 和 `chat-settings.js`。首页包含 DeepSeek、ChatGPT 官网入口，顶部“对话”按钮展开时隐藏网站卡片和分页，对话面板占满下方空间；收起后恢复卡片。

`ui-motion.js` 和 `motion.css` 提供浏览器原生动画，无额外运行依赖。对话面板向下滑入、卡片和分页向下滑出，收起时反向恢复；连续切换从当前位置衔接，调整窗口会清理过渡并恢复正确布局。按钮、文字、输入框和卡片悬停使用统一过渡，主题菜单和弹窗有进出动画，手机 API 配置面板从底部滑入。系统启用“减少动态效果”时取消位移和过渡。对话流式文本不反复触发入场动画。

## 首页对话与 API 配置

需要 Node.js 22+，无第三方运行依赖：`npm test` 运行测试，`npm run start:chat` 启动仅监听 `127.0.0.1:4181` 的转发服务。本地联调时由同一个静态服务器将 `/chat-api/` 代理至该服务；生产安装见 `deploy/install-chat.sh https://你的域名`。

“API 配置”内置 DeepSeek 官方地址 `https://api.deepseek.com/v1` 与 `deepseek-flash`，只需填写 API Key。也可新增最多 11 个自定义配置，填写名称、OpenAI Chat Completions / Claude Messages 协议、HTTPS Base URL、模型 ID 和 Key。兼容网关可提供 `/v1` 前缀或完整的 `/chat/completions`、`/messages` 地址。请求为流式文本，思考内容单独显示并默认收起，不写回对话历史；不会自动重试失败的模型调用。

API Key、配置和当前选择仅保存在当前浏览器的 localStorage（`site-shelf.chat.settings.v1`），保存、切换、删除配置均不发送网络请求。空 Key 保留浏览器已有 Key；清除 DeepSeek Key 会恢复默认配置，删除自定义配置会移除其 Key；清除站点数据后需重新填写。不同浏览器或不同源不共享配置。对话文字只保存在当前标签页 sessionStorage，思考内容不写回模型上下文。

发送消息时，浏览器将当前配置、Key 和对话临时交给同源 `/chat-api/chat` 转发，兼容不允许浏览器跨域调用的供应商。服务端不再创建、读取或写入密钥库，不记录 Key、请求体或上游错误正文；它仍会在请求内存中接触本次 Key，并非端到端加密。HttpOnly、SameSite=Strict 的随机 Cookie 仅用于并发限制，不携带 Key。旧配置接口返回刷新提示，不再接受持久保存；旧版服务器保存的 Key 不自动导出，升级后需重新填写，并清理旧 `.vault` 和 `master.key` 文件。生产应使用 HTTPS；HTTP 页面会显示未加密提示。同源脚本可访问 localStorage，因此不要引入不可信脚本。

聊天转发只接受同源请求，拒绝内网、公网解析混入内网、携带账号或非 HTTPS 的上游地址；DNS 校验结果固定到单次 TLS 连接且不跟随重定向。接口有消息大小、并发与频率限制，停止按钮/断开连接会取消上游请求，单次回复最多 5 分钟。测试使用模拟模型流，不使用真实 API Key 或消耗模型额度。

生产安装脚本创建独立的 `niko-home-chat.service`，添加 `/chat-api/` 的 Nginx 流式代理并禁止访问服务源码目录；保留既有书库和星海余页路由，不重启其后台。书库 Node 服务和 80 端口配置见父仓库 README。
