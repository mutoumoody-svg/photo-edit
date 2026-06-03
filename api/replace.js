// Vercel Serverless Function
// Key 存在 Vercel 环境变量 REPLICATE_KEY 里，前端永远看不到

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

export default async function handler(req, res) {
  // 跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 密码校验
  const { password, image, mask, reference_image } = req.body;
  const SITE_PASSWORD = process.env.SITE_PASSWORD;
  if (SITE_PASSWORD && password !== SITE_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }

  const REPLICATE_KEY = process.env.REPLICATE_KEY;
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 API Key' });

  try {
    // 提交任务
    const createRes = await fetch(
      'https://api.replicate.com/v1/models/Fantasy-Studio/paint-by-example/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REPLICATE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait=60',
        },
        body: JSON.stringify({ input: { image, mask, reference_image } }),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      return res.status(createRes.status).json({ error: err.detail || 'Replicate 请求失败' });
    }

    let pred = await createRes.json();

    // 轮询直到完成（最多 3 分钟）
    let attempts = 0;
    while (pred.status !== 'succeeded' && pred.status !== 'failed' && attempts < 72) {
      await sleep(2500);
      attempts++;
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_KEY}` },
      });
      pred = await pollRes.json();
    }

    if (pred.status === 'failed') return res.status(500).json({ error: pred.error || '生成失败' });
    if (pred.status !== 'succeeded') return res.status(504).json({ error: '超时，请重试' });

    const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    return res.status(200).json({ output });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
