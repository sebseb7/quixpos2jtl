const sql = require('mssql');
const { getPool } = require('../../db');
const { getCustomerGroupIds } = require('./customer-groups');
const { getProductAttributes } = require('./product-attributes');
const {
  getActiveShopId,
  getActiveLanguageId,
  getActiveWarehouseId,
  getActiveTaxZoneId,
} = require('../shop');

const PRODUCT_LIST_SQL = `
WITH TaxRates AS (
  SELECT kSteuerklasse, fSteuersatz
  FROM dbo.tSteuersatz
  WHERE kSteuerzone = @taxZoneId
)
SELECT TOP (@limit)
  a.kArtikel AS id,
  a.cArtNr AS sku,
  ab.cName AS name,
  a.fVKNetto AS netPrice,
  tr.fSteuersatz AS taxRate,
  a.dErstelldatum AS createdAt,
  rv.lastChanged,
  (
    SELECT TOP 1 img.cHash
    FROM dbo.tArtikelbildPlattform abp
    INNER JOIN dbo.tBild img ON img.kBild = abp.kBild
    WHERE abp.kArtikel = a.kArtikel
    ORDER BY abp.nNr
  ) AS imgHash,
  (
    SELECT STRING_AGG(CAST(ka.kKategorie AS varchar(20)), ',')
    FROM dbo.tkategorieartikel ka
    WHERE ka.kArtikel = a.kArtikel
  ) AS categoryIds,
  (
    SELECT COUNT(*)
    FROM dbo.tKategorieArtikel ka2
    INNER JOIN dbo.tArtikel a2 ON a2.kArtikel = ka2.kArtikel AND a2.cAktiv = 'Y'
    INNER JOIN dbo.tArtikelBeschreibung ab2 ON ab2.kArtikel = a2.kArtikel AND ab2.kSprache = @languageId
    WHERE ka2.kKategorie = (
      SELECT TOP 1 ka1.kKategorie
      FROM dbo.tKategorieArtikel ka1
      WHERE ka1.kArtikel = a.kArtikel
    )
    AND (
      ab2.cName < ab.cName
      OR (ab2.cName = ab.cName AND a2.kArtikel < a.kArtikel)
    )
  ) AS sort,
  a.nIstVater AS isParent,
  a.kVaterArtikel AS parentArticleId,
  CASE WHEN a.kStueckliste <> 0 THEN '1' ELSE '0' END AS isCompositeProduct,
  (
    SELECT TOP 1 pv.cVariantName
    FROM Pos.vProductVariant pv
    WHERE pv.kProduct = a.kArtikel
  ) AS variantName,
  a.cBarcode AS barcode,
  a.cLagerAktiv,
  ISNULL(v.fBestand, 0) AS fBestand
FROM dbo.tArtikel a
INNER JOIN dbo.tArtikelBeschreibung ab ON ab.kArtikel = a.kArtikel AND ab.kSprache = @languageId
LEFT JOIN dbo.tlagerbestand lb ON lb.kArtikel = a.kArtikel
LEFT JOIN TaxRates tr ON tr.kSteuerklasse = a.kSteuerklasse
LEFT JOIN dbo.vLagerbestandProLager v ON v.kArtikel = a.kArtikel AND v.kWarenlager = @warenlagerId
CROSS APPLY (
  SELECT MAX(val) AS lastChanged
  FROM (VALUES
    (CONVERT(BIGINT, a.bRowversion)),
    (CONVERT(BIGINT, lb.bRowversion)),
    (CONVERT(BIGINT, ab.bRowversion)),
    ((SELECT MAX(CONVERT(BIGINT, abp.bRowversion)) FROM dbo.tArtikelbildPlattform abp WHERE abp.kArtikel = a.kArtikel AND (@kShop = 0 OR abp.kShop = @kShop))),
    ((SELECT MAX(CONVERT(BIGINT, p.bRowversion)) FROM dbo.tPreis p WHERE p.kArtikel = a.kArtikel AND (@kShop = 0 OR p.kShop = @kShop))),
    ((SELECT MAX(CONVERT(BIGINT, sp.bRowversion)) FROM dbo.tArtikelSonderpreis sp WHERE sp.kArtikel = a.kArtikel))
  ) AS t(val)
) rv
WHERE a.cAktiv = 'Y'
  AND (@kShop = 0 OR EXISTS (
    SELECT 1 FROM dbo.tKategorieArtikel ka
    INNER JOIN dbo.tKategorieShop ks ON ks.kKategorie = ka.kKategorie AND ks.kShop = @kShop
    WHERE ka.kArtikel = a.kArtikel
  ))
  AND rv.lastChanged > @cursor
ORDER BY rv.lastChanged ASC;
`;

function priceOverridesSql(articleIds) {
  const idList = articleIds.join(',');
  return `
    SELECT p.kArtikel AS articleId, p.kKundenGruppe AS customerGroupId, MIN(pd.fNettoPreis) AS netPrice
    FROM dbo.tPreis p
    INNER JOIN dbo.tPreisDetail pd ON pd.kPreis = p.kPreis
    WHERE p.kArtikel IN (${idList}) AND p.kShop = 0 AND pd.nAnzahlAb = 0
    GROUP BY p.kArtikel, p.kKundenGruppe;
  `;
}

