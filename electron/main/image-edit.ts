import sharp from "sharp";

export type EditCrop = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EditOptions = {
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  crop?: EditCrop | null;
  grayscale?: boolean;
  normalize?: boolean;
};

function turnsOf(rotation: number) {
  const turns = ((rotation % 360) + 360) % 360;
  if (turns === 90 || turns === 180 || turns === 270) return turns;
  return 0;
}

async function orientedPixels(file: string, options: EditOptions) {
  const exif = await sharp(file, { failOn: "none" }).rotate().toBuffer();
  let image = sharp(exif);
  const turns = turnsOf(options.rotation || 0);
  if (turns) image = image.rotate(turns);
  if (options.flipV) image = image.flip();
  if (options.flipH) image = image.flop();
  return image.toBuffer({ resolveWithObject: true });
}

function cropImage(image: sharp.Sharp, width: number, height: number, crop?: EditCrop | null) {
  if (!crop || !width || !height) return image;
  const left = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(crop.w * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(crop.h * height)));
  if (left === 0 && top === 0 && cropWidth === width && cropHeight === height) return image;
  return image.extract({ left, top, width: cropWidth, height: cropHeight });
}

export async function renderEdit(
  file: string,
  options: EditOptions,
  preview: boolean,
  format: "jpeg" | "png" | "webp" = "jpeg",
) {
  const oriented = await orientedPixels(file, options);
  let sourceWidth = oriented.info.width;
  let sourceHeight = oriented.info.height;
  const crop = options.crop;
  if (crop && sourceWidth && sourceHeight) {
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(crop.x * sourceWidth)));
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(crop.y * sourceHeight)));
    sourceWidth = Math.max(1, Math.min(sourceWidth - left, Math.round(crop.w * sourceWidth)));
    sourceHeight = Math.max(1, Math.min(sourceHeight - top, Math.round(crop.h * sourceHeight)));
  }
  let image = cropImage(sharp(oriented.data), oriented.info.width, oriented.info.height, options.crop);
  if (options.grayscale) image = image.grayscale();
  if (options.normalize) image = image.normalise();
  if (preview) {
    image = image.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 });
  } else if (format === "png") {
    image = image.png();
  } else if (format === "webp") {
    image = image.webp({ quality: 90 });
  } else {
    image = image.jpeg({ quality: 92 });
  }
  const rendered = await image.toBuffer({ resolveWithObject: true });
  return { ...rendered, sourceWidth, sourceHeight };
}
