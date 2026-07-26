-- Update bank information for deposit instructions
-- This script updates the clinic_branches table with new Santander bank details

UPDATE clinic_branches 
SET deposit_instructions = '🏦 Banco: SANTANDER
💳 Tarjeta: 5579 1004 6753 4614
👤 Titular: Luis Angel Villavicencio Corona

💰 Monto del anticipo: $500 MXN

📝 Importante:
• Realiza la transferencia
• Envía tu comprobante con: REF [número de referencia]

Ejemplo: REF 123456'
WHERE branch_key IN ('sucursal_1', 'sucursal_2', 'sucursal_3')
  OR branch_key IS NOT NULL;

-- Verify the update
SELECT branch_key, require_deposit_confirm, deposit_amount, 
       LEFT(deposit_instructions, 100) as instructions_preview
FROM clinic_branches
WHERE branch_key IS NOT NULL
ORDER BY id;
