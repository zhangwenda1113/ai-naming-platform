import { createClient } from '@supabase/supabase-js';

/**
 * 模型配置表：所有平台都提供 OpenAI 兼容接口
 * 只要新增一个配置项，就能多接一家模型，主调用代码完全不用改
 */
export const modelConfigMap = {
  doubao: {
    label: '豆包（火山方舟）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'DOUBAO_API_KEY',
    modelEnv: 'DOUBAO_MODEL',
    defaultModel: 'doubao-seed-2-1-lite-260915',
    // 方舟深度思考模型默认带推理过程，起名场景关掉思考，降低首字延迟
    extraBody: { thinking: { type: 'disabled' } }
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat'
  },
  qwen: {
    label: '通义千问（DashScope 兼容模式）',
    // 注意：必须用 compatible-mode 地址，普通地址不兼容 OpenAI 协议
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_API_KEY',
    defaultModel: 'qwen-plus'
  },
  kimi: {
    label: 'Kimi（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    defaultModel: 'kimi-k3'
  }
};

const STYLE_PROMPT = {
  guofeng: '风格偏好：国风古典，名字要出自诗词典故或传统意象，用字雅致、有出处。',
  modern: '风格偏好：现代简约，名字要好写好认、读音干净、气质清爽，不堆砌生僻字。',
  english: '风格偏好：英文名，给出与中文名气质对应的英文名（FirstName 或 FirstName + MiddleName），并说明发音与含义。'
};

function buildMessages(requirement, style) {
  const styleRule = STYLE_PROMPT[style] || STYLE_PROMPT.modern;
  const system = [
    '你是一位精通汉语言文学与姓名文化的起名顾问。',
    '请根据用户给出的需求，给出 3 组名字方案。',
    '每组方案必须包含：名字、读音、字义拆解、整体寓意、适用场景（如性格期待、家族气质）。',
    '输出用 Markdown 排版，结构为：一组一个二级标题「方案一/方案二/方案三」，标题下按要点展开。',
    '名字要真实可用，不要生造字，不要给出明显不吉或谐音不雅的组合。',
    styleRule
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: `起名需求：${requirement}` }
  ];
}

function pickConfig(modelKey) {
  const key = String(modelKey || 'doubao').toLowerCase();
  const conf = modelConfigMap[key];
  if (!conf) return { error: `不支持的模型：${modelKey}，可选：${Object.keys(modelConfigMap).join(' / ')}` };

  const apiKey = process.env[conf.apiKeyEnv];
  if (!apiKey) return { error: `未配置环境变量 ${conf.apiKeyEnv}，请先在 .env 或 Vercel 环境变量中填入密钥` };

  const model = (conf.modelEnv && process.env[conf.modelEnv]) || conf.defaultModel;
  return {
    key,
    label: conf.label,
    baseURL: conf.baseURL,
    apiKey,
    model,
    url: `${conf.baseURL.replace(/\/$/, '')}/chat/completions`
  };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function saveHistory(payload) {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY，历史记录未入库' };
  const { data, error } = await supabase
    .from('name_history')
    .insert([
      {
        user_requirement: payload.user_requirement,
        name_result: payload.name_result,
        model_name: payload.model_name
      }
    ])
    .select('id')
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data?.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持 POST 请求' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const requirement = String(body.requirement || '').trim();
  const style = String(body.style || 'modern');
  const modelKey = String(body.model || 'doubao');

  if (!requirement) {
    res.status(400).json({ error: '请先填写起名需求' });
    return;
  }
  if (requirement.length > 300) {
    res.status(400).json({ error: '起名需求请控制在 300 字以内' });
    return;
  }

  const conf = pickConfig(modelKey);
  if (conf.error) {
    res.status(400).json({ error: conf.error });
    return;
  }

  // 建立 SSE 长连接
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let clientClosed = false;
  req.on('close', () => { clientClosed = true; });

  const startedAt = Date.now();
  let fullText = '';
  let upstreamError = '';
  const controller = new AbortController();

  try {
    const upstream = await fetch(conf.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${conf.apiKey}`
      },
      body: JSON.stringify({
        model: conf.model,
        stream: true,
        temperature: 0.8,
        messages: buildMessages(requirement, style),
        ...(conf.extraBody || {})
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      upstreamError = `上游返回 ${upstream.status}：${text.slice(0, 300)}`;
      send({ type: 'error', message: upstreamError, model: conf.key });
      if (!res.writableEnded) res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (clientClosed) { controller.abort(); break; }

      buffer += decoder.decode(value, { stream: true });
      // SSE 以空行分隔事件
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              send({ type: 'delta', content: delta });
            }
          } catch {
            // 个别平台会插入非 JSON 心跳行，直接忽略
          }
        }
      }
    }

    send({ type: 'meta', model: conf.key, modelLabel: conf.label, modelName: conf.model });

    // 流结束，落库
    const saved = await saveHistory({
      user_requirement: requirement,
      name_result: fullText,
      model_name: `${conf.key}:${conf.model}`
    });

    send({
      type: 'done',
      model: conf.key,
      modelLabel: conf.label,
      elapsedMs: Date.now() - startedAt,
      saved: saved.ok,
      historyId: saved.ok ? saved.id : null,
      saveError: saved.ok ? null : saved.reason
    });
  } catch (err) {
    if (!upstreamError) {
      send({ type: 'error', message: `调用失败：${err?.message || err}` });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
