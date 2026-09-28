import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

// =============================================================================
// Operator flows, end to end, with the real staging WooCommerce
// =============================================================================

function stagingEnv() {
  const file = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const get = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(file)?.[1]?.trim() ?? "";
  const base = get("WC_BASE_URL");
  const auth = `Basic ${Buffer.from(`${get("WP_USERNAME")}:${get("WP_APPLICATION_PASSWORD")}`).toString("base64")}`;
  return {
    base,
    async get(p: string) {
      const res = await fetch(`${base}/wp-json${p}`, { headers: { Authorization: auth } });
      return res.json();
    },
    async put(p: string, body: unknown) {
      const res = await fetch(`${base}/wp-json${p}`, {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json();
    },
    async remove(p: string) {
      await fetch(`${base}/wp-json${p}`, { method: "DELETE", headers: { Authorization: auth } });
    },
  };
}

const store = stagingEnv();
const shots = path.join(process.cwd(), "test-results", "screens");

async function fillForm(page: Page, name: string, url: string, qty: string) {
  await page.goto("/");
  await page.getByLabel("Nome do produto").fill(name);
  await page.getByLabel("Link de referência").fill(url);
  await page.getByLabel("Quantidade em estoque").fill(qty);
}

test("form explains what is missing in plain Portuguese @mobile", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Diga o produto. A IA faz o resto." })).toBeVisible();
  await page.screenshot({ path: path.join(shots, `01-form-${info.project.name}.png`), fullPage: true });
  await page.getByRole("button", { name: "Gerar cadastro" }).click();
  await expect(page.getByText("Digite o nome do produto (mínimo 3 letras).")).toBeVisible();
  await expect(page.getByText("Cole um link completo, começando com https://")).toBeVisible();
  await expect(page.getByText("Digite a quantidade em estoque.")).toBeVisible();
});

test("new food product: research -> review -> create (pending approval)", async ({ page }) => {
  await fillForm(
    page,
    "Lamen Buldak Carbonara 130g",
    "https://www.amazon.com.br/Lamen-Samyang-Buldak-Carbonara-130g/dp/B000000002",
    "36",
  );
  await page.getByRole("button", { name: "Gerar cadastro" }).click();

  await expect(page).toHaveURL(/\?job=/);
  await page.screenshot({ path: path.join(shots, "02-progress.png"), fullPage: true });

  const title = page.getByRole("heading", { level: 1, name: "Lamen Samyang Buldak Sabor Carbonara 130g" });
  await expect(title).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Produto novo: não encontramos nenhum igual na loja.")).toBeVisible();
  await expect(page.getByText("Todas as informações obrigatórias foram encontradas e conferidas.")).toBeVisible();
  await expect(page.locator(".product-html").getByRole("heading", { name: "Informação nutricional" })).toBeVisible();
  await page.screenshot({ path: path.join(shots, "03-review-new.png"), fullPage: true });

  await page.getByRole("tab", { name: /Informações/ }).click();
  await expect(page.getByRole("row", { name: /Glúten Contém glúten/ })).toBeVisible();
  await page.getByRole("tab", { name: /Fontes/ }).click();
  await expect(page.getByText("seu link de referência", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Sincronizar com a loja" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Criar um produto novo na loja.")).toBeVisible();
  await page.screenshot({ path: path.join(shots, "04-confirm.png") });
  await dialog.getByRole("button", { name: "Confirmar e sincronizar" }).click();

  await expect(page.getByText("Produto criado")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(shots, "05-done.png"), fullPage: true });
  const idText = await page.getByText(/^ID \d+/).textContent();
  const id = Number(/ID (\d+)/.exec(idText ?? "")?.[1]);
  expect(id).toBeGreaterThan(0);

  const product = await store.get(`/wc/v3/products/${id}`);
  expect(product.status).toBe("pending"); // no price yet: waits for the owner
  expect(product.stock_quantity).toBe(36);
  expect(product.manage_stock).toBe(true);
  expect(product.sku).toMatch(/^LAM-SAM-BUL-CAR-130G-[0-9A-Z]{4}$/);
  expect(product.global_unique_id).toBe("8801073113428");
  expect(product.images.length).toBeGreaterThan(0);
  expect(product.images[0].src).toMatch(/lamen-samyang-buldak-sabor-carbonara-130g.*\.webp$/);
  expect(product.images[0].alt.length).toBeGreaterThan(5);
  expect(product.description).toContain("Informação nutricional");
  expect(product.description).toContain("Contém glúten");
  expect(product.description).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2705}]/u);
  expect(product.brands.map((b: { name: string }) => b.name)).toContain("Samyang");
  expect(product.categories.map((c: { slug: string }) => c.slug)).toContain("ramyeon");
  expect(product.attributes.map((a: { name: string }) => a.name)).toEqual(
    expect.arrayContaining(["Marca", "Conteúdo líquido"]),
  );
  expect(Number(product.weight)).toBeGreaterThan(0);
  await store.remove(`/wc/v3/products/${id}?force=true`);
});

