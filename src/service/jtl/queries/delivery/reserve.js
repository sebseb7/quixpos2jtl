const sql = require('mssql');
const { xmlTag, xmlElement } = require('./xml');
const { logger } = require('../../../logger');

const RESERVIERE_OPTIONS = 0x102;

async function reservePositions(transaction, kBenutzer, kSessionId, kWarenLager, positions) {
  if (!positions.length) {
    return;
  }

  const bestellpositionen = positions
    .map(({ kAuftragPosition, quantity }) =>
      xmlElement('Bestellposition', [xmlTag('kBestellPos', kAuftragPosition), xmlTag('fAnzahl', quantity)])
    )
    .join('');

  const laeger = xmlElement('Lager', [
    xmlTag('kWarenlager', kWarenLager),
    xmlTag('nPrio', 0),
    xmlTag('kLieferant', 0),
    xmlTag('kAnsprechpartner', 0),
  ]);

  logger.info(`reserve: kSessionId=${kSessionId} kWarenLager=${kWarenLager} nOptions=0x${RESERVIERE_OPTIONS.toString(16)} positions=${JSON.stringify(positions)}`);

  await new sql.Request(transaction)
    .input('Bestellpositionen', sql.NVarChar(sql.MAX), bestellpositionen)
    .input('Laeger', sql.NVarChar(sql.MAX), laeger)
    .input('nOptions', sql.Int, RESERVIERE_OPTIONS)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('kSessionId', sql.Int, kSessionId)
    .query(`
      DECLARE @xBestellpositionen XML = CONVERT(XML, @Bestellpositionen);
      DECLARE @xLaeger XML = CONVERT(XML, @Laeger);
      EXEC Auslieferung.spReserviereBestellpositionen
        @Bestellpositionen  = @xBestellpositionen,
        @Laeger              = @xLaeger,
        @Warenlagereingaenge = NULL,
        @nOptions             = @nOptions,
        @kBenutzer            = @kBenutzer,
        @kSessionId           = @kSessionId;
    `);

  logger.info(`reserve: done kSessionId=${kSessionId} positions=${JSON.stringify(positions)}`);
}

module.exports = { reservePositions };
