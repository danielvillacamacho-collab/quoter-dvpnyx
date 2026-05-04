const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/http');

router.use(requireAuth);

// Placeholder — aggregate endpoints will be added in Phase 2-5.
router.get('/health', (_req, res) => res.json({ ok: true, module: 'reports_v2' }));

module.exports = router;
