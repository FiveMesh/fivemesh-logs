export type StructuredImage = {
  path: string;
  url: string;
};

const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const IMAGE_FORMATS = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
const SAFE_DATA_IMAGE =
  /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;

export function extractImageUrls(
  value: unknown,
  maximum = 8,
): StructuredImage[] {
  if (maximum <= 0) return [];

  const images: StructuredImage[] = [];
  const seenObjects = new WeakSet<object>();
  const seenUrls = new Set<string>();

  function visit(current: unknown, path: string, keyHint = "") {
    if (images.length >= maximum) return;

    if (typeof current === "string") {
      const url = parseImageUrl(current, keyHint);
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      images.push({ path, url });
      return;
    }

    if (!current || typeof current !== "object") return;
    if (seenObjects.has(current)) return;
    seenObjects.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, `${path}[${index}]`, keyHint);
      });
      return;
    }

    Object.entries(current).forEach(([key, item]) => {
      visit(item, path ? `${path}.${key}` : key, key);
    });
  }

  visit(value, "");
  return images;
}

function parseImageUrl(value: string, keyHint: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  if (SAFE_DATA_IMAGE.test(candidate)) return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isPrivateHostname(url.hostname)
  ) {
    return null;
  }

  const format = (
    url.searchParams.get("format") ??
    url.searchParams.get("extension") ??
    url.searchParams.get("ext") ??
    ""
  ).toLowerCase();
  const hasImageShape =
    IMAGE_EXTENSIONS.test(url.pathname) || IMAGE_FORMATS.has(format);

  return hasImageShape || isImageKey(keyHint) ? url.href : null;
}

function isImageKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("image") ||
    normalized.includes("photo") ||
    normalized.includes("screenshot") ||
    normalized.includes("thumbnail") ||
    normalized === "avatar" ||
    normalized === "avatarurl" ||
    normalized === "icon" ||
    normalized === "iconurl"
  );
}

function isPrivateHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  if (hostname.includes(":")) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("::ffff:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      /^fe[89ab]/.test(hostname)
    );
  }

  const octets = hostname.split(".");
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^\d{1,3}$/.test(octet))
  ) {
    return false;
  }

  const numbers = octets.map(Number);
  if (numbers.some((octet) => octet > 255)) return true;

  const first = numbers[0]!;
  const second = numbers[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}
