import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT_DIR = process.cwd();
const logoSvgPath = path.join(ROOT_DIR, 'public/images/logo.svg');
const favSvgPath = path.join(ROOT_DIR, 'public/favicon.svg');

async function generate() {
  console.log('Reading SVG sources...');
  const logoSvg = fs.readFileSync(logoSvgPath);
  const favSvg = fs.readFileSync(favSvgPath);

  // 1. Generate 512x512 logo.png
  console.log('Generating public/images/logo.png (512x512)...');
  await sharp(logoSvg, { density: 600 })
    .resize(512, 512)
    .png()
    .toFile(path.join(ROOT_DIR, 'public/images/logo.png'));

  // 2. Generate 96x96 bear.png (legacy replacement for backward compatibility)
  console.log('Generating public/images/bear.png (96x96)...');
  await sharp(logoSvg, { density: 600 })
    .resize(96, 96)
    .png()
    .toFile(path.join(ROOT_DIR, 'public/images/bear.png'));

  // 3. Generate 256x256 avatar.png (for about page & OG)
  console.log('Generating public/images/avatar.png (256x256)...');
  await sharp(logoSvg, { density: 600 })
    .resize(256, 256)
    .png()
    .toFile(path.join(ROOT_DIR, 'public/images/avatar.png'));

  // 4. Generate 32x32 favicon.png
  console.log('Generating public/favicon.png (32x32)...');
  await sharp(favSvg, { density: 600 })
    .resize(32, 32)
    .png()
    .toFile(path.join(ROOT_DIR, 'public/favicon.png'));

  // 5. Generate 180x180 apple-touch-icon.png
  console.log('Generating public/apple-touch-icon.png (180x180)...');
  await sharp(logoSvg, { density: 600 })
    .resize(180, 180)
    .png()
    .toFile(path.join(ROOT_DIR, 'public/apple-touch-icon.png'));

  console.log('All icons generated successfully!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
