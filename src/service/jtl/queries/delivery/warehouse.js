const sql = require('mssql');
const { loadConfig } = require('../../../../config');

let cachedWarenLager = null;
let cachedWarenLagerPlatz = null;

async function getOutgoingWarehouse(transaction) {
  if (cachedWarenLager != null) {
    return cachedWarenLager;
  }

  const cfg = loadConfig();
  const configured = Number(cfg.shop?.warenlager || process.env.JTL_KWARENLAGER);
  if (Number.isInteger(configured) && configured > 0) {
    cachedWarenLager = configured;
    return cachedWarenLager;
  }

  const result = await new sql.Request(transaction).query(`
    SELECT TOP 1 kWarenLager
    FROM dbo.tWarenLager
    WHERE nFulfillment = 0 AND ISNULL(nAktiv, 1) = 1
    ORDER BY nAuslieferungsPrio, kWarenLager
  `);
  const row = result.recordset[0];
  if (!row) {
    throw new Error('No local warehouse (dbo.tWarenLager.nFulfillment = 0) found; set Warenlager in Shop settings.');
  }
  cachedWarenLager = row.kWarenLager;
  return cachedWarenLager;
}

async function getWarehousePlace(transaction, kWarenLager) {
  if (cachedWarenLagerPlatz != null) {
    return cachedWarenLagerPlatz;
  }

  const configured = Number(process.env.JTL_KWARENLAGERPLATZ);
  if (Number.isInteger(configured) && configured > 0) {
    cachedWarenLagerPlatz = configured;
    return cachedWarenLagerPlatz;
  }

  const result = await new sql.Request(transaction)
    .input('kWarenLager', sql.Int, kWarenLager)
    .query(`
      SELECT TOP 1 kWarenLagerPlatz
      FROM dbo.tWarenLagerPlatz
      WHERE kWarenLager = @kWarenLager
        AND ISNULL(nGesperrt, 0) = 0
      ORDER BY nPrio, kWarenLagerPlatz
    `);
  const row = result.recordset[0];
  if (!row) {
    throw new Error(`No warehouse place found for kWarenLager=${kWarenLager}; set JTL_KWARENLAGERPLATZ explicitly.`);
  }
  cachedWarenLagerPlatz = row.kWarenLagerPlatz;
  return cachedWarenLagerPlatz;
}

module.exports = {
  getOutgoingWarehouse,
  getWarehousePlace,
};
