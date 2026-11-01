# 浏览器扩展上架准备（Chrome Web Store / Edge Add-ons）

> A2 域名记录扩展（`browser-extension/`）的商店发布流程与素材清单。MVP 已用「开发者模式拖装 + token 鉴权」过渡；上架后切换 Origin 白名单鉴权。

## 1. 前置账号

- Chrome Web Store 开发者账号：一次性 $5 注册费（https://chrome.google.com/webstore/devconsole）
- Edge Add-ons：Microsoft Partner Center 账号（免费），可直接复用同一份 zip

## 2. 打包

```bash
cd browser-extension
# 排除 README.md 等非运行文件后打 zip（根目录即 manifest.json）
zip -r ../landeck-domain-extension.zip manifest.json background.js options.html options.js icons/
```

Edge 用同一份 zip 上传。

## 3. 商店素材清单

| 素材 | 要求 |
| --- | --- |
| 名称 | LanDeck Domain Helper（或类似，含 LanDeck 品牌） |
| 简短描述 | ≤132 字符：Reports the active browser tab to LanDeck for activity classification. |
| 详细描述 | 功能说明 + 隐私声明（只上报域名与页面标题到**本机** LanDeck agent，不经任何第三方服务器） |
| 图标 | 128×128（现占位图需正式化） |
| 截图 | ≥1 张 1280×800：Options 配置页 |
| 类别 | Productivity / 工具 |
| 语言 | en + zh-CN |

## 4. 隐私合规（审核必过项）

- 权限使用说明：`tabs`（读取激活标签 URL）、`storage`（保存本机配置）、`host_permissions`（仅 http://127.0.0.1:8420/*，本机 agent）
- 数据使用声明：不收集/不转售/不跨设备传输——数据只发到用户自己配置的本机地址
- 单一用途声明：域名上报用于本地活动分类

## 5. 上架后的鉴权切换（代码两处）

1. 商店分配固定扩展 ID（打包 zip 的 key 不变则 ID 稳定；或 manifest 加 `key` 字段固定）
2. agent 设置 `domainAuth: "origin"` + `domainOrigins: ["chrome-extension://<商店ID>"]`（设置页或 prefs）
3. README 的「开发者模式拖装」段落替换为商店安装链接

## 6. 审核周期与风险

- Chrome：首次审核数天；`tabs` 权限会触发人工审查（说明写清即过）
- Edge：审核更快
- 被拒最常见原因：权限说明不足——按第 4 节口径写全
