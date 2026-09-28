import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Agent } from "undici";

// =============================================================================
// SSRF guard for image downloads
// =============================================================================
// Image URLs come from third-party pages and search results, so the server
// must never be tricked into requesting internal addresses (cloud metadata,
// the WordPress admin on the LAN, localhost services, ...).
//
// Two layers:
//   1. assertPublicHttpUrl() rejects bad schemes, credentials, internal IP
//      literals and host names that resolve to internal addresses;
//   2. guardedDispatcher() re-checks the address actually used for the TCP
//      connection, which defeats DNS rebinding (a host that resolves to a
//      public IP for the check and to 127.0.0.1 for the download).

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
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into eight 16-bit groups (handles "::" and a trailing IPv4). */
export function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = ipv4ToInt(v4[1]);
    text = `${text.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail, extra] = text.split("::");
  if (extra !== undefined) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const embeddedV4 = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const g = expandIPv6(ip);
  if (!g) return true;
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(6)) return true; // ::, ::1 and deprecated IPv4-compatible ::a.b.c.d
  if (zeroUpTo(5) && g[5] === 0xffff) return isPrivateV4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64: 64:ff9b::/96 carries an IPv4 address; 64:ff9b:1::/48 is local use.
    return g[2] !== 0 || g[3] !== 0 || g[4] !== 0 || g[5] !== 0 || isPrivateV4(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo (hides an IPv4 address)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && zeroUpTo(4)) return true; // discard prefix
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link/site local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export class BlockedUrlError extends Error {
  readonly code = "EBLOCKED";
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
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError(`Endereço interno bloqueado: ${url.hostname}`);
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;

/** dns.lookup replacement used at connect time: refuses internal addresses. */
export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = addresses as dns.LookupAddress[];
      if (!list.length || (!allowPrivate && list.some((a) => isPrivateAddress(a.address)))) {
        return callback(new BlockedUrlError(`Endereço interno bloqueado: ${hostname}`));
      }
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

const dispatchers = new Map<boolean, Agent>();

/** undici dispatcher whose connections can only reach public addresses. */
export function guardedDispatcher(allowPrivate: boolean): Agent {
  let agent = dispatchers.get(allowPrivate);
  if (!agent) {
    agent = new Agent({
      connect: { lookup: guardedLookup(allowPrivate) as never, timeout: 10_000 },
      headersTimeout: 20_000,
      bodyTimeout: 20_000,
      connections: 16,
    });
    dispatchers.set(allowPrivate, agent);
  }
  return agent;
}
