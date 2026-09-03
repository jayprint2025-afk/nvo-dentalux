'use strict';

async function loadHistory(pool, leadId, limit = 18) {
  const { rows } = await pool.query(
    `SELECT role, content, COALESCE(actor,'ai') AS actor, created_at
       FROM sales_messages
      WHERE lead_id=$1
      ORDER BY id DESC
      LIMIT $2`,
    [leadId, limit]
  );
  return rows.reverse();
}

module.exports = { loadHistory };