test("existing soju: content is refreshed, stock updated, no second listing", async ({ page }) => {
  await fillForm(
    page,
    "soju chum churum morango 360ml",
    "https://www.mercadolivre.com.br/soju-chum-churum-lotte-morango-360ml/p/MLB000001",
    "24",
  );
  await page.getByRole("button", { name: "Gerar cadastro" }).click();
  await expect(page.getByText("Este produto já existe na loja")).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Soju Lotte Chum-Churum Sabor Morango 360ml" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Informações/ }).click();
  await expect(page.getByRole("row", { name: /Teor alcoólico 12% vol\./ })).toBeVisible();
  await expect(page.getByText("16,5")).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, "03-review-existing.png"), fullPage: true });

  const idText = await page.locator("text=/^ID \\d+ ·/").first().textContent();
  const targetId = Number(/ID (\d+)/.exec(idText ?? "")?.[1]);
  const original = await store.get(`/wc/v3/products/${targetId}`);
  const before = (await store.get(`/wc/v3/products?search=chum-churum&per_page=100`)).length;

  await page.getByRole("button", { name: "Sincronizar com a loja" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirmar e sincronizar" }).click();
  await expect(page.getByText("Produto atualizado")).toBeVisible({ timeout: 60_000 });

  const after = await store.get(`/wc/v3/products/${targetId}`);
  expect(after.stock_quantity).toBe(24);
  expect(after.slug).toBe(original.slug);
  expect(after.sku).toBe(original.sku); // the existing SKU is never overwritten
  expect(after.global_unique_id).toBe("8801030000396");
  expect(after.description).toContain("Venda e consumo proibidos para menores de 18 anos.");
  expect((await store.get(`/wc/v3/products?search=chum-churum&per_page=100`)).length).toBe(before);

  await store.put(`/wc/v3/products/${targetId}`, {
    name: original.name,
    description: original.description,
    short_description: original.short_description,
    stock_quantity: original.stock_quantity,
    attributes: original.attributes,
    global_unique_id: "",
    images: [],
  });
});

test("triplicated product (O'Star): duplicate guard forces a stock update", async ({ page }) => {
  await fillForm(
    page,
    "Salgadinho O'Star Queijo Duplo 30g",
    "https://www.konbini.com.br/salgadinho-orion-o-star-queijo-duplo-30g",
    "50",
  );
  await page.getByRole("button", { name: "Gerar cadastro" }).click();

  // The mirror has the 3 production copies: all are confident matches, so the
  // operator must pick which one to update and "create" is not even offered.
  const banner = page.getByText(/Este produto já existe na loja \d+ vezes/);
  await expect(banner).toBeVisible({ timeout: 90_000 });
  const sync = page.getByRole("button", { name: "Sincronizar com a loja" });
  await expect(sync).toBeDisabled();
  await expect(page.getByText("Escolha uma opção no quadro acima para liberar o botão.")).toBeVisible();
  await expect(page.getByText("É um produto diferente: criar um novo")).toHaveCount(0);
  const options = page.getByRole("radio");
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: path.join(shots, "06-duplicate.png"), fullPage: true });

  const first = options.first();
  const targetId = Number((await first.getAttribute("value")) ?? "0");
  await first.click();
  const original = await store.get(`/wc/v3/products/${targetId}`);

  await sync.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(`Atualizar o produto ID ${targetId}`, { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirmar e sincronizar" }).click();
  await expect(page.getByText("Produto atualizado")).toBeVisible({ timeout: 60_000 });

  const after = await store.get(`/wc/v3/products/${targetId}`);
  expect(after.stock_quantity).toBe(50);
  expect(after.id).toBe(original.id);
  expect(after.slug).toBe(original.slug); // URL kept for SEO

  // Restore the staging mirror
  await store.put(`/wc/v3/products/${targetId}`, {
    name: original.name,
    description: original.description,
    short_description: original.short_description,
    stock_quantity: original.stock_quantity,
    attributes: original.attributes,
    images: [],
  });
});

test("discard: the registration leaves the queue and stays in the history", async ({ page }) => {
  await fillForm(
    page,
    "Pelúcia Capivara Gotinha 45cm",
    "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
    "3",
  );
  await page.getByRole("button", { name: "Gerar cadastro" }).click();
  await expect(page.getByRole("button", { name: "Sincronizar com a loja" })).toBeVisible({ timeout: 90_000 });
  const jobUrl = page.url();
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("heading", { name: "Diga o produto. A IA faz o resto." })).toBeVisible();

  await page.goto(jobUrl);
  await expect(page.getByRole("heading", { name: "Este cadastro foi descartado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizar com a loja" })).toHaveCount(0);
});

test("history lists every registration @mobile", async ({ page }, info) => {
  await page.goto("/historico");
  await expect(page.getByRole("heading", { name: "Histórico" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lamen Samyang Buldak Sabor Carbonara 130g/ }).first()).toBeVisible();
  await page.screenshot({ path: path.join(shots, `07-history-${info.project.name}.png`), fullPage: true });
});
