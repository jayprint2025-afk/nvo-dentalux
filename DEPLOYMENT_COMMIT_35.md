# Deployment Instructions - Commit 35

## IMPORTANT: Two-Step Deployment Required!

This update requires BOTH code deployment AND database update.

---

## Step 1: Deploy New Code

### On Render (Automatic):
1. Render will auto-deploy when you push to this branch
2. Or manually trigger deploy from Render dashboard

### On Your Server (Manual):
```bash
cd /path/to/Dentalux-PlanEnterprice
git checkout copilot/fix-agenda-issue-flow
git pull origin copilot/fix-agenda-issue-flow
pm2 restart all
```

---

## Step 2: Update Database (CRITICAL!)

**You MUST run this SQL script or the bank information won't change!**

### If you have access to database directly:
```bash
# Connect to your database
psql $DATABASE_URL < update_bank_info.sql
```

### If using Render database:
1. Go to Render Dashboard
2. Find your PostgreSQL database
3. Click "Connect" → "External Connection"
4. Copy the connection string
5. Run:
```bash
psql "your-connection-string" < update_bank_info.sql
```

### If you have multiple databases (db1, db2, db3):
```bash
psql $DATABASE_URL_DB1 < update_bank_info.sql
psql $DATABASE_URL_DB2 < update_bank_info.sql
psql $DATABASE_URL_DB3 < update_bank_info.sql
```

### Manual SQL (if you can't run the file):
Copy and paste this into your database SQL editor:

```sql
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
```

---

## Step 3: Verify Both Features

### Test 1: Admin Notification
1. Send a test reminder to yourself
2. Click CONFIRMAR button
3. Check WhatsApp number **6867865454**
4. You should receive a notification with appointment details

**Expected message:**
```
🔔 NUEVA CONFIRMACIÓN

📅 Cita #123
👤 Paciente: Test User
📆 11/02/2026 a las 10:00
🏥 Sucursal: Victoria
📱 Teléfono: +5216867865454

✅ Referencia: TEST123

Estado: Confirmada ✓
```

### Test 2: Bank Information
1. Send a test reminder
2. Click CONFIRMAR (without sending REF)
3. Check the message you receive

**Should show NEW bank:**
```
🏦 Banco: SANTANDER
💳 Tarjeta: 5579 1004 6753 4614
👤 Titular: Luis Angel Villavicencio Corona
```

**If you see OLD bank info, the SQL script wasn't run!**

---

## Troubleshooting

### Problem: Bank info still shows old information
**Solution:** Run the SQL script! The bank info is in the database, not in code.

### Problem: Admin notification not arriving
**Check:**
1. Server logs for: `✅ Admin notification sent to: 6867865454`
2. WhatsApp number 6867865454 is correct
3. Server has restarted with new code

### Problem: SQL script fails
**Try:**
1. Check if `clinic_branches` table exists: `\dt clinic_branches`
2. Check if you have permission: `SELECT * FROM clinic_branches LIMIT 1;`
3. Run the UPDATE manually in database SQL editor

---

## Verification Checklist

After deployment, verify:

- [ ] New code deployed (check git log shows commit 158c7d6)
- [ ] SQL script executed successfully
- [ ] Server restarted
- [ ] Test confirmation → admin receives notification
- [ ] Test blocked confirmation → shows SANTANDER bank
- [ ] No errors in server logs

---

## Need Help?

Check server logs for:
- `✅ Admin notification sent to:` - Admin notification working
- `🏦 Banco: SANTANDER` - Bank info updated
- Any errors or warnings

If you see old bank information, **YOU MUST RUN THE SQL SCRIPT!**
