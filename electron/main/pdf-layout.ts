const IMAGE_GAP = 12;
const MIN_SIDE = 144;

export type ImageSpan = {
  width: number;
  height: number;
};

export type PlacedImage = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function contain(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  return {
    width: Math.min(boxWidth, imageWidth * scale),
    height: Math.min(boxHeight, imageHeight * scale),
  };
}

function snap(value: number) {
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function alignPage(placed: PlacedImage[], boxWidth: number, boxHeight: number) {
  if (placed.length === 1) {
    const only = placed[0];
    only.x = snap((boxWidth - only.width) / 2);
    only.y = snap((boxHeight - only.height) / 2);
    return;
  }

  let minX = placed[0].x;
  let minY = placed[0].y;
  let maxX = placed[0].x + placed[0].width;
  let maxY = placed[0].y + placed[0].height;
  for (let i = 1; i < placed.length; i++) {
    const item = placed[i];
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  const shiftX = (boxWidth - (maxX - minX)) / 2 - minX;
  const shiftY = (boxHeight - (maxY - minY)) / 2 - minY;
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i];
    item.x = snap(item.x + shiftX);
    item.y = snap(item.y + shiftY);
  }
}

export function layoutImagePages(
  images: ImageSpan[],
  boxWidth: number,
  boxHeight: number,
  stack: "auto" | "vertical" = "auto",
) {
  const pages: PlacedImage[][] = [];
  let index = 0;

  while (index < images.length) {
    const placed: PlacedImage[] = [];
    let remainX = 0;
    let remainY = 0;
    let remainW = boxWidth;
    let remainH = boxHeight;

    while (index < images.length && remainW >= MIN_SIDE && remainH >= MIN_SIDE) {
      const image = images[index];
      const size = contain(image.width, image.height, remainW, remainH);
      if (placed.length > 0 && (size.width < MIN_SIDE || size.height < MIN_SIDE)) break;

      const leftoverW = remainW - size.width;
      const leftoverH = remainH - size.height;
      placed.push({
        index,
        x: remainX,
        y: remainY,
        width: size.width,
        height: size.height,
      });
      index += 1;

      if (stack === "vertical" || leftoverH >= leftoverW) {
        remainX = 0;
        remainW = boxWidth;
        remainY += size.height + IMAGE_GAP;
        remainH -= size.height + IMAGE_GAP;
      } else {
        remainX += size.width + IMAGE_GAP;
        remainW -= size.width + IMAGE_GAP;
      }
    }

    if (!placed.length) break;
    alignPage(placed, boxWidth, boxHeight);
    pages.push(placed);
  }

  return pages;
}
