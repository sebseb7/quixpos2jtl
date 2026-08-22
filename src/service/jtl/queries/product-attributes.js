const PFAND_ATTR_IDS = [
  'Pfandartikel',
  'Pfandart (Bezeichnung auf Ausdruck)',
  'Pfandbetrag',
];

let pfandMetaCache = null;
let activeShopsCache = null;

async function getPfandMetadata(pool) {
  if (!pfandMetaCache) {
    const result = await pool.request().query(`
      SELECT
        a.kAttribut,
        a.cAttributId,
        a.nSortierung,
        a.kFeldTyp,
        a.cGruppeName,
        s.cName
      FROM dbo.tAttribut a
      INNER JOIN dbo.tAttributSprache s ON s.kAttribut = a.kAttribut AND s.kSprache = 0
      WHERE a.cGruppeName = 'JTL-POS'
        AND a.cAttributId IN ('Pfandartikel', 'Pfandart (Bezeichnung auf Ausdruck)', 'Pfandbetrag')
    `);
    pfandMetaCache = result.recordset;
  }
  return pfandMetaCache;
}

async function getActiveShops(pool) {
  if (!activeShopsCache) {
    const result = await pool.request().query(`
      WITH ActiveShops AS (
        SELECT ss.kShop, s.kKategorie AS rootKategorie
        FROM dbo.tShopSubshop ss
        INNER JOIN dbo.tShop s ON s.kShop = ss.kShop
        WHERE ss.nGesperrt = 0
      )
      SELECT DISTINCT ash.kShop FROM ActiveShops ash
    `);
    activeShopsCache = result.recordset.map((row) => row.kShop);
  }
  return activeShopsCache;
}

function attributesSql(articleIds, activeShops, pfandKAttribute) {
  const shopList = activeShops.length ? activeShops.join(',') : 'NULL';
  const pfandList = pfandKAttribute.length ? pfandKAttribute.join(',') : 'NULL';

  return `
    SELECT
      aa.kArtikel AS articleId,
      aa.kAttribut,
      aa.kShop,
      at.nSortierung,
      at.kFeldTyp,
      at.cGruppeName,
      at.cAttributId,
      ats.cName,
      aas.cWertVarchar,
      aas.nWertInt,
      aas.fWertDecimal
    FROM dbo.tArtikelAttribut aa
    INNER JOIN dbo.tArtikelAttributSprache aas
      ON aas.kArtikelAttribut = aa.kArtikelAttribut AND aas.kSprache = 0
    INNER JOIN dbo.tAttribut at ON at.kAttribut = aa.kAttribut
    INNER JOIN dbo.tAttributSprache ats ON ats.kAttribut = at.kAttribut AND ats.kSprache = 0
    WHERE aa.kArtikel IN (${articleIds.join(',')})
      AND (
        aa.kShop = 0
        OR (
          aa.kShop IN (${shopList})
          AND aa.kAttribut IN (${pfandList})
        )
      )
    ORDER BY aa.kArtikel, at.nSortierung, aa.kShop;
  `;
}

function mergeArticleAttributes(rows) {
  const byAttribute = new Map();
  for (const row of rows) {
    byAttribute.set(row.kAttribut, row);
  }
  return [...byAttribute.values()].sort((a, b) => a.nSortierung - b.nSortierung);
}

function toPosAttribute(row) {
  return {
    aname: row.cName,
    aprice: '0.0',
    asort: String(row.nSortierung),
    atype: String(row.kFeldTyp),
    agroup: row.cGruppeName ?? '',
  };
}

function deriveDepositFields(rows) {
  const byId = new Map(rows.map((row) => [row.cAttributId, row]));
  const pfandArtikel = byId.get('Pfandartikel');
  const pfandArt = byId.get('Pfandart (Bezeichnung auf Ausdruck)');
  const pfandBetrag = byId.get('Pfandbetrag');

  if (!pfandArtikel && !pfandArt && !pfandBetrag) {
    return null;
  }

  return {
    deposit: pfandArtikel?.nWertInt === 1 ? '1' : '0',
    deposit_name: pfandArt?.cWertVarchar ?? '',
    d_price:
      pfandBetrag?.fWertDecimal != null
        ? Number(pfandBetrag.fWertDecimal).toFixed(2)
        : '0.0',
  };
}

async function getProductAttributes(pool, articleIds) {
  if (!articleIds.length) {
    return new Map();
  }

  const [pfandMeta, activeShops] = await Promise.all([
    getPfandMetadata(pool),
    getActiveShops(pool),
  ]);
  const pfandKAttribute = pfandMeta.map((row) => row.kAttribut);

  const result = await pool.request().query(attributesSql(articleIds, activeShops, pfandKAttribute));

  const rowsByArticle = new Map();
  for (const row of result.recordset) {
    if (!rowsByArticle.has(row.articleId)) {
      rowsByArticle.set(row.articleId, []);
    }
    rowsByArticle.get(row.articleId).push(row);
  }

  const attributesByArticle = new Map();
  for (const [articleId, rows] of rowsByArticle) {
    const merged = mergeArticleAttributes(rows);
    attributesByArticle.set(articleId, {
      attributes: merged.map(toPosAttribute),
      deposit: deriveDepositFields(merged),
    });
  }

  return attributesByArticle;
}

module.exports = { getProductAttributes };
