import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, BlockedUrlError, isPrivateAddress } from "@/lib/net/ssrf";
import { collectCandidates, hammingDistance, inspectImage, processProductImage } from "@/lib/pipeline/images";
import type { Source } from "@/lib/types";

// =============================================================================
// Image processing and network safety
// =============================================================================

async function photo(width: number, height: number, color: string, withBorder = true) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${withBorder ? "#ffffff" : color}"/>
    <rect x="${width * 0.3}" y="${height * 0.1}" width="${width * 0.4}" height="${height * 0.8}" fill="${color}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("processProductImage", () => {
  it("outputs a square WebP of the configured size with no metadata", async () => {
    const input = await photo(900, 1400, "#c0392b");
    const out = await processProductImage(input, { size: 1200, quality: 82 });
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(1200);
    expect(meta.exif).toBeUndefined();
    expect(out.data.byteLength).toBeLessThan(200_000);
  });

  it("handles transparent PNGs by flattening onto white", async () => {
    const transparent = await sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processProductImage(transparent, { size: 1000, quality: 80 });
    const { data } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // white, not black
  });
});

describe("perceptual hash", () => {
  it("finds the same photo at another size and separates different photos", async () => {
    const a = await inspectImage(await photo(1000, 1000, "#2c3e50"));
    const b = await inspectImage(
      await sharp(await photo(1000, 1000, "#2c3e50"))
        .resize(600)
        .jpeg()
        .toBuffer(),
    );
    const c = await inspectImage(await photo(1000, 1000, "#2c3e50", false));
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) return;
    expect(hammingDistance(a.hash, b.hash)).toBeLessThanOrEqual(5);
    expect(hammingDistance(a.hash, c.hash)).toBeGreaterThan(5);
  });
});

describe("collectCandidates", () => {
  it("puts the reference page first and drops logos, icons, svg and banners", () => {
    const sources: Source[] = [
      {
        id: "S1",
        url: "https://ref.example",
        title: "",
        domain: "",
        origin: "reference",
        text: "",
        images: [
          "https://cdn.shop/produto.jpg",
          "https://cdn.shop/logo.png",
          "https://cdn.shop/icone.svg",
          "https://cdn.shop/produto-300x300.jpg",
        ],
      },
      {
        id: "S2",
        url: "https://other.example",
        title: "",
        domain: "",
        origin: "exa",
        text: "",
        images: [
          "https://img.other/foto.webp",
          "https://img.other/banner-frete-gratis.jpg",
          "data:image/png;base64,AAAA",
        ],
      },
    ];
    expect(collectCandidates(sources).map((c) => c.url)).toEqual([
      "https://cdn.shop/produto.jpg",
      "https://img.other/foto.webp",
    ]);
  });
});

describe("SSRF guard", () => {
  it("classifies private and public addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.0.1", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("blocks internal URLs, credentials and non-http protocols", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:8080/wp-admin")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicHttpUrl("https://user:pass@8.8.8.8/x.png")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicHttpUrl("https://8.8.8.8/x.png")).resolves.toBeInstanceOf(URL);
    await expect(assertPublicHttpUrl("http://127.0.0.1:8080/x.png", true)).resolves.toBeInstanceOf(URL);
  });
});
