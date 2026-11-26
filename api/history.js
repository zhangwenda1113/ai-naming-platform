import { createClient } from '@supabase/supabase-js';
import { modelConfigMap } from './name.js';

/**
 * GET /api/history
 * 返回最近 20 条起名记录，供前端历史面板展示
 */
export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(200).json({ items: [], error: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY' });
    return;
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('name_history')
      .select('id, user_requirement, name_result, model_name, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      res.status(200).json({ items: [], error: error.message });
      return;
    }
    res.status(200).json({ items: data || [] });
  } catch (err) {
    res.status(200).json({ items: [], error: err?.message || String(err) });
  }
}

// 让前端可以拿到模型列表（下拉框动态渲染，新增模型不用改前端）
export const models = Object.entries(modelConfigMap).map(([key, conf]) => ({
  key,
  label: conf.label
}));
