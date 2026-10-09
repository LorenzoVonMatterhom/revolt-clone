export function gameAssetUrl(path, base = import.meta.env?.BASE_URL ?? "/") {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || /^(data|blob):/i.test(path)) return path;
  return `${base.endsWith("/") ? base : `${base}/`}${path.replace(/^\/+/, "")}`;
}
