const sql = require('mssql');
const { reservePositions } = require('./reserve');
const { logger } = require('../../../logger');

const POS_SHORTAGE_COMMENT = 'Korrekturbuchung erstellt durch POS-Abgleich';
const BUCHUNGSART_WARENEINGANG = 10;

async function getReservedQuantity(transaction, kSessionId, kAuftragPosition) {
  const result = await new sql.Request(transaction)
    .input('kSessionId', sql.Int, kSessionId)
    .input('kBestellPos', sql.Int, kAuftragPosition)
    .query(`
      SELECT ISNULL(SUM(pp.fAnzahl), 0) AS reserved
      FROM dbo.tPicklistePos pp
      INNER JOIN dbo.tPickliste p ON p.kPickliste = pp.kPickliste
      WHERE p.kSessionId = @kSessionId
        AND pp.kBestellPos = @kBestellPos
    `);
  const reserved = Number(result.recordset[0]?.reserved ?? 0);
  logger.info(`stockShortage: getReservedQuantity kSessionId=${kSessionId} kBestellPos=${kAuftragPosition} reserved=${reserved}`);
  return reserved;
}

async function getPositionArtikel(transaction, kAuftragPosition) {
  const result = await new sql.Request(transaction)
    .input('kAuftragPosition', sql.Int, kAuftragPosition)
    .query(`
      SELECT ap.kArtikel, ap.nType, ap.nReserviert, a.cLagerAktiv, a.cLagerArtikel, a.cArtNr
      FROM Verkauf.tAuftragPosition ap
      LEFT JOIN dbo.tArtikel a ON a.kArtikel = ap.kArtikel
      WHERE ap.kAuftragPosition = @kAuftragPosition
    `);
  const row = result.recordset[0];
  logger.info(`stockShortage: getPositionArtikel kBestellPos=${kAuftragPosition} row=${JSON.stringify(row)}`);
  return row?.kArtikel ?? 0;
}

async function bookWareneingang(
  transaction,
  kBenutzer,
  kWarenLagerPlatz,
  kArtikel,
  fehlmenge,
  comment = POS_SHORTAGE_COMMENT,
  buchungsart = BUCHUNGSART_WARENEINGANG,
) {
  await new sql.Request(transaction)
    .input('kArtikel', sql.Int, kArtikel)
    .input('kWarenLagerPlatz', sql.Int, kWarenLagerPlatz)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('fAnzahl', sql.Float, fehlmenge)
    .input('cKommentar', sql.NVarChar, comment)
    .input('kBuchungsart', sql.Int, buchungsart)
    .query(`
      DECLARE @kWarenlagerEingang INT;
      EXEC dbo.spWarenlagerEingangSchreiben
        @kArtikel = @kArtikel,
        @kWarenLagerPlatz = @kWarenLagerPlatz,
        @kLieferantenBestellungPos = 0,
        @kBenutzer = @kBenutzer,
        @fAnzahl = @fAnzahl,
        @fEkEinzel = 0,
        @cLieferscheinNr = '',
        @cChargenNr = NULL,
        @dMHD = NULL,
        @dGeliefertAm = NULL,
        @cKommentar = @cKommentar,
        @kGutschriftPos = 0,
        @kLHM = 0,
        @kSessionId = 0,
        @kBuchungsart = @kBuchungsart,
        @kBestellPosUmlagerung = 0,
        @kRMRetourePos = 0,
        @nHistorieNichtSchreiben = 0,
        @kWarenlagerEingang = @kWarenlagerEingang OUTPUT;
      SELECT @kWarenlagerEingang AS kWarenlagerEingang;
    `);
}

