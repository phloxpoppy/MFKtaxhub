const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Kaedah tidak dibenarkan.' });
  try {
    const { image, mimeType, profileType = 'personal' } = JSON.parse(event.body || '{}');
    if (!process.env.GEMINI_API_KEY) return response(503, { error: 'Gemini belum dikonfigurasi.' });
    if (!image || !ALLOWED_TYPES.has(mimeType) || image.length > 10_000_000) return response(400, { error: 'Imej tidak sah atau terlalu besar.' });
    const categories = profileType === 'business'
      ? 'Biz-Supplies, Biz-Utilities, Biz-Machines, Biz-Rental, Biz-Travel, Biz-Marketing, Biz-Others'
      : 'Lifestyle, Medical, Education, Tech, Insurance, Childcare, Sports, Others';
    const prompt = `Analisis resit Malaysia ini. Balas JSON tulen sahaja dengan store, date (YYYY-MM-DD), amount (nombor), items (ringkas), category (satu daripada: ${categories}), confidence (0 hingga 1), uncertainFields (array nama medan). Jangan reka maklumat yang tidak kelihatan.`;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const api = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const upstream = await fetch(api, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: image } }] }], generationConfig: { responseMimeType: 'application/json' } })
    });
    if (!upstream.ok) throw new Error(`OCR upstream ${upstream.status}`);
    const data = await upstream.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Respons OCR kosong');
    return response(200, JSON.parse(text));
  } catch (error) {
    console.error('OCR error', error.message);
    return response(500, { error: 'Resit tidak dapat dibaca. Sila isi secara manual.' });
  }
};

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

