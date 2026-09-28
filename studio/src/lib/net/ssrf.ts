import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// =============================================================================
// SSRF guard for image downloads
// =============================================================================
// Image URLs come from third-party pages and search results, so the server
// must never be tricked into requesting internal addresses (cloud metadata,
// the WordPress admin on the LAN, localhost services, ...).

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const value = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  return true;
}

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Throw unless the URL is http(s) and resolves only to public addresses. */
export async function assertPublicHttpUrl(rawUrl: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`URL inválida: ${rawUrl.slice(0, 120)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Protocolo não permitido: ${url.protocol}`);
  }
  if (url.username || url.password) throw new BlockedUrlError("URL com credenciais não é permitida");
  if (allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError(`Endereço interno bloqueado: ${url.hostname}`);
  }
  return url;
}
