function cleanAIResponse(str) {
  if (!str) return str;
  // Remove code block markers
  str = str.trim();
  if (str.startsWith('```json')) str = str.replace(/^```json/, '').trim();
  if (str.startsWith('```')) str = str.replace(/^```/, '').trim();
  if (str.endsWith('```')) str = str.replace(/```$/, '').trim();
  // Remove leading/trailing newlines
  str = str.replace(/^[\r\n]+|[\r\n]+$/g, '');
  // Remove trailing commas before } or ]
  str = str.replace(/,(\s*[}\]])/g, '$1');
  // Unescape escaped quotes (if present)
  if (str.startsWith('"') && str.endsWith('"')) {
    try {
      str = JSON.parse(str);
    } catch {}
  }
  return str;
}

function extractImageUrlsFromMarkdown(text) {
  const regex = /!\[image\]\(([^)]+)\)/g;
  const urls = [];
  let match;
  while ((match = regex.exec(text))) {
    urls.push(match[1]);
  }
  return urls;
}

async function fetchImagesAsBase64(urls, req) {
  const results = [];
  for (const url of urls) {
    try {
      const absUrl = url.startsWith('/uploads/') ? `${req.protocol}://${req.get('host')}${url}` : url;
      console.log('[fetchImagesAsBase64] Fetching:', absUrl);
      const resp = await axios.get(absUrl, { responseType: 'arraybuffer' });
      const contentType = resp.headers['content-type'] || 'image/png';
      const base64 = Buffer.from(resp.data, 'binary').toString('base64');
      results.push({ base64, contentType });
    } catch (err) {
      console.error('[fetchImagesAsBase64] Error fetching image:', url, err.message);
    }
  }
  return results;
}

module.exports = {
  cleanAIResponse,
  extractImageUrlsFromMarkdown,
  fetchImagesAsBase64
}; 