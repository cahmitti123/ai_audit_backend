# Testing Guide

## Testing the API Integration

### Prerequisites

1. Ensure you have valid API keys in `.env`:

   ```bash
   OPENAI_API_KEY="your_key"
   ELEVENLABS_API_KEY="your_key"
   FICHE_ID="1762209"
   API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Test 1: Quick API Connection Test

Test if the API is accessible:

```bash
curl -X 'GET' \
  'https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/1762209?include_recordings=true&include_transcriptions=false' \
  -H 'accept: application/json'
```

**Expected Output:**

```json
{
  "success": true,
  "message": "Fiche parsed successfully",
  "information": { ... },
  "recordings": [ ... ]
}
```

### Test 2: Run the Pipeline

Run the complete pipeline:

```bash
npm run pipeline
```

**Expected Console Output:**

```
================================================================================
PIPELINE COMPLET AUTONOME - AI AUDIT
================================================================================

📂 Étape 1/5: Récupération des données

🌐 Requête API: https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/1762209?include_recordings=true&include_transcriptions=false

✓ Fiche ID: 1762209
✓ 14 enregistrements trouvés
✓ Prospect: Christine BADIN

🎤 Étape 2/5: Transcription audio
...
```

### Test 3: Verify Generated Files

After successful execution, check for these files:

```bash
ls -la data/
```

**Expected Files:**

- `data/timeline.json` - Timeline of all recordings
- `data/audit_results.json` - Audit results with scores
- `data/transcription_cache.json` - Cached transcriptions

### Test 4: Different Fiche ID

Test with a different fiche:

```bash
FICHE_ID=1234567 npm run pipeline
```

Or edit `.env`:

```bash
FICHE_ID="1234567"
```

Then run:

```bash
npm run pipeline
```

### Error Scenarios

#### Test 5: Invalid Fiche ID

```bash
FICHE_ID=999999999 npm run pipeline
```

**Expected:** Clear error message about API failure

#### Test 6: Invalid API URL

Temporarily set wrong URL in `.env`:

```bash
API_BASE_URL="https://invalid-url.com"
```

**Expected:** Network error with clear message

#### Test 7: Missing Environment Variable

Remove `FICHE_ID` from `.env` temporarily:

**Expected:** Uses default fiche ID (1762209)

### Validation Checklist

- [ ] API connection successful
- [ ] Fiche data retrieved correctly
- [ ] Recordings array populated
- [ ] Prospect information displayed
- [ ] Transcriptions completed
- [ ] Timeline generated
- [ ] Audit results saved
- [ ] All 3 files created in `data/` directory
- [ ] Can switch fiche IDs
- [ ] Error handling works

### Troubleshooting

#### Problem: "API Error 404"

**Solution:** Check if the FICHE_ID exists in the system

#### Problem: "No response from API"

**Solution:** Check network connection and API_BASE_URL

#### Problem: "API request failed"

**Solution:** Check if API is online and accessible

#### Problem: Missing recordings

**Solution:** Ensure `include_recordings=true` in API URL

### Performance

**Expected Timing:**

- API Fetch: < 2 seconds
- Transcription (14 recordings, first time): ~60-90 seconds
- Transcription (cached): < 1 second
- Timeline Generation: < 1 second
- Audit (18 steps parallel): ~60-120 seconds

**Total:** ~2-3 minutes (with cached transcriptions)

### Success Criteria

✅ Pipeline completes without errors
✅ All 3 data files generated
✅ audit_results.json contains all 18 steps
✅ Console shows progress through all 5 stages
✅ Can audit different fiches by changing FICHE_ID
✅ Error messages are clear and actionable
