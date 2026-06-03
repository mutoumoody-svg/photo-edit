// 接收三个图片 URL（已上传），提交 Replicate 任务

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, imageUrl, maskUrl, referenceUrl } = req.body;

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
    // Step 1: 用视觉模型分析参考产品图，自动生成 prompt
    let prompt = 'a product, clean, photorealistic, high quality';

    if (referenceUrl) {
      try {
        const visionRes = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            version: '80537f9eead1a5bfa72d5ac6ea6414379be41d4d4f6679fd776e9535d1eb58bb',
            input: {
              image: referenceUrl,
              question: 'Describe this product briefly for image generation: shape, color, material, style. One sentence only.',
            },
          }),
        });

        if (visionRes.ok) {
          let vPred = await visionRes.json();
          let attempts = 0;
          while (vPred.status !== 'succeeded' && vPred.status !== 'failed' && attempts < 20) {
            await sleep(1500);
            attempts++;
            const poll = await fetch(`https://api.replicate.com/v1/predictions/${vPred.id}`, { headers });
            vPred = await poll.json();
          }
          if (vPred.status === 'succeeded' && vPred.output) {
            const desc = Array.isArray(vPred.output) ? vPred.output.join('') : vPred.output;
            prompt = `${desc}, product photography, photorealistic, high quality, clean background`;
          }
        }
      } catch (e) {
        console.error('Vision step failed:', e.message);
      }
    }

    // Step 2: 提交 SDXL Inpainting
    const inpaintRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        version: 'a5b13068cc81a89a4fbeefeccc774869fcb34df4dbc92c1555e0f2771d49dde7',
        input: {
          image: imageUrl,
          mask: maskUrl,
          prompt,
          negative_prompt: 'blurry, deformed, ugly, bad quality, watermark, text',
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
