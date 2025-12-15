## Progress

### Working now
- **Scaled backend** behind nginx load balancer (3 replicas).
- **Audit pipeline** executes in parallel at the **step** level across replicas.
- **Progressive fiche date-range jobs** run distributed per day and correctly finalize.
- **Automation runs** distribute fiche detail fetch across replicas and fan out transcription/audit work.
- TypeScript build is green (`npm run build`).
- Docker startup runs `prisma migrate deploy` so DB schema stays aligned with Prisma (prevents runtime column-missing crashes).

### Verified smoke tests (local)
- Created progressive fetch job for missing dates and confirmed it progressed to **complete** via `/api/fiches/jobs/:jobId`.
- Triggered an automation run with manual fiche selection and confirmed it uses distributed `fiche/fetch` fan-out.

### Known caveats
- When adding **new Inngest function IDs/events**, the Inngest service may need a restart to reload SDK definitions.
- Automation runs that rely on “automatic audit configs” will show **0 configs** if no configs are marked automatic.





