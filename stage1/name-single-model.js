import { createClient } from '@supabase/supabase-js';

/**
 * 阶段 1 留档：单模型版本（文档驱动跑通的那一版）
 * 只接豆包一家，直接照着火山方舟官方 curl 示例写 fetch：
 *   curl https://ark.cn-beijing.volces.com/api/v1/chat/completions \\
 *     -H "Content-Type: application/json" \\
 *     -H "Authorization: Bearer $DOUBAO_API_KEY" \\
 *     -d '{"model":"ep-xxx","messages":[...],"stream":true}'
 *
 * 阶段 2 的成果在 /api/name.js：把地址、密钥、模型名抽成 modelConfigMap，
 * 一套调用代码支持 4 家模型。这份文件只作为实验过程证据保留。
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '只支持 POST' });
    return;
  }

  const { requirement = '' } = req.body || {};
  if (!requirement.trim()) {
    res.status(400).json({ error: '请先填写起名需求' });
    return;
  }

  const apiKey = process.env.DOUBAO_API_KEY;
  const model = process.env.DOUBAO_MODEL || 'doubao-seed-1-6-250615';
  if (!apiKey) {
    res.status(400).json({ error: '未配置 DOUBAO_API_KEY' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.status(200);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };

  // 单模型：地址、模型名都写死在这里，想换模型就得改这一整段 —— 这正是阶段 2 要重构的问题
  const upstream = await fetch('https://ark.cn-beijing.volces.com/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: '你是起名顾问，请给出 3 组名字，每组含读音、字义、寓意。' },
        { role: 'user', content: `起名需求：${requirement}` }
      ]
    })
  });

  if (!upstream.ok) {
    send({ type: 'error', message: `上游返回 ${upstream.status}` });
    res.end();
    return;
  }

  let fullText = '';
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const json = JSON.parse(raw);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) { fullText += delta; send({ type: 'delta', content: delta }); }
        } catch {}
      }
    }
  }

  // 落库：单模型版同样写 name_history，model_name 直接写死
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  let saved = false;
  if (url && key) {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from('name_history').insert([{
      user_requirement: requirement,
      name_result: fullText,
      model_name: 'doubao(single)'
    }]);
    saved = !error;
  }

  send({ type: 'done', saved });
  res.end();
}
