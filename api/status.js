// 查询 prediction 状态

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: '缺少 id 参数' });

  const REPLICATE_KEY = process.env.REPLICATE_KEY;
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 API Key' });

  try {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` },
    });

    if (!pollRes.ok) {
      const err = await pollRes.json().catch(() => ({}));
      return res.status(pollRes.status).json({ error: err.detail || '查询失败' });
    }

    const pred = await pollRes.json();
    const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    return res.status(200).json({ status: pred.status, output, error: pred.error });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
