// 提交任务到 Replicate，立即返回 prediction ID（不等待结果）

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, image, mask, reference_image } = req.body;
  const SITE_PASSWORD = process.env.SITE_PASSWORD;
  if (SITE_PASSWORD && password !== SITE_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }

  const REPLICATE_KEY = process.env.REPLICATE_KEY;
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 API Key' });

  try {
    const createRes = await fetch(
      'https://api.replicate.com/v1/models/Fantasy-Studio/paint-by-example/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REPLICATE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: { image, mask, reference_image } }),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return res.status(createRes.status).json({ error: err.detail || 'Replicate 提交失败' });
    }

    const pred = await createRes.json();
    // 只返回 ID，前端自己轮询
    return res.status(200).json({ id: pred.id, status: pred.status });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
