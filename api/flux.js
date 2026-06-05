// FLUX Fill Pro inpainting via Replicate
// 流程：GPT-4o 视觉描述参考产品 → 上传图到 Replicate → FLUX Fill 生成
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
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
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 Replicate Key' });

  const OPENAI_KEY = process.env.OPENAI_KEY;

  try {
    // ── Step 1: 用 GPT-4o 视觉描述参考产品 ──────────────────────────────────
    let productDesc = userPrompt || '';

    if (reference_image && OPENAI_KEY && !userPrompt) {
      try {
        const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 120,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Describe this product in 1-2 sentences for an image generation prompt. Be specific about shape, color, material, label design. No brand names. Start directly with the description.',
                },
                { type: 'image_url', image_url: { url: reference_image } },
              ],
            }],
          }),
        });
        if (visionRes.ok) {
          const vd = await visionRes.json();
          productDesc = vd.choices?.[0]?.message?.content?.trim() || '';
        }
      } catch (_) { /* 视觉描述失败时用空 prompt */ }
    }

    const prompt = productDesc
      ? `Replace the masked region with: ${productDesc}. Preserve all surrounding content, lighting, shadows, and perspective exactly. Photorealistic product photography.`
      : 'Fill the masked region naturally to match the surrounding scene. Photorealistic.';

    // ── Step 2: 上传原图 + 遮罩到 Replicate Files API ───────────────────────
    const [imageUrl, maskUrl] = await Promise.all([
      uploadBuffer(
        Buffer.from(image.split(',')[1], 'base64'),
        'image/jpeg',
        'image.jpg',
        REPLICATE_KEY,
      ),
      uploadBuffer(
        Buffer.from(mask.split(',')[1], 'base64'),
        'image/png',
        'mask.png',
        REPLICATE_KEY,
      ),
    ]);

    // ── Step 3: 创建 FLUX Fill Pro prediction ─────────────────────────────
    const predRes = await fetch(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REPLICATE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait=5',
        },
        body: JSON.stringify({
          input: {
            prompt,
            image: imageUrl,
            mask: maskUrl,
            output_format: 'jpg',
            output_quality: 95,
            prompt_upsampling: false,
          },
        }),
      },
    );

    if (!predRes.ok) {
      const err = await predRes.json().catch(() => ({}));
      return res.status(predRes.status).json({ error: err.detail || 'Replicate 请求失败' });
    }

    const pred = await predRes.json();

    // 如果已经同步完成（wait=5 秒内完成）
    if (pred.status === 'succeeded') {
      const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return res.status(200).json({ status: 'succeeded', output });
    }

    // 否则返回 prediction ID 供前端轮询
    return res.status(200).json({ status: pred.status, id: pred.id });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function uploadBuffer(buffer, mimeType, filename, key) {
  // Replicate Files API 要求 multipart/form-data，字段名为 content
  const formData = new FormData();
  formData.append('content', new Blob([buffer], { type: mimeType }), filename);

  const uploadRes = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      // 不要手动设置 Content-Type，让 fetch 自动加 boundary
    },
    body: formData,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.detail || '文件上传失败');
  }
  const file = await uploadRes.json();
  return file.urls?.get || file.url;
}
