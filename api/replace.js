export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, image, mask, reference_image, prompt: userPrompt } = req.body;

  const SITE_PASSWORD = process.env.SITE_PASSWORD;
  if (SITE_PASSWORD && password !== SITE_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  const REPLICATE_KEY = process.env.REPLICATE_KEY;
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 API Key' });

  const headers = {
    'Authorization': `Bearer ${REPLICATE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 用用户填写的描述，或默认 prompt
  const prompt = userPrompt
    ? `${userPrompt}, product photography, photorealistic, high quality`
    : 'a product, clean, product photography, photorealistic, high quality';

  try {
    const ir = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST', headers,
      body: JSON.stringify({
        version: 'a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7',
        input: {
          image, mask, prompt,
          negative_prompt: 'blurry, deformed, ugly, bad quality, watermark, text',
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      }),
    });

    if (!ir.ok) {
      const err = await ir.json().catch(() => ({}));
      return res.status(ir.status).json({ error: err.detail || 'Replicate 提交失败' });
    }
    const pred = await ir.json();
    return res.status(200).json({ id: pred.id, status: pred.status });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
