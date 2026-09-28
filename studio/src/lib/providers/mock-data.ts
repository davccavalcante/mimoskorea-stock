// =============================================================================
// Offline fixtures for STUDIO_PROVIDERS=mock
// =============================================================================
// Realistic retailer pages used by the mock search provider so the whole flow
// (research -> write -> verify -> images -> duplicates -> sync) runs without
// API keys. They are TEST FIXTURES, not verified product claims.
// The soju set deliberately includes a page about the ORIGINAL flavour (16.5%)
// to prove the pipeline does not mix variants.

export type MockPage = {
  url: string;
  title: string;
  text: string;
  images: string[];
  keywords: string[];
};

const img = (name: string, n: number, variant = "") =>
  `https://mock.studio.local/img/${name}-${n}.png${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`;

export const MOCK_PAGES: MockPage[] = [
  // --- Soju Chum-Churum Morango ------------------------------------------------
  {
    url: "https://www.mercadolivre.com.br/soju-chum-churum-lotte-morango-360ml/p/MLB000001",
    title: "Soju Chum Churum Lotte Sabor Morango 360ml - Mercado Livre",
    text: `Soju Chum Churum Lotte Sabor Morango 360ml
Marca: Lotte
Linha: Chum-Churum
Sabor: Morango
Conteúdo: 360ml
Graduação Alcoólica: 12% Vol.
Origem: Coreia do Sul
Código de Barras: 8801030000396
Composição: Água, álcool etílico, xarope de frutose, acidulante ácido cítrico, aroma de morango, suco de morango.
Bebida alcoólica destilada saborizada, servir gelada.`,
    images: [img("soju-morango", 1, "morango"), img("soju-morango", 2, "morango")],
    keywords: ["soju", "chum", "churum", "morango", "lotte", "strawberry"],
  },
  {
    url: "https://www.hachi8.com.br/bebidas/soju-chum-churum-lotte-morango-360ml",
    title: "Soju Importado Chum Churum Lotte Sabor Morango 360ml | Hachi8",
    text: `Soju Importado Chum Churum Lotte Sabor Morango 360ml.
Código de Barras: 8801030000396
Graduação Alcoólica: 12% Vol.
Volume: 360ml
Composição: Água, álcool etílico, xarope de frutose, acidulante ácido cítrico, aroma de morango, suco de morango.
Fabricante: Lotte Chilsung Beverage Co., Ltd.
País de origem: Coreia do Sul
Conservação: manter em local fresco e ao abrigo da luz. Servir gelado.`,
    images: [img("soju-morango", 3, "morango")],
    keywords: ["soju", "chum", "churum", "morango", "lotte", "8801030000396"],
  },
  {
    url: "https://www.orientalmarket.pt/soju-chum-churum-original-360ml",
    title: "Soju Chum Churum Original 360ml",
    text: `Soju Chum Churum Original 360ml. Teor alcoólico: 16,5% vol. Ingredientes: água, álcool etílico, frutose, esteviosídeo. Produto da Coreia do Sul.`,
    images: [img("soju-original", 1, "original")],
    keywords: ["soju", "chum", "churum", "original", "lotte"],
  },
  {
    url: "https://www.lottechilsung.co.kr/en/product/chumchurum-strawberry",
    title: "Chum-Churum Strawberry | Lotte Chilsung",
    text: `Chum-Churum Strawberry Soju 360ml. Alcohol 12%. A fruit soju made with strawberry juice. Manufacturer: Lotte Chilsung Beverage. Made in Korea.`,
    images: [img("soju-morango", 4, "strawberry")],
    keywords: ["chum", "churum", "strawberry", "soju", "lotte"],
  },

  // --- Salgadinho O'Star Queijo Duplo -------------------------------------------
  {
    url: "https://www.amazon.com/Orion-OStar-Potato-Chips-Double-Cheese/dp/B000000001",
    title: "Orion O'Star Potato Chips Double Cheese 30g",
    text: `Orion O'Star Potato Chips Double Cheese flavor, 30g bag. Made in Korea.
Ingredients: potato, vegetable oil (palm oil), double cheese seasoning (cheese powder, whey powder, sugar, salt), maltodextrin.
Allergens: contains milk, wheat and soybean.
Nutrition Facts per 30g: Calories 160kcal, Total Fat 10g, Saturated Fat 3g, Trans Fat 0g, Sodium 150mg, Total Carbohydrate 16g, Sugars 1g, Protein 2g.`,
    images: [img("ostar-queijo", 1, "queijo")],
    keywords: ["star", "ostar", "orion", "queijo", "cheese", "salgadinho", "batata", "chips"],
  },
  {
    url: "https://www.konbini.com.br/salgadinho-orion-o-star-queijo-duplo-30g",
    title: "Salgadinho Orion O'Star Sabor Queijo Duplo 30g",
    text: `Salgadinho de batata Orion O'Star sabor Queijo Duplo, pacote de 30g. Importado da Coreia do Sul.
Ingredientes: batata, óleo vegetal de palma, tempero sabor queijo duplo (queijo em pó, soro de leite em pó, açúcar, sal), maltodextrina.
ALÉRGICOS: CONTÉM LEITE, TRIGO E SOJA. CONTÉM GLÚTEN. CONTÉM LACTOSE.
Informação nutricional - Porção de 30g: Valor energético 160 kcal 8%; Carboidratos 16g 5%; Açúcares totais 1g; Proteínas 2g 4%; Gorduras totais 10g 15%; Gorduras saturadas 3g 15%; Gorduras trans 0g; Sódio 150mg 8%.`,
    images: [img("ostar-queijo", 2, "queijo"), img("ostar-queijo", 3, "queijo")],
    keywords: ["star", "ostar", "orion", "queijo", "duplo", "salgadinho", "batata"],
  },

  // --- Lamen Samyang Buldak Carbonara (not in the store: exercises "new product") --
  {
    url: "https://www.amazon.com.br/Lamen-Samyang-Buldak-Carbonara-130g/dp/B000000002",
    title: "Lamen Coreano Samyang Buldak Carbonara 130g",
    text: `Lamen Coreano Samyang Buldak Sabor Carbonara 130g
Marca: Samyang
Linha: Buldak
Sabor: Carbonara
Conteúdo: 130g
Origem: Coreia do Sul
Código de Barras: 8801073113428
Ingredientes: macarrão (farinha de trigo, amido de batata, óleo de palma, sal), molho carbonara picante (açúcar, molho de pimenta, leite em pó, queijo em pó, alho), flocos de salsa.
ALÉRGICOS: CONTÉM TRIGO, LEITE E SOJA. PODE CONTER OVO. CONTÉM GLÚTEN. CONTÉM LACTOSE.
Informação nutricional - Porção de 130g: Valor energético 550 kcal 28%; Carboidratos 80g 27%; Açúcares totais 9g; Proteínas 11g 22%; Gorduras totais 20g 31%; Gorduras saturadas 10g 50%; Gorduras trans 0g; Sódio 1280mg 64%.
Modo de preparo: ferva 600ml de água, cozinhe o macarrão por 5 minutos, escorra deixando 8 colheres de água e misture o molho.
Conservação: manter em local seco e fresco.`,
    images: [img("buldak-carbonara", 1, "carbonara"), img("buldak-carbonara", 2, "carbonara")],
    keywords: ["lamen", "samyang", "buldak", "carbonara", "ramyeon", "noodles"],
  },

  // --- Pelúcia Capivara ----------------------------------------------------------
  {
    url: "https://shopee.com.br/pelucia-capivara-gotinha-45cm-i.000.001",
    title: "Pelúcia Capivara Gotinha 45cm Antialérgica",
    text: `Pelúcia Capivara Gotinha 45cm.
Material: tecido 100% poliéster, enchimento de fibra siliconada.
Tamanho: 45cm de altura.
Idade recomendada: a partir de 3 anos.
Lavagem: lavar à mão com sabão neutro, secar à sombra.
Certificado INMETRO.`,
    images: [img("capivara", 1, "capivara"), img("capivara", 2, "capivara")],
    keywords: ["pelucia", "capivara", "gotinha"],
  },
];
