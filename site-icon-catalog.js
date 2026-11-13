// IDs refer to the bundled, licensed icon sprite; never render model-supplied SVG or URLs.
export const siteIconChoices=Object.freeze({
  'bookmark-simple':'通用网站、收藏导航',
  'robot':'AI 助手、人工智能服务',
  'magic-wand':'AI 创作、自动化创意工具',
  'palette':'绘画、图片创作、美术设计',
  'book-open-text':'小说、书库、阅读、知识资料',
  'notebook':'博客、笔记、文档、学习',
  'pencil-simple':'写作、编辑、设计工具',
  'chat-circle-dots':'聊天、社区、论坛、社交',
  'headphones':'音乐、音频、播客、影音娱乐',
  'game-controller':'游戏、游戏平台、游戏资讯',
  'plugs-connected':'开发、API、技术工具、集成服务',
  'floppy-disk':'文件、下载、存储、备份',
  'lock-key':'隐私、安全、加密',
  'key':'账号、认证、授权管理',
  'bell-ringing':'新闻、资讯、通知',
  'gift':'购物、商品、礼物、福利',
  'heart':'健康、生活、情感',
  'paw-print':'宠物、动物',
  'moon-stars':'天文、星空、幻想题材',
  'shooting-star':'科学、探索、新鲜发现',
  'feather':'文学、故事、诗歌',
  'ice-cream':'美食、甜品',
  'crown':'会员、精选内容、排行榜',
  'sparkle':'生活方式、灵感、美化'
});
export function normalizeSiteIcon(value){return typeof value==='string'&&Object.hasOwn(siteIconChoices,value)?value:'bookmark-simple';}
