// FLUX Fill Pro inpainting via Replicate
// 流程：GPT-4o 视觉描述参考产品 → 直接用 base64 data URI 调 FLUX Fill
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

    // ── Step 2: 直接用 base64 data URI 创建 FLUX Fill Pro prediction ───────
    // Replicate 原生支持 data URI，无需先上传文件
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
            image: image,   // data:image/jpeg;base64,...
            mask:  mask,    // data:image/png;base64,...
            output_format: 'jpg',
            safety_tolerance: 6,
            prompt_upsampling: false,
          },
        }),
      },
    );

    if (!predRes.ok) {
      const errText = await predRes.text().catch(() => '');
      let detail = errText;
      try { detail = JSON.parse(errText).detail || errText; } catch (_) {}
      return res.status(predRes.status).json({
        error: `创建预测失败 [HTTP ${predRes.status}]: ${detail || '未知错误'}`,
      });
    }

    const pred = await predRes.json();

    // 已同步完成
    if (pred.status === 'succeeded') {
      const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return res.status(200).json({ status: 'succeeded', output });
    }

    // 失败
    if (pred.status === 'failed' || pred.status === 'canceled') {
      return res.status(500).json({ error: `生成失败: ${pred.error || pred.status}` });
    }

    // 返回 ID 供前端轮询
    if (!pred.id) {
      return res.status(500).json({ error: '未获得 prediction ID，响应: ' + JSON.stringify(pred).slice(0, 200) });
    }
    return res.status(200).json({ status: pred.status, id: pred.id });

  } catch (e) {
    return res.status(500).json({ error: 'flux.js 异常: ' + e.message });
  }
}
