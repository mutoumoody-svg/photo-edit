// 两步流程：
// 1. 用视觉模型分析参考产品图，生成描述
// 2. 用 SDXL Inpainting 按描述替换

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
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

  const headers = {
    'Authorization': `Bearer ${REPLICATE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // ── Step 1：用 moondream2 分析参考产品图 ──────────────────────────────────
    let prompt = 'a product, clean, photorealistic, high quality';

    if (reference_image) {
      try {
        const visionRes = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            version: '80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb',
            input: {
              image: reference_image,
              question: 'Describe this product in detail for image generation: its shape, color, material, style, and packaging. Be concise and specific.',
            },
          }),
        });

        if (visionRes.ok) {
          let vPred = await visionRes.json();
          let vAttempts = 0;
          while (vPred.status !== 'succeeded' && vPred.status !== 'failed' && vAttempts < 20) {
            await sleep(1500);
            vAttempts++;
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${vPred.id}`, { headers });
            vPred = await poll.json();
          }
          if (vPred.status === 'succeeded' && vPred.output) {
            const desc = Array.isArray(vPred.output) ? vPred.output.join('') : vPred.output;
            prompt = `${desc}, product photography, photorealistic, high quality, clean`;
          }
        }
      } catch (e) {
        // 视觉分析失败则用默认 prompt，不影响主流程
        console.error('Vision step failed:', e.message);
      }
    }

    // ── Step 2：提交 SDXL Inpainting ──────────────────────────────────────────
    const inpaintRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 'a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7',
        input: {
          image,
          mask,
          prompt,
          negative_prompt: 'blurry, deformed, ugly, bad quality, watermark, text, extra objects',
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      }),
    });

    if (!inpaintRes.ok) {
      const err = await inpaintRes.json().catch(() => ({}));
      return res.status(inpaintRes.status).json({ error: err.detail || 'Replicate 提交失败' });
    }

    const pred = await inpaintRes.json();
    return res.status(200).json({ id: pred.id, status: pred.status, prompt });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
