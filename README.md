# niko-main

个人网站收藏首页，属于 `niko-archive` 组合站点。

`index.html` 是独立静态页面，保留二次元背景、悬停文字主题、添加网站和自适应分页。轻小说书库默认排在第一张卡片，指向 `/nikowenku-archive/#/library`。

网站列表和主题选择存储在当前浏览器的 localStorage，不会修改仓库或同步给其他访客。直接打开 HTML 可以预览；书库链接需要通过主仓库的 Nginx 配置访问。背景插画目前沿用原 HTML 的远程图片地址。

不需要安装依赖或构建，部署时由 Nginx 在根路径直接提供 `index.html`。书库 Node 服务和 80 端口配置见父仓库 README。
