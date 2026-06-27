# X Heat

X Heat is a Chrome/Edge Manifest V3 extension that adds a compact heat badge to the top-right action area of each X post.

The extension does not call X private APIs. It reads the engagement metrics already visible in the page, then calculates heat velocity from replies, reposts, likes, views, and post age.

This implementation is original. Similar GitHub projects were reviewed for product patterns, but their code was not copied because most close matches did not publish a clear reusable license.

## 使用方法

1. 下载或克隆这个仓库到本地。
2. 打开 Chrome 的 `chrome://extensions`，或 Edge 的 `edge://extensions`。
3. 打开右上角的开发者模式。
4. 点击“加载已解压的扩展程序”。
5. 选择这个项目文件夹。
6. 打开或刷新 `https://x.com`。
7. 每条帖子右上角的更多按钮旁会出现热度徽章，例如 `🔥 1.2k/h`。
8. 如果插件已经记录过同一条帖子，徽章会额外显示加速信号，例如 `↗2.1x`。
9. 颜色越深、越多彩，表示潜力越高；鼠标悬停可以查看速度、最近速度、加速度、页面排名、互动质量和基础指标。

弹窗里的开关可以临时关闭或重新启用热度徽章。

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this folder: `D:\00_Formula\03_Coding\Xheat`.
5. Open or refresh `https://x.com`.

## How the score works

The content script scans `article[data-testid="tweet"]` nodes and reads visible metric labels. It gives more weight to replies and reposts, includes likes and views, then divides weighted impact by post age to show a readable velocity such as `105/h`, `1.2k/h`, or `10k/h`.

The current potential model uses four local signals:

- `velocity`: weighted impact per hour
- `quality`: weighted engagement divided by views
- `acceleration`: recent velocity from locally stored snapshots
- `page rank`: the post's velocity rank among currently visible posts

The extension stores only small local snapshots in `chrome.storage.local`; it does not call X private APIs or send post data to a server.

Heat levels:

- `🧊 cold`: low velocity
- `🌡️ cool`: starting to move
- `🔥 warm`: gaining traction
- `🔥 hot`: high velocity
- `🚀 viral`: very high velocity

Hover a badge to see the metric breakdown and the internal 0-100 heat score.

## Files

- `manifest.json`: extension manifest
- `src/content.js`: X page scanner and heat score logic
- `src/content.css`: injected badge UI
- `popup/popup.html`: extension popup
- `popup/popup.js`: enable/disable setting
- `tests/smoke.js`: local content-script smoke test

## Verify

Run these checks from the project folder:

```powershell
npm test
```

Or run the checks individually:

```powershell
node --check src/content.js
node --check popup/popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
node tests/smoke.js
```
