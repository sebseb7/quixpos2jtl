const { openSession, discardSession, closeSession } = require('./session');
const { getOutgoingWarehouse, getWarehousePlace } = require('./warehouse');
const { reservePositions } = require('./reserve');
const { bookStockShortfallsAndRereserve, bookReturnPositions } = require('./stock-shortage');
const { commitPicklists } = require('./commit');
const { deliverPicklists } = require('./deliver');
const { logger } = require('../../../logger');

async function deliverOrder(transaction, kBenutzer, kAuftrag, kVersandArt, deliveredItems) {
  if (!deliveredItems.length) {
    return;
  }

  logger.info(`deliverOrder: kAuftrag=${kAuftrag} kBenutzer=${kBenutzer} kVersandArt=${kVersandArt} deliveredItems=${JSON.stringify(deliveredItems)}`);

  const kWarenLager = await getOutgoingWarehouse(transaction);
  const kWarenLagerPlatz = await getWarehousePlace(transaction, kWarenLager);
  logger.info(`deliverOrder: kWarenLager=${kWarenLager} kWarenLagerPlatz=${kWarenLagerPlatz}`);

  const positiveItems = deliveredItems.filter((i) => i.quantity > 0);
  const returnItems = deliveredItems.filter((i) => i.quantity < 0);

  // 1. Process returned items: book them back into warehouse stock via Wareneingang
  if (returnItems.length) {
    await bookReturnPositions(transaction, kBenutzer, kWarenLagerPlatz, returnItems);
  }

  // 2. Process positive items: standard JTL picklist/delivery fulfillment
  if (positiveItems.length) {
    const kSessionId = await openSession(transaction, kBenutzer);

    try {
      await reservePositions(transaction, kBenutzer, kSessionId, kWarenLager, positiveItems);
      await bookStockShortfallsAndRereserve(
        transaction,
        kBenutzer,
        kSessionId,
        kWarenLager,
        kWarenLagerPlatz,
        positiveItems,
      );
      await commitPicklists(transaction, kBenutzer, kSessionId, kAuftrag);
      await deliverPicklists(transaction, kBenutzer, kSessionId, kAuftrag, kVersandArt);
      logger.info(`deliverOrder: delivered kAuftrag=${kAuftrag} kSessionId=${kSessionId}`);
    } catch (err) {
      logger.error(`deliverOrder: FAILED kAuftrag=${kAuftrag} kSessionId=${kSessionId}: ${err.message}`);
      throw err;
    } finally {
      try {
        await discardSession(transaction, kBenutzer, kSessionId);
        await closeSession(transaction, kSessionId);
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

module.exports = { deliverOrder };
