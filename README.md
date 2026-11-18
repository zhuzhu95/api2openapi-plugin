# API to OpenAPI

Chrome 开发者工具扩展：捕获网页实际调用的接口请求，一键转换为 **OpenAPI 3.0.3** JSON，可直接导入 Apifox 等接口管理 / Mock 工具。

## 功能

- 在 F12 开发者工具中新增 **API→OpenAPI** 面板，自动捕获 XHR / Fetch 请求
- 勾选一条或多条请求，一键转换为 OpenAPI JSON（多条同路径样本自动合并 Schema）
- 自动识别路径参数（`/users/123` → `/users/{userId}`）、推断请求体 / 响应体 JSON Schema
- 响应 schema 携带真实响应数据（放在 `schema.enum`，与 Apifox 导出格式一致），数组超过 10 条自动截断为 10 条
- 敏感信息处理：
  - `Authorization`、`Cookie`、`x-api-key` 等鉴权头自动转为 Apifox 可识别的鉴权配置（securityScheme），**不导出真实凭证**
  - `token`、`sign`、`pwd` 等敏感 query 参数示例值脱敏为 `******`
- 支持从 Network 面板右键 "Copy as HAR" 粘贴导入
- 输出可直接复制到剪贴板或下载为 `.json` 文件

## 编译

环境要求：Node.js ≥ 18

```bash
# 安装依赖
npm install

# 构建（产物输出到 dist/）
npm run build

# 开发模式：监听文件变化自动重新构建
npm run watch

# 运行单元测试
npm test

# 类型检查
npm run typecheck

# 打包：构建并把运行所需文件复制到 release/（分发给别人安装时使用）
npm run pack
```

## 安装到 Chrome

1. 打开 `chrome://extensions`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本项目根目录（开发调试）；如果分发给别人安装，运行 `npm run pack` 后选择 `release/` 目录即可，只包含运行所需文件
4. （修改代码后）重新 `npm run build`，并在扩展管理页点击该扩展的刷新按钮

## 使用

1. 打开目标网页，按 `F12` 打开开发者工具
2. 切换到 **API→OpenAPI** 标签页
3. 在页面中正常操作，触发接口请求，面板会实时列出捕获到的请求
4. 勾选需要导出的请求（支持按 URL 搜索、按方法过滤），点击 **转换选中**
5. 下方预览区显示生成的 OpenAPI JSON，点击 **复制 JSON** 或 **下载 JSON**
6. 在 Apifox 中：项目 → **导入数据** → **OpenAPI/Swagger** → 粘贴 JSON 或上传文件

### 转换单个请求

请求列表每行末尾有 **转换** 按钮，可直接转换该条接口，无需勾选。

### 从 Network 面板导入已有请求

插件面板只能捕获面板打开之后的请求。对于已发生的请求：

1. 在 Network 面板中右键目标请求 → **Copy** → **Copy as HAR (sanitized)**
2. 点击本插件面板的 **导入 HAR**，粘贴后点击 **解析并加入列表**
3. 导入的请求会自动选中，直接点 **转换选中** 即可

### 其他选项

- **暂停 / 继续**：暂停捕获新请求
- **清空**：清空请求列表和转换结果
- **保留日志**：勾选后页面跳转不清空已捕获的请求（配置会记住）

## 目录结构

```
├── manifest.json            # 扩展清单（MV3，无额外权限）
├── devtools.html            # 面板注册入口
├── panel.html / panel.css   # 面板页面
├── src/
│   ├── devtools.ts          # 注册 DevTools 面板
│   ├── panel.ts             # 请求捕获、列表渲染、转换交互
│   └── converter/           # 转换核心（纯函数，可独立测试）
│       ├── captured.ts          # HAR 数据结构归一化
│       ├── path-template.ts     # 路径参数识别
│       ├── schema-infer.ts      # JSON Schema 推断与合并
│       └── openapi-builder.ts   # OpenAPI 文档组装、鉴权识别
└── test/                    # vitest 单元测试
```

## 说明

- 响应体超过 1MB 的请求不参与响应 Schema 推断
- 仅捕获 XHR / Fetch 请求，静态资源（js/css/图片等）自动过滤
- SSE / WebSocket 暂不支持
