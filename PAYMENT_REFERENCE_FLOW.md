# Payment Reference Validation Flow

## Overview
This document explains how the payment reference (REF) validation system works to block confirmations/cancellations until payment is verified.

## Flow Diagram

```
1. Patient receives reminder
   ↓
2. Patient tries to click CONFIRMAR
   ↓
3. System checks: Has patient sent "REF xxxx"?
   ├─ NO → Block confirmation, ask for REF
   └─ YES → Allow confirmation, update status
```

## Implementation Details

### 1. REF Detection (Lines 1508-1537)

**Purpose:** Capture payment references BEFORE they reach AI routing

**Pattern:** `/^\s*REF\b/i`

**Matches:**
- "REF 123456"
- "ref 123456"
- "REF: 123456"
- "REF-123456"

**What Happens:**
```javascript
if (text && /^\s*REF\b/i.test(text)) {
  // Check if deposit required for this branch
  if (cfg0.requireDeposit) {
    // Find next pending appointment
    // Send "Thanks! Now confirm your appointment"
    // Show confirmation buttons
    return; // ← Don't pass to AI
  }
}
```

**Key Points:**
- ✅ Runs BEFORE AI routing (line 1509 comment)
- ✅ Stores reference in whatsapp_messages table
- ✅ Shows confirmation buttons after receiving REF
- ✅ Bypasses AI completely for REF messages

### 2. Confirmation Gate (Lines 1550-1569)

**Purpose:** Block CONFIRMAR/CANCELAR if no REF exists

**When:** Right after confirming it's a confirmation command

**Logic:**
```javascript
if (isConfirmCmd) {
  // Get deposit config for this branch
  if (cfgGate.requireDeposit) {
    // Search for REF in last 72 hours
    const foundRef = await findLatestDepositRefFromMessagesMultiDb(from, { hours: 72 });
    
    if (!foundRef.ref) {
      // ❌ NO REF FOUND - BLOCK
      await safeReply(from, "Please send REF first");
      return res.sendStatus(200); // ← Exit without updating status
    }
    // ✅ REF FOUND - Continue to confirmation
  }
}
```

**Search Function:** `findLatestDepositRefFromMessagesMultiDb()`
- Searches whatsapp_messages table
- Looks in ALL databases (db1, db2, db3)
- Filters by phone number and timeframe
- Pattern: `upper(message) LIKE 'REF%'`

### 3. Secondary Validation (Lines 2122-2146)

**Purpose:** Double-check before final UPDATE

**When:** In confirmation handler, right before database update

**Logic:**
```javascript
if (action === 'CONFIRMAR') {
  if (cfg.requireDeposit) {
    const refInfo = await findLatestDepositRefFromMessages(from, { hours: 72 });
    
    if (!refInfo?.ref) {
      // ❌ Still no REF - block
      await safeReply(from, "Need deposit reference first");
      return res.sendStatus(200);
    }
  }
}
```

**Why Two Checks?**
1. First check (line 1550): Early gate, fast exit
2. Second check (line 2122): Safety net before database write

## Configuration

### Enable/Disable Per Branch

**Function:** `getDepositConfig({ branchKey })`

**Returns:**
```javascript
{
  requireDeposit: boolean,        // true = require REF before confirming
  depositInstructions: string,    // Custom message to show
  depositAmount: number          // Amount expected (optional)
}
```

**Environment Variables:**
- Configuration stored per branch in database
- Can be different for each sucursal

## Message Flow Examples

### Case 1: Correct Flow (With REF)

```
1. Bot: "Appointment reminder for tomorrow at 10:00
         Please confirm: [CONFIRMAR] [CANCELAR]"

2. User: Clicks CONFIRMAR
   
3. Bot: "❌ Para confirmar tu cita necesitamos un anticipo.
         Responde con: REF 123456 (tu referencia)"

4. User: "REF 789456"

5. Bot: "✅ ¡Gracias! Recibimos tu referencia.
         Ahora sí, por favor confirma tu cita aquí abajo:
         Cita #35 — 11/02/2026 11:00
         [CONFIRMAR] [CANCELAR]"

6. User: Clicks CONFIRMAR

7. Bot: "✅ ¡Gracias! Confirmamos tu cita #35
         para el 11/02/2026 a las 11:00"
         
8. Database: Status updated to "Confirmada"
```

### Case 2: Without REF (Blocked)

```
1. Bot: "Appointment reminder..."

2. User: Clicks CONFIRMAR

3. Bot: "❌ Para confirmar necesitamos anticipo.
         Responde: REF 123456"
         
4. Database: No change (status stays "Pendiente")
```

### Case 3: REF Sent First

```
1. Bot: "Appointment reminder..."

2. User: "REF 456789"

3. Bot: "✅ ¡Gracias! Recibimos tu referencia.
         Ahora confirma tu cita:
         [CONFIRMAR] [CANCELAR]"

4. User: Clicks CONFIRMAR

5. Bot: "✅ Confirmada!"

6. Database: Status = "Confirmada"
```

## Database Schema

