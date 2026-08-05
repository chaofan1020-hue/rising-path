const { createCanvas } = require('canvas');
const fs = require('fs');

const canvas = createCanvas(256, 64);
const ctx = canvas.getContext('2d');

// White background
ctx.fillStyle = '#FFFFFF';
ctx.fillRect(0, 0, 256, 64);

// Add a subtle pattern
ctx.fillStyle = '#E8E8E8';
for (let i = 0; i < 256; i += 16) {
  ctx.fillRect(i, 0, 8, 64);
}

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('/workspace/projects/public/lanyard.png', buffer);
console.log('Created lanyard.png:', buffer.length, 'bytes');
