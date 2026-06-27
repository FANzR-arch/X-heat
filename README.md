# X Heat

X Heat is a Chrome/Edge Manifest V3 extension that adds a small heat badge to the top-right corner of each X post.

The extension does not call X private APIs. It reads the engagement metrics already visible in the page, then calculates a 0-100 heat score from replies, reposts, likes, views, and post age.

This implementation is original. Similar GitHub projects were reviewed for product patterns, but their code was not copied because most close matches did not publish a clear reusable license.

## 使用方法

1. 下载或克隆这个仓库到本地。
2. 打开 Chrome 的 `chrome://extensions`，或 Edge 的 `edge://extensions`。
3. 打开右上角的开发者模式。
4. 点击“加载已解压的扩展程序”。
5. 选择这个项目文件夹。
6. 打开或刷新 `https://x.com`。
7. 每条帖子右上角会出现“热度”徽章，鼠标悬停可以查看回复、转发、喜欢、查看数和发布时间修正后的明细。

弹窗里的开关可以临时关闭或重新启用热度徽章。

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this folder: `D:\00_Formula\03_Coding\Xheat`.
5. Open or refresh `https://x.com`.

## How the score works

The content script scans `article[data-testid="tweet"]` nodes and reads visible metric labels. The score gives more weight to replies and reposts, includes likes and views, then adjusts by post age so newer posts with fast traction surface as hotter.

Heat levels:

- `0-41`: calm
- `42-71`: warm
- `72-89`: hot
- `90-100`: viral

Hover a badge to see the metric breakdown.

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