### whatsapp_messages Table

**Stores all messages including REF:**

```sql
CREATE TABLE whatsapp_messages (
  id SERIAL PRIMARY KEY,
  direction TEXT,           -- 'incoming' for REF from user
  phone TEXT,              -- User's phone number
  message TEXT,            -- Contains "REF 123456"
  status TEXT,
  appointment_id INTEGER,  -- Linked appointment
  sucursal_id TEXT,       -- Branch ID
  wa_message_id TEXT,     -- WhatsApp message ID
  manual BOOLEAN,
  created_at TIMESTAMPTZ  -- For 72-hour search
)
```

**REF Search Query:**
```sql
SELECT message, created_at 
FROM whatsapp_messages
WHERE phone = $1
  AND direction = 'incoming'
  AND upper(message) LIKE 'REF%'
  AND created_at > NOW() - INTERVAL '72 hours'
ORDER BY created_at DESC
LIMIT 1
```

## Key Functions

### findLatestDepositRefFromMessagesMultiDb()

**Location:** Lines 510-538

**Purpose:** Find REF in any database

**Parameters:**
- `phone`: User's phone number
- `{ hours: 72 }`: Time window

**Returns:**
```javascript
{
  ref: "123456",           // The reference number
  message: "REF 123456",  // Full message
  created_at: timestamp,  // When sent
  db: 'db2'              // Which database
}
```

**Algorithm:**
1. Try current database first
2. If not found, try other databases (db1, db2, db3)
3. Return first match found

### findLatestDepositRefFromMessages()

**Location:** Lines 488-508

**Purpose:** Find REF in current database only

**Same logic as above but single database**

## WhatsApp Button Behavior

### Important Limitation

**WhatsApp does NOT allow disabling buttons after sending!**

Once a template with buttons is sent, those buttons remain clickable forever. We cannot:
- ❌ Disable buttons remotely
- ❌ Remove buttons after sending
- ❌ Gray out buttons
- ❌ Make buttons non-clickable

**Our Solution:** Block in backend

Even though buttons stay clickable:
1. ✅ Backend checks for REF before processing
2. ✅ Returns "need REF" message if missing
3. ✅ Does NOT update database status
4. ✅ User can click button but gets rejection message

## Troubleshooting

### "Why did appointment confirm without REF?"

**Possible Causes:**

1. **SQL Error (FIXED in commit c28d29c):**
   - Column "phone_number_id" doesn't exist
   - Caused context lookup to fail
   - Validation was bypassed

2. **Wrong Database:**
   - REF stored in db1, webhook processed in db2
   - Use `findLatestDepositRefFromMessagesMultiDb()` (searches all)

3. **Old REF (>72 hours):**
   - Default window is 72 hours
   - Older REFs ignored
   - Solution: Extend window or send new REF

4. **Deposit Not Required:**
   - `requireDeposit: false` for that branch
   - No validation applied
   - Check `getDepositConfig()`

### "REF going to AI and causing tenant mismatch"

**Fixed:** Line 1510 detects REF BEFORE AI routing

**Order of Operations:**
```
1. REF detection (line 1510) ← Happens first
2. AI routing (line 1722)     ← Never reached for REF
```

**Pattern:** `/^\s*REF\b/i.test(text)`

If this matches, the function returns early (line 1528) and never reaches AI.

## Testing Checklist

- [ ] Enable `requireDeposit` for test branch
- [ ] Send reminder
- [ ] Click CONFIRMAR without REF → Should be blocked
- [ ] Send "REF 123456"
- [ ] Check whatsapp_messages table → REF stored
- [ ] Click CONFIRMAR → Should succeed
- [ ] Check appointments table → Status = "Confirmada"
- [ ] Try again without new REF (within 72h) → Should succeed
- [ ] Wait 73 hours, try CONFIRMAR → Should be blocked again

## Environment Setup

**To enable deposit validation:**

1. Set branch configuration (per sucursal):
```javascript
{
  requireDeposit: true,
  depositInstructions: "Transfiere $500 y envía REF",
  depositAmount: 500
}
```

2. Test the flow

3. Monitor logs for:
```
🏦 [deposit] Incoming REF detected
🛑 [deposit] Gate check for CONFIRMAR/CANCELAR
```

## Security Considerations

1. **REF Format:** No validation on reference format
   - Any text after "REF" is accepted
   - Consider adding format validation if needed

2. **Time Window:** 72 hours default
   - Prevents very old references from being reused
   - Adjust per business needs

3. **Cross-Branch:** REF from one branch works for others
   - Current implementation doesn't isolate by branch
   - Consider adding branch filtering if needed

4. **Multiple REFs:** Last one wins
   - `ORDER BY created_at DESC LIMIT 1`
   - Most recent REF is used

## Summary

✅ REF validation is **fully implemented**
✅ Blocks confirmations without payment reference
✅ REF messages bypass AI routing
✅ Works across multiple databases
✅ Configurable per branch
✅ Critical SQL error fixed (commit c28d29c)

The system is production-ready for payment reference validation!
