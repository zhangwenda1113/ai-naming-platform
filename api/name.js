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
