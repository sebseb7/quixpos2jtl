const sql = require('mssql');
const { logger } = require('../../../logger');

async function openSession(transaction, kBenutzer, hostname = 'jtlsrv') {
  const result = await new sql.Request(transaction)
    .input('cRechnername', sql.NVarChar(255), hostname)
    .input('kBenutzer', sql.Int, kBenutzer)
    .query(`
      DECLARE @t TABLE ([kSessionId] INT);
      INSERT INTO dbo.tSessionId (cRechnername, kBenutzer, dLastAction)
      OUTPUT inserted.kSessionId INTO @t
      VALUES (@cRechnername, @kBenutzer, DATEADD(day, 10, GETDATE()));
      SELECT kSessionId FROM @t;
    `);
  const kSessionId = result.recordset[0].kSessionId;
  logger.info(`session: opened kSessionId=${kSessionId} kBenutzer=${kBenutzer}`);
  return kSessionId;
}

async function discardSession(transaction, kBenutzer, kSessionId) {
  logger.info(`session: discard kSessionId=${kSessionId} kBenutzer=${kBenutzer}`);
  await new sql.Request(transaction)
    .input('kBenutzer', sql.Int, kBenutzer)
    .input('kSessionId', sql.Int, kSessionId)
    .execute('Auslieferung.spPicklistenVerwerfen');
}

async function closeSession(transaction, kSessionId) {
  logger.info(`session: close kSessionId=${kSessionId}`);
  await new sql.Request(transaction)
    .input('kSessionId', sql.Int, kSessionId)
    .query('DELETE FROM dbo.tSessionId WHERE kSessionId = @kSessionId');
}

module.exports = {
  openSession,
  discardSession,
  closeSession,
};
