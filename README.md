# 实习成长日记

给在职实习生用的成长日记：每天列好待办、记一句心情，也可以把今天折成一只纸船，漂到广场上给别的实习生看。实习结束时就有一整本自己的记录，可以导出成 Word、PDF、Markdown，或者整理成一条 LinkedIn 帖子。

纯前端网页 App（PWA），放在 GitHub Pages 上就能用，手机上可以「添加到主屏幕」，用起来和普通 App 一样。广场需要接一个 Supabase 后端（免费额度够用），见下面「开启广场」。

## 五个页面

| 页面 | 做什么 |
|---|---|
| 待办（主页） | 大部分篇幅留给待办。右下角的 + 添加；勾掉时有提示音，并弹出「大概用了多久？」记录用时。可以带上次没完成的事。右上角可以分享成纸船、导出 |
| 日记 | 每天一句话，提示语是「今天开心吗^ ^？」。记下后显示连续记录天数，可以放成纸船或生成分享图片 |
| 广场 | 纸船漂流瓶：放出几只纸船，就能捞几只别人的（每天的待办和日记各算一只）。捞到的纸船可以留言，对方会收到 |
| 通知 | 别人给你的纸船留言、纸船主人回复你，都会出现在这里；底栏有未读数 |
| 我的 | 实习信息、纸船署名（公司 · 岗位，可以隐藏公司）、每日提醒、AI Key、备份恢复 |

其他：
- **导出**：在待办页和日记页右上角，选范围后导出 Word / PDF / Markdown，待办会带上每项用时；也可以生成 LinkedIn 帖子，或用 AI 翻成英文（需要 Claude API Key）。
- **分享图片**：7 套海报主题，连续记录越久解锁越多。
- **每日提醒**：一键加到手机日历；App 开着时也会弹浏览器通知。

## 数据和隐私

- 待办、日记、图片、设置都只保存在**当前设备的浏览器**里（IndexedDB）。换手机、换浏览器、清理浏览器数据之前，**先在「我的」里导出备份**。
- 只有你主动放进广场的纸船会上传到广场服务器，别人只能看到自己捞到的纸船；纸船上显示你在「我的」里设置的署名。
- 广场用匿名身份：每台设备第一次进广场时自动生成一个匿名账号，不需要手机号或邮箱。清空浏览器数据后会换成新身份，之前放的纸船和留言就看不到了。
- Claude API Key 只存在本机浏览器，不会写进备份文件。

## 开启广场（Supabase）

不做这一步，广场以「演示模式」运行：海上的纸船是本机模拟的，只用来看流程。

1. 在 [supabase.com](https://supabase.com) 注册并新建一个项目（免费套餐即可，区域选离用户近的，比如 Singapore / Tokyo）。
2. 打开 **Authentication → Sign In / Providers**，开启 **Allow anonymous sign-ins**。
3. 打开 **SQL Editor**，把 [`supabase/plaza.sql`](supabase/plaza.sql) 的全部内容粘进去运行一次。它会建好纸船、留言、举报几张表，以及所有规则（放几只捞几只、只能看到自己捞到的纸船、被 3 人举报的纸船自动下架等）。表本身对浏览器完全不开放，所有读写都走这些函数。
4. 打开 **Project Settings → API Keys**，复制 Project URL 和 publishable key（以前叫 anon key），填进 [`js/config.js`](js/config.js)。publishable key 本来就是公开给浏览器用的；**不要**填 secret / service_role key。
5. 推送到 GitHub，广场就连上了，演示模式的提示会自动消失。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库（例如 `intern-diary`）。免费账号要用 Pages，仓库需要是 Public。
2. 把这个文件夹里的全部文件推送到仓库的 `main` 分支：

   ```bash
   cd intern-diary
   git init
   git add .
   git commit -m "实习成长日记 v1.0"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/intern-diary.git
   git push -u origin main
   ```

3. 打开仓库的 **Settings → Pages**，Source 选 **Deploy from a branch**，Branch 选 `main`、目录选 `/ (root)`，保存。
4. 等一两分钟，访问 `https://<你的用户名>.github.io/intern-diary/`。

不需要任何构建步骤，改完文件推送上去就会更新。

## 装到手机上

- **iPhone（Safari）**：打开网址 → 底部「分享」→「添加到主屏幕」。
- **Android（Chrome）**：打开网址 → 右上角菜单 →「安装应用」或「添加到主屏幕」。

装好之后从桌面图标打开，没有浏览器地址栏，断网也能打开和写日记。

## 每日提醒怎么设

网页 App 被关掉以后，没办法自己定时弹提醒。所以提供两种方式：

1. **添加到手机日历（推荐）**：在「我的 → 每日提醒」设好时间，点「添加到手机日历」，打开下载的 `.ics` 文件加入日历。之后每天（或只在工作日）到点由系统日历提醒。改了提醒时间需要重新添加一次。
2. **浏览器通知**：点「开启浏览器通知」。只在 App 开着（或在后台没被系统杀掉）时有效。

## AI 翻译和 LinkedIn 帖子（可选）

- 在「我的 → AI 翻译与帖子」填入自己的 Claude API Key（在 [console.anthropic.com](https://console.anthropic.com) 创建，按用量付费）。
- 默认模型是 Claude Opus 5.5，也可以换成 Sonnet 5.5 或 Haiku 5.5（更快、更便宜）。
- 已经翻译过的日记会缓存，内容没改就不会重复收费。
- 浏览器直接调用 Claude API，用的是官方 `@anthropic-ai/sdk`（从 jsDelivr 按需加载）。

## 本地运行

```bash
cd intern-diary
python3 -m http.server 8000
```

然后打开 <http://localhost:8000>。不能直接双击 `index.html` 打开，因为 ES 模块和 Service Worker 需要通过 http 访问。

## 文件结构

```
index.html             页面骨架和底部导航
css/style.css          全部样式（含深色模式和打印样式）
js/app.js              页面渲染和交互
js/plaza.js            广场：纸船、留言、通知（Supabase；没配置时是演示模式）
js/config.js           广场服务器地址和 publishable key
js/sound.js            勾掉待办和放纸船的提示音
js/db.js               本地存储（IndexedDB）
js/streak.js           连续打卡计算
js/poster.js           打卡海报绘制和主题
js/export.js           Word / PDF / Markdown 导出
js/ai.js               Claude 翻译和 LinkedIn 帖子
js/reminder.js         日历提醒文件和浏览器通知
sw.js                  离线缓存（Service Worker）
supabase/plaza.sql     广场的数据库结构和规则
manifest.webmanifest   安装到主屏幕的配置
icons/                 App 图标
```

## 已知限制

- 数据只在一台设备上，不会自动同步；靠「导出备份 / 从备份恢复」迁移。
- PDF 通过系统打印窗口导出（选「存储为 PDF」），这样中文清晰、可复制。
- LinkedIn 不支持从网页带图片直接发帖，打卡海报需要在 LinkedIn 里手动添加；帖子文字会同时复制到剪贴板，没自动填上的话直接粘贴。
- Word 导出和 AI 功能第一次使用时需要联网从 jsDelivr 加载组件，之后会缓存。
