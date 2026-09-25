export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

export function fileName(filePath: string) {
  return String(filePath).split(/[/\\]/).pop() || filePath;
}

export function fileSrc(filePath: string) {
  if (/^(https?:|data:|pic:)/i.test(filePath)) return filePath;
  const normalized = String(filePath).replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = encodeURI(prefixed).replace(/[?#]/g, (char) => encodeURIComponent(char));
  return `pic://local${encoded}`;
}