function imageHashesSql(articleIds) {
  const idList = articleIds.join(',');
  return `
    SELECT articleId, imgHash
    FROM (
      SELECT
        abp.kArtikel AS articleId,
        img.cHash AS imgHash,
        ROW_NUMBER() OVER (PARTITION BY abp.kArtikel ORDER BY abp.nNr) AS rn
      FROM dbo.tArtikelbildPlattform abp
      INNER JOIN dbo.tBild img ON img.kBild = abp.kBild
      WHERE abp.kArtikel IN (${idList})
    ) t
    WHERE rn = 1 AND imgHash IS NOT NULL AND imgHash <> '';
  `;
}

function formatDateTime(date) {
  if (!date) {
    return '0001-01-01 00:00:00';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function grossPrice(netPrice, taxRate) {
  return (Number(netPrice) * (1 + Number(taxRate || 0) / 100)).toFixed(2);
}

async function getProductList({ cursor = 0, limit = 20 } = {}) {
  const languageId = getActiveLanguageId();
  const taxZoneId = getActiveTaxZoneId();
  const warenlagerId = getActiveWarehouseId();
  const kShop = getActiveShopId();

  const pool = getPool();

  const [productResult, customerGroupIds] = await Promise.all([
    pool
      .request()
      .input('cursor', sql.BigInt, cursor)
      .input('limit', sql.Int, limit)
      .input('languageId', sql.Int, languageId)
      .input('taxZoneId', sql.Int, taxZoneId)
      .input('warenlagerId', sql.Int, warenlagerId)
      .input('kShop', sql.Int, kShop)
      .query(PRODUCT_LIST_SQL),
    getCustomerGroupIds(),
  ]);

  const products = productResult.recordset;
  const articleIds = products.map((p) => p.id);

  const overridesByArticle = new Map();
  let attributesByArticle = new Map();
  let parentImageHashes = new Map();
  if (articleIds.length > 0) {
    const parentIds = products
      .map((p) => (p.parentArticleId > 0 && !p.imgHash ? Number(p.parentArticleId) : null))
      .filter((id) => id !== null && !articleIds.includes(id));
    const hashIds = [...new Set([...articleIds, ...parentIds])];

    const [overrideResult, attributeMap, imageHashResult] = await Promise.all([
      pool.request().query(priceOverridesSql(articleIds)),
      getProductAttributes(pool, articleIds),
      pool.request().query(imageHashesSql(hashIds)),
    ]);
    attributesByArticle = attributeMap;
    for (const row of overrideResult.recordset) {
      if (!overridesByArticle.has(row.articleId)) {
        overridesByArticle.set(row.articleId, new Map());
      }
      overridesByArticle.get(row.articleId).set(row.customerGroupId, row.netPrice);
    }
    for (const row of imageHashResult.recordset) {
      parentImageHashes.set(row.articleId, row.imgHash);
    }
  }

  return products.map((product) => {
    const overrides = overridesByArticle.get(product.id);
    const basePrice = grossPrice(product.netPrice, product.taxRate);

    const prices = customerGroupIds.map((customerGroupId) => {
      const overrideNetPrice = overrides?.get(customerGroupId);
      const price =
        overrideNetPrice !== undefined ? grossPrice(overrideNetPrice, product.taxRate) : basePrice;
      return {
        customerGroupId: String(customerGroupId),
        customerId: '0',
        price,
        quantity: '0',
      };
    });

    const categoryIds = product.categoryIds ? product.categoryIds.split(',') : [];
    const articleAttributes = attributesByArticle.get(product.id);

    const hasOwnImage = !!product.imgHash;
    const parentHash = !hasOwnImage ? parentImageHashes.get(product.parentArticleId) : null;
    const imageHash = hasOwnImage ? product.imgHash : parentHash;

    return {
      _id: String(product.id),
      imghash: imageHash ?? null,
      imgsrc: imageHash ?? null,
      sku: product.sku,
      barcode: product.barcode ?? null,
      name: product.name,
      tax_rate: String(Math.round(Number(product.taxRate || 0))),
      price: basePrice,
      created_at: formatDateTime(product.createdAt),
      lastChanged: String(product.lastChanged),
      sort: String(product.sort ?? 0),
      categories_id: categoryIds[0] ?? '0',
      categories: categoryIds.map((categoryId) => ({ categoryId })),
      prices,
      is_parent: product.isParent ? '1' : '0',
      parent: product.parentArticleId > 0 ? String(product.parentArticleId) : '0',
      variants: product.variantName ?? '',
      isCompositeProduct: product.isCompositeProduct,
      attributes: articleAttributes?.attributes ?? [],
      use_stock: product.cLagerAktiv === 'Y' || product.cLagerAktiv === '1' ? '1' : '0',
      quantity: String(product.fBestand ?? 0),
      ...(articleAttributes?.deposit ?? {}),
    };
  });
}

module.exports = { getProductList };
