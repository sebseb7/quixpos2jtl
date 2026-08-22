/**
 * Health-check route.
 * GET /api/health — tests the MSSQL connection by querying GETDATE().
 */
const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/api/health', async (_req, res) => {
  try {
    const serverTime = await db.healthCheck();
    res.json({
      status: 'ok',
      database: 'connected',
      serverTime: serverTime,
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: err.message,
    });
  }
});

module.exports = router;
