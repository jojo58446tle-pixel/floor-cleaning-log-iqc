import sharp from 'sharp';
export async function optimizeImage(input: Buffer) {
  const meta = await sharp(input, { limitInputPixels: 60000000, animated: false }).metadata();
  if (!['jpeg', 'png', 'webp', 'heif'].includes(meta.format || '') || (meta.pages || 1) > 1) throw new Error('Use a single JPEG, PNG or WebP photo. Export HEIC as JPEG if your device requires it.');
  let quality = 80;
  let full = await sharp(input, { limitInputPixels: 60000000 }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
  while (full.data.length > 700 * 1024 && quality > 60) {
    quality -= 5;
    full = await sharp(input, { limitInputPixels: 60000000 }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
  }
  const thumb = await sharp(full.data).resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}
