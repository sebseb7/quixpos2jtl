const sql = require('mssql');
const { xmlTag, xmlElement } = require('./xml');
const { logger } = require('../../../logger');

async function commitPicklists(transaction, kBenutzer, kSessionId, kAuftrag) {
  const bestellungen = xmlElement('Bestellung', [xmlTag('kBestellung', kAuftrag)]);

  logger.info(`commit: kSessionId=${kSessionId} kAuftrag=${kAuftrag} nTeillieferung=false bestellungen=${bestellungen}`);

  await new sql.Request(transaction)
    .input('Bestellungen', sql.NVarChar(sql.MAX), bestellungen)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('nTeillieferung', sql.Bit, false)
    .input('kSessionId', sql.Int, kSessionId)
    .query(`
      DECLARE @xBestellungen XML = CONVERT(XML, @Bestellungen);
      DECLARE @xResult XML;
      EXEC Auslieferung.spPicklistenUebernehmen
        @Bestellungen   = @xBestellungen,
        @kBenutzer      = @kBenutzer,
        @nTeillieferung = @nTeillieferung,
        @kSessionId     = @kSessionId,
        @xResult        = @xResult OUTPUT;
    `);

  logger.info(`commit: done kSessionId=${kSessionId} kAuftrag=${kAuftrag}`);
}

module.exports = { commitPicklists };
