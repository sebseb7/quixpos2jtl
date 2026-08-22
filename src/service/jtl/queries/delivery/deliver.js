const sql = require('mssql');
const { xmlTag, xmlElement } = require('./xml');
const { logger } = require('../../../logger');

const AUSLIEFERN_OPTIONS = 0x002;

async function deliverPicklists(transaction, kBenutzer, kSessionId, kAuftrag, kVersandArt) {
  const pakete = xmlElement('Paket', [
    xmlTag('kBestellung', kAuftrag),
    xmlTag('kVersandart', kVersandArt),
    xmlTag('fGewicht', 0),
  ]);

  logger.info(`deliver: kSessionId=${kSessionId} kAuftrag=${kAuftrag} kVersandArt=${kVersandArt} pakete=${pakete}`);

  const result = await new sql.Request(transaction)
    .input('Pakete', sql.NVarChar(sql.MAX), pakete)
    .input('nOptions', sql.Int, AUSLIEFERN_OPTIONS)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('kSessionId', sql.Int, kSessionId)
    .query(`
      DECLARE @xHinweise XML = NULL;
      DECLARE @xPakete XML = CONVERT(XML, @Pakete);
      DECLARE @xResult XML;
      EXEC Auslieferung.spPicklistenAusliefern
        @xHinweise  = @xHinweise,
        @Pakete     = @xPakete,
        @nOptions   = @nOptions,
        @kBenutzer  = @kBenutzer,
        @kSessionId = @kSessionId,
        @xResult    = @xResult OUTPUT;
      SELECT @xResult AS xResult;
    `);

  const xResult = result.recordset[0]?.xResult ?? null;
  logger.info(`deliver: done kSessionId=${kSessionId} kAuftrag=${kAuftrag} xResult=${String(xResult).slice(0, 2000)}`);
  return xResult;
}

module.exports = { deliverPicklists };
