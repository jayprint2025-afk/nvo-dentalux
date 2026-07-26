# WhatsApp Reminders Troubleshooting Guide

## Problem: Messages Only Arriving to One Number

### Symptoms
- ✅ Messages arrive to 6867865454 (or one specific number)
- ❌ Messages don't arrive to other numbers
- ❌ "Error: Failed to fetch" in frontend
- System was working normally before

## Root Cause: WhatsApp Business API Test Mode

The most common cause is that your WhatsApp Business API is in **TEST MODE**, which only allows sending messages to verified/approved phone numbers.

## Quick Diagnosis

### Step 1: Check Server Logs

After clicking "Enviar confirmaciones HOY", check your server logs for:

```
📊 [broadcast] Summary: { 
  total_appointments: 10, 
  successfully_sent: 1, 
  failed: 9, 
  phone_issues: 9 
}
```

If `phone_issues` is high, you have a verification problem.

### Step 2: Check Frontend Response

Look for this message:
```
⚠️ 9 números no verificados (modo test WhatsApp)
Some messages failed due to phone number issues. This typically happens 
when numbers are not verified in WhatsApp Business API test mode.
```

### Step 3: Check Error Details

In server logs, look for errors like:
```
❌ [whatsapp] API Error: {
  status: 400,
  errorCode: 131030,
  errorMessage: "Recipient phone number not a WhatsApp user"
}
```

Common error codes:
- `131030` - Number not a WhatsApp user
- `131031` - Invalid phone number format
- `131026` - Missing phone number
- `131047` - Number not verified in test mode

## Solutions

### Option 1: Move to Production Mode (Recommended)

This is the best long-term solution. All valid WhatsApp numbers will work.

