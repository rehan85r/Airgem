# Admin browser regression tests

From the repository root, run:

```sh
python3 tests/admin.spec.py
```

Requires Python 3, the Python `playwright` package, and Chromium. The cloud environment already provides them. Set `CHROMIUM_PATH` if Chromium is installed somewhere other than `/usr/bin/chromium`.

The suite starts its own temporary local HTTP server. It intercepts the Supabase SDK and Turnstile scripts with isolated fixtures, blocks other external requests, and creates a fresh browser context per scenario. It never signs in to or modifies the production database or storage. Fixture records and tokens are test data, and are never loaded by the application.

Coverage includes authorization and MFA UI flows, local project drafts, CRUD requests, schema mapping and preservation, search/filter/sort/pagination, guides/tasks/sanitization, investors/N/A, image uploads, Top Airdrops, failure recovery, unsaved-change guards, keyboard navigation, and responsive layouts at 1536, 1024, 768, 390 and 320 pixels.

These tests validate frontend behavior and service contracts. They do not establish production authentication, MFA enforcement, RLS policies, or storage permissions. Authenticated end-to-end testing requires an authorized test account and a dedicated test backend.

## Frontend structure

- `admin.html`: semantic admin shell, authentication screens, editor fields and dialogs.
- `admin.css`: admin-only design system and responsive layouts; no public styles are imported.
- `admin-app.js`: navigation, authentication/MFA, database/storage operations and record-derived dashboard views.
- `admin-editor.js`: local drafts, investor/task editing and sanitized rich-text content.

The existing Supabase schema is preserved. Project activity uses `activity_status` (Active/Ended); `status` remains the reward field. The editor maps Time to `time` and Start to `launch_date`, and retains custom links and existing task metadata. Top Airdrops uses the existing `site_trending_items` table verifies the persisted selection before reporting success, and restores the previous selection when an insert fails after deletion; an atomic save would require a separate backend transaction API.
