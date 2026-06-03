// 把单张图片上传到 Replicate 文件存储，返回 URL
// 前端分三次调用，每次只传一张图，体积可控

export const config = {
  api: {
    bodyParser: { sizeLimit: '6mb' },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const REPLICATE_KEY = process.env.REPLICATE_KEY;
  if (!REPLICATE_KEY) return res.status(500).json({ error: '服务端未配置 API Key' });

  const { dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: '缺少 dataUrl' });

  try {
    // 把 base64 data URL 转成 Buffer
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: '无效的图片格式' });
    const mimeType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // 上传到 Replicate 文件存储
    const uploadRes = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_KEY}`,
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      return res.status(uploadRes.status).json({ error: err.detail || '上传失败' });
    }

    const file = await uploadRes.json();
    return res.status(200).json({ url: file.urls?.get || file.url });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
