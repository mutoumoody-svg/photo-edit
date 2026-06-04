export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
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

  const OPENAI_KEY = process.env.OPENAI_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: '服务端未配置 OpenAI Key' });

  try {
    // base64 → Buffer → Blob
    const imageBuffer = Buffer.from(image.split(',')[1], 'base64');
    const maskBuffer  = Buffer.from(mask.split(',')[1],  'base64');

    const prompt = userPrompt
      ? `Replace the selected area with: ${userPrompt}. Keep the same lighting, perspective and scale as the surrounding scene. Photorealistic.`
      : 'Replace the selected area with the product from the reference image. Keep the same lighting, perspective and scale as the surrounding scene. Photorealistic.';

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('image[]', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

    if (reference_image) {
      const refBuffer = Buffer.from(reference_image.split(',')[1], 'base64');
      formData.append('image[]', new Blob([refBuffer], { type: 'image/jpeg' }), 'reference.jpg');
    }

    formData.append('mask',   new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
    formData.append('prompt', prompt);
    formData.append('n',      '1');
    formData.append('size',   '1024x1024');

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: formData,
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      return res.status(openaiRes.status).json({ error: err.error?.message || 'OpenAI 请求失败' });
    }

    const result = await openaiRes.json();
    const b64 = result.data[0].b64_json;
    return res.status(200).json({ output: `data:image/png;base64,${b64}` });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
