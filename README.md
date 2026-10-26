# 实习成长日记

给在职实习生用的每日成长日记。每天花 3 分钟记一笔，实习结束时就有一整本自己的成长记录，可以直接导出成 Word、PDF、Markdown，或者整理成一条 LinkedIn 帖子。

纯前端网页 App（PWA），放在 GitHub Pages 上就能用，手机上可以「添加到主屏幕」，用起来和普通 App 一样。

## 功能

| 功能 | 说明 |
|---|---|
| 首次设置 | 只填 4 项：在职公司、部门、岗位名称、入职日期 |
| 写日记 | 支持文字和图片（每天最多 9 张），写了字就能保存；没点保存也会自动存草稿 |
| 今日计划 | 上班前列待办，可以一键带上次没完成的事 |
| 时间复盘 | 下班后按类别记录时间（每点一次 + 记半小时），自动显示时间分配条和计划完成率 |
| 连续打卡 | 每天保存日记就算打卡；默认周末不写不算断签。连续 3/7/14/21/30/60/100 天点亮里程碑 |
| 打卡海报 | 保存当天日记后生成海报，可以保存图片或直接分享。连续打卡越久，解锁的海报主题越多（共 7 套） |
| 每日提醒 | 一键把提醒加到手机日历（最可靠）；App 开着时也会弹浏览器通知 |
| 一键导出 | 选范围（本周 / 本月 / 全部 / 自定义）和内容，导出 Word / PDF / Markdown |
| 中文转英文 | 导出时选「英文（AI 翻译）」，日记、计划、类别、公司和岗位都会翻成英文（需要 Claude API Key） |
| LinkedIn 帖子 | 用选定范围的日记生成一条帖子，一键复制并打开 LinkedIn。没有 API Key 时可以用模板，或者复制提示词到任意 AI 助手 |
| 备份恢复 | 导出一个 JSON 备份文件，换手机后在首页「从备份恢复」 |

## 数据和隐私

- 所有日记、图片、设置都只保存在**当前设备的浏览器**里（IndexedDB），不会上传到任何服务器。
- 也正因为这样：换手机、换浏览器、清理浏览器数据之前，**一定要先在「我的」里导出备份**。
- Claude API Key 只存在本机浏览器，不会写进备份文件。只有点「翻译」「生成帖子」「测试连接」时，选中范围内的日记才会发给 Anthropic。
- 写日记时建议写「做了哪类事」，不写项目代号、内部数据和同事姓名；生成 LinkedIn 帖子时也会要求 AI 去掉这些信息。

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
js/db.js               本地存储（IndexedDB）
js/streak.js           连续打卡计算
js/poster.js           打卡海报绘制和主题
js/export.js           Word / PDF / Markdown 导出
js/ai.js               Claude 翻译和 LinkedIn 帖子
js/reminder.js         日历提醒文件和浏览器通知
sw.js                  离线缓存（Service Worker）
manifest.webmanifest   安装到主屏幕的配置
icons/                 App 图标
```

## 已知限制

- 数据只在一台设备上，不会自动同步；靠「导出备份 / 从备份恢复」迁移。
- PDF 通过系统打印窗口导出（选「存储为 PDF」），这样中文清晰、可复制。
- LinkedIn 不支持从网页带图片直接发帖，打卡海报需要在 LinkedIn 里手动添加；帖子文字会同时复制到剪贴板，没自动填上的话直接粘贴。
- Word 导出和 AI 功能第一次使用时需要联网加载组件，之后会缓存。