async function bookReturnPositions(
  transaction,
  kBenutzer,
  kWarenLagerPlatz,
  returnPositions,
) {
  logger.info(`returnBooking: processing ${returnPositions.length} return position(s) at kWarenLagerPlatz=${kWarenLagerPlatz}`);
  for (const { kAuftragPosition, quantity } of returnPositions) {
    if (!kAuftragPosition || quantity >= 0) {
      continue;
    }
    const returnQty = Math.abs(quantity);
    const kArtikel = await getPositionArtikel(transaction, kAuftragPosition);
    logger.info(`returnBooking: kBestellPos=${kAuftragPosition} kArtikel=${kArtikel} returnQty=${returnQty}`);
    if (!kArtikel) {
      logger.info(`returnBooking: kBestellPos=${kAuftragPosition} no kArtikel (free position / Pfand?), skip return booking`);
      continue;
    }
    await bookWareneingang(
      transaction,
      kBenutzer,
      kWarenLagerPlatz,
      kArtikel,
      returnQty,
      'Korrekturbuchung erstellt durch POS-Abgleich (Retoure)',
      BUCHUNGSART_WARENEINGANG,
    );
    logger.info(`returnBooking: successfully booked return of ${returnQty}x kArtikel=${kArtikel} into kWarenLagerPlatz=${kWarenLagerPlatz}`);
  }
}

async function bookStockShortfallsAndRereserve(
  transaction,
  kBenutzer,
  kSessionId,
  kWarenLager,
  kWarenLagerPlatz,
  positions,
) {
  logger.info(`stockShortage: bookStockShortfallsAndRereserve kBenutzer=${kBenutzer} kSessionId=${kSessionId} kWarenLager=${kWarenLager} kWarenLagerPlatz=${kWarenLagerPlatz} positions=${JSON.stringify(positions)}`);

  const rereserve = [];

  for (const { kAuftragPosition, quantity } of positions) {
    if (!kAuftragPosition || quantity <= 0) {
      logger.info(`stockShortage: skip position kBestellPos=${kAuftragPosition} (no kAuftragPosition or qty<=0)`);
      continue;
    }

    const reserved = await getReservedQuantity(transaction, kSessionId, kAuftragPosition);
    const shortage = quantity - reserved;
    logger.info(`stockShortage: kBestellPos=${kAuftragPosition} quantity=${quantity} reserved=${reserved} shortage=${shortage}`);
    if (shortage <= 0.0001) {
      logger.info(`stockShortage: kBestellPos=${kAuftragPosition} no shortage, skip`);
      continue;
    }

    const kArtikel = await getPositionArtikel(transaction, kAuftragPosition);
    logger.info(`stockShortage: kBestellPos=${kAuftragPosition} kArtikel=${kArtikel}`);
    if (!kArtikel) {
      logger.info(`stockShortage: kBestellPos=${kAuftragPosition} no kArtikel (free position / Pfand?), skip shortage booking`);
      continue;
    }

    await bookWareneingang(transaction, kBenutzer, kWarenLagerPlatz, kArtikel, shortage);
    logger.info(`stockShortage: booked Wareneingang kArtikel=${kArtikel} kWarenLagerPlatz=${kWarenLagerPlatz} fehlmenge=${shortage}`);
    rereserve.push({ kAuftragPosition, quantity: shortage });
  }

  if (rereserve.length) {
    logger.info(`stockShortage: re-reserving ${JSON.stringify(rereserve)}`);
    await reservePositions(transaction, kBenutzer, kSessionId, kWarenLager, rereserve);
  } else {
    logger.info('stockShortage: no re-reserve needed');
  }

  for (const { kAuftragPosition, quantity } of positions) {
    if (!kAuftragPosition || quantity <= 0) {
      continue;
    }
    const reserved = await getReservedQuantity(transaction, kSessionId, kAuftragPosition);
    logger.info(`stockShortage: final check kBestellPos=${kAuftragPosition} need=${quantity} reserved=${reserved}`);
    if (reserved + 0.0001 < quantity) {
      logger.error(`stockShortage: FAIL kBestellPos=${kAuftragPosition} need=${quantity} reserved=${reserved}`);
      throw new Error(`insufficient stock after POS shortage booking for kBestellPos=${kAuftragPosition}`);
    }
  }

  logger.info('stockShortage: all positions fully reserved after shortage booking');
}

module.exports = {
  bookStockShortfallsAndRereserve,
  bookReturnPositions,
  bookWareneingang,
  getPositionArtikel,
};