**Steps:**
1. Log into [Meta Business Manager](https://business.facebook.com/)
2. Go to your WhatsApp Business API app
3. Navigate to Settings → WhatsApp → API Setup
4. Submit your app for review
5. Fill out the required information:
   - Business verification
   - Use case description
   - Privacy policy
   - Terms of service
6. Wait for approval (usually 1-3 days)
7. Once approved, toggle to Production mode

**Approval Requirements:**
- Business must be verified with Meta
- App must have a valid use case
- Privacy policy and TOS must be provided
- Display name must be approved

### Option 2: Add Test Phone Numbers

Quick solution for testing, but limited to ~50 numbers.

**Steps:**
1. Go to Meta Business Manager
2. Navigate to WhatsApp → Settings → Test Phone Numbers
3. Click "Add Phone Number"
4. Enter the phone number in E.164 format (e.g., +526861234567)
5. The phone owner will receive an OTP code
6. Enter the OTP to verify
7. Repeat for each number

**Limitations:**
- Maximum ~50 numbers in test mode
- Each number must verify individually
- Numbers expire if not used for 90 days

### Option 3: Use Approved Message Templates

Templates have higher delivery rates in test mode.

**Setup:**
1. Create a message template in Meta Business Manager
2. Get it approved (usually 24-48 hours)
3. Set environment variable:
   ```bash
   WA_CONFIRM_TEMPLATE=your_template_name
   ```
4. System will automatically use template for broadcasts

**Template Example:**
```
Hola {{1}} 👋
Tu cita está programada para {{2}} a las {{3}}
Folio: {{4}}
```

Variables:
- {{1}} = Patient name
- {{2}} = Date
- {{3}} = Time
- {{4}} = Appointment ID

## Environment Variables

Check these are set correctly:

```bash
# Required
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token

# Optional - improves delivery
WA_CONFIRM_TEMPLATE=appointment_reminder
WA_TEMPLATE_LANG=es_MX

# Optional - phone format defaults
WA_ASSUME_10_DIGIT_COUNTRY=MX  # or US
```

## Phone Number Format Issues

### Correct Formats

**Mexico (MX):**
- Stored in DB: `6861234567` (10 digits)
- E.164 format: `+526861234567`
- Sent to API: `526861234567` (without +)

**USA (US):**
- Stored in DB: `16191234567` (11 digits with 1)
- E.164 format: `+16191234567`
- Sent to API: `16191234567` (without +)

### If Phone Numbers Are Wrong Format

Check your appointments table:
```sql
SELECT id, patient, phone, date 
FROM appointments 
WHERE date = CURRENT_DATE 
  AND status = 'PENDIENTE'
  AND phone IS NOT NULL;
```

Fix format if needed:
```sql
-- Mexico: should be 10 digits
UPDATE appointments 
SET phone = RIGHT(phone, 10) 
WHERE LENGTH(REGEXP_REPLACE(phone, '\D', '', 'g')) = 10;

-- Add missing country code info in a separate column if needed
```

## Testing

### Test with Preview Mode

Before sending, preview what would be sent:

```bash
curl -X POST "https://your-server.onrender.com/api/whatsapp/broadcast/confirmations?preview=1&sucursal_id=sucursal_1&secret=your_secret"
```

Response shows targeted numbers without actually sending.

### Test with Single Number

Test with a known working number first:

1. Create a test appointment with the working number
2. Click send button
3. Verify it works
4. Then add more numbers gradually

## Common Issues and Fixes

### Issue: "Failed to fetch"

**Causes:**
- CORS not configured
- API endpoint incorrect
- Server down

**Fix:**
```javascript
// Check API_BASE in frontend
const API_BASE = import.meta.env.VITE_API_BASE || "https://dentalux-sucs.onrender.com";
```

### Issue: "Unauthorized" (401 Error)

**Cause:** Secret mismatch

**Fix:**
```bash
# Backend .env
WA_BROADCAST_SECRET=your_secret_here

# Frontend .env
VITE_WA_BROADCAST_SECRET=your_secret_here
```

### Issue: "WhatsApp env vars missing"

**Cause:** Missing credentials

**Fix:**
```bash
# Add to your .env or Render environment variables
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_ACCESS_TOKEN=EAAC...
```

Get these from Meta Business Manager → WhatsApp → API Setup.

### Issue: Messages Send But Don't Arrive

**Possible Causes:**
1. **Test mode** - Number not verified
2. **Number invalid** - Not a WhatsApp user
3. **Rate limiting** - Sending too many messages
4. **Template not approved** - Using template mode with unapproved template

**Fix:**
1. Check phone has WhatsApp installed
2. Verify number format is correct
3. Add delay between messages if sending many
4. Use approved templates or plain text mode

## Getting Help

### Check Logs

**Server logs:**
```bash
# If using Render
# Go to Dashboard → Your Service → Logs

# Look for:
📤 [whatsapp] POST /messages
❌ [whatsapp] API Error
📊 [broadcast] Summary
```

**Browser console:**
```javascript
// Open DevTools → Console
// Look for:
Broadcast errors: [...]
Phone verification issues: [...]
```

### Meta Support

If issues persist:
1. Go to [Meta Business Help Center](https://business.facebook.com/help)
2. Check WhatsApp Business API status
3. Submit a support ticket with:
   - Your Phone Number ID
   - Error codes from logs
   - Timestamp of failed attempts

### Contact Meta Developer Support

- Email: developersupport@support.facebook.com
- Include: Business ID, Phone Number ID, error codes

## Monitoring

### Set Up Alerts

Monitor broadcast success rate:

```javascript
// Add to your monitoring
if (phoneIssues > 0) {
  // Alert: Phone verification issues detected
  sendAlert(`${phoneIssues} numbers failed verification`);
}
```

### Regular Checks

Weekly:
- Verify test numbers are still active
- Check WhatsApp API status
- Review failed message logs
- Update phone number list

## Summary

**Most Common Solution:**
Move from Test Mode to Production Mode in Meta Business Manager.

**Quick Workaround:**
Add specific phone numbers to test list in WhatsApp settings.

**Long-term Fix:**
- Use production mode
- Implement approved message templates
- Monitor delivery rates
- Keep phone numbers up to date
