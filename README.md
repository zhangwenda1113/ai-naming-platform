# AI 起名平台（多模型版）

Vercel Node 项目：SSE 流式输出 · 4 家大模型一键切换 · Supabase 历史留档 · 密钥全走环境变量。

## 目录结构

```
ai-naming-platform/
├─ index.html              # 前端页面（输入需求、选模型/风格、流式渲染、历史面板）
├─ api/
│  ├─ name.js              # 核心接口：modelConfigMap + 一套 fetch 调用 4 家模型 + 落库
│  └─ history.js           # 历史记录查询
├─ sql/name_history.sql    # Supabase 建表 SQL（含正式上线 RLS 建议）
├─ stage1/name-single-model.js  # 阶段1 单模型版留档（对照实验过程）
├─ .env.example            # 环境变量模板
└─ package.json / .gitignore
```

## 本地跑起来

```bash
npm install
cp .env.example .env        # 然后填密钥
vercel dev                  # 打开 http://localhost:3000
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DOUBAO_API_KEY` | 火山方舟密钥（Ark API Key） |
| `DOUBAO_MODEL` | 方舟推理接入点 ID（`ep-xxxx`）或模型名，不填用默认值 |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥 |
| `QWEN_API_KEY` | 阿里云百炼 / DashScope 密钥 |
| `KIMI_API_KEY` | 月之暗面密钥 |
| `SUPABASE_URL` | Supabase 项目地址 |
| `SUPABASE_ANON_KEY` | Supabase anon 公钥（备用） |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端写入用（推荐，绕过 RLS，绝不下发前端） |

## 接口

- `POST /api/name`：`{ requirement, model, style }` → SSE 事件流
  - `{"type":"delta","content":"..."}` 增量文字
  - `{"type":"meta", ...}` 实际使用的模型
  - `{"type":"done", saved, historyId, elapsedMs}` 收尾 + 落库结果
  - `{"type":"error","message":"..."}` 出错
- `GET /api/history`：最近 20 条记录

## 换模型 / 加模型

只改 `api/name.js` 里的 `modelConfigMap`：新增一个 `{ label, baseURL, apiKeyEnv, defaultModel }`，前端下拉框加一行即可，主调用代码不动。

## 安全

`.env` 已在 `.gitignore` 中；所有密钥只在服务端读取，前端与仓库里都不会出现明文。
