# Floor Cleaning Log – IQC Area 5S

Public monthly cleaning calendar with Before / After evidence. Frontend: Netlify. Backend: Netlify Functions. All records, settings, full WebP photos and thumbnails: Netlify Blobs. No Supabase or external database.

## Project

- Repository: https://github.com/jojo58446tle-pixel/floor-cleaning-log-iqc
- Existing Netlify project: `floor-cleaning-log-iqc-5s`
- Site ID: `b3c674f5-3758-48c2-9e5b-450708f05192`
- Production URL: https://floor-cleaning-log-iqc-5s.netlify.app
- Use this repository and site only. Do not recreate them.
- Local verification does not establish production readiness. Complete the hosted validation checklist below.

## Setup and production deployment

Use Node 24 (specified in `.nvmrc`) and install with `npm ci`. The repository includes the dependency lockfile. Do not commit `node_modules`, `.netlify` or environment files.

Set `CLEANING_ADMIN_PASSWORD` to your chosen password (16–256 characters) in Netlify Environment Variables, Functions scope, Production context. Set `CLEANING_SESSION_SECRET` to at least 32 random characters, then redeploy. The direct password takes precedence. A configured password shorter than 16 characters disables login; it does not silently fall back to the hash. No password is returned by the API or embedded in the frontend. If the direct variable is absent or empty, the existing hash option remains supported.

For the hash option, run `npm run setup:admin` in your own interactive terminal to choose and confirm a strong password privately. It creates an ignored `.env.admin` containing only the password hash and session secret. Import those variables into the existing Netlify project, with Functions scope and Production context, then redeploy. Keep the password in your password manager. The command refuses to overwrite an existing file. Alternatively, create a strong admin password (at least 16 characters) and generate a random salt. `CLEANING_ADMIN_PASSWORD_HASH` has the format `salt:scryptHashHex`, where `scryptSync(password, salt, 64)` supplies the 128-character hex hash. Configure `CLEANING_SESSION_SECRET` as at least 32 random characters. Store both only in this project's Netlify environment variables with Functions scope; never in source, build output, frontend, or a committed `.env`. Use a private credential handoff for the admin password.

Set build Node version to 22+ and Functions runtime to a supported Node 22+ version in Netlify settings. `netlify.toml` publishes `public/`, bundles `netlify/functions/*.mts`, and preserves Sharp as an external native dependency.

Run `npm test`, then authenticate Netlify CLI and run `npm run deploy`. Alternatively, connect this project to its separate Git repository for Netlify builds. A drag-and-drop static-only deployment is insufficient because Functions must also be bundled and uploaded.

Public route: `/`. Admin route: `/admin`. Public viewing does not prompt for authentication. Admin authentication is independent of Netlify team visitor protection; leave public site password / SSO protection off.

## Storage and API

Production uses the site-wide `cleaning-log` store with strong consistency, which survives redeploys. Non-production deployments use deploy-specific stores so previews cannot alter production records.

```
records/YYYY/MM/DD/<uuid>.json
images/YYYY/MM/DD/<uuid>/before-<photo-uuid>.webp
images/YYYY/MM/DD/<uuid>/thumb-before-<photo-uuid>.webp
images/YYYY/MM/DD/<uuid>/after-<photo-uuid>.webp
images/YYYY/MM/DD/<uuid>/thumb-after-<photo-uuid>.webp
settings.json
```

Every activity has a UUID. Multiple activities per day are supported. Records begin as drafts visible only to Admin. A record can publish only when it has at least one Before and one After photo. Dates cannot change after creation; create a new activity on the correct date instead. Administrators can resume an unpublished draft from its calendar detail.

Read API: `GET /api/records?month=YYYY-MM`, `GET /api/record?date=YYYY-MM-DD&id=UUID`, `GET /api/settings`, `GET /api/statistics?month=YYYY-MM`, and `GET /api/image?date=...&id=...&photo=...&size=thumb|full`.

Write API: `POST /api/records`, `PUT|DELETE /api/record`, `POST /api/upload?date=...&id=...&group=before|after|additional`, and `PUT /api/settings`. All require a signed HttpOnly, Secure, SameSite=Strict cookie, exact same-origin header and per-session CSRF header. Anonymous direct writes are rejected. Login has a separate platform rate limit. Edit/upload use conditional ETag writes to avoid overwriting concurrent changes. Cookie-aware cache separation prevents admin draft responses from entering the public read cache.

Monthly reads query only the requested month prefix. Statistics fetch a bounded 12-month window only on the Statistics page. Public JSON responses cache on Netlify CDN for 15 seconds, with cookie variation. Images validate that the requested photo belongs to a readable record, and serve only stored WebP data.

## Image pipeline

The phone browser auto-orients and resizes to 1920px before upload, keeping upload payloads within Functions limits. The server independently decodes, auto-rotates, strips metadata, resizes within 1920px, encodes WebP at approximately quality 80, and creates a separate 400px thumbnail. Original phone files are not stored. Full image encoding quality decreases to 60 only if necessary to approach the 700KB ceiling.

300–700KB full and 50–120KB thumbnail are targets, not padding rules: simple or small photos can be substantially smaller. Calendar and Gallery URLs always request `size=thumb`. Full images load only in selected date detail or the fullscreen viewer. Lazy loading is used throughout. Some HEIC formats require device export as JPEG depending on browser and Sharp codec support.

## Metrics, areas and holidays

Cleaning Days = distinct published record dates. Total Activities = published records. Cleaning Rate = Cleaning Days / all calendar days in the selected month. Areas Cleaned = distinct areas in published records. Photos Uploaded = all Before, After and Additional photos in published records. No counts include drafts.

The eight requested areas are the initial defaults. Admin can add/remove active areas and configure explicit holiday dates. No national or factory holiday schedule is guessed. Historical area names remain readable and filterable after removal from the active list.

## Verification completed locally

26 tests passed: 8 date/metric/authentication tests, 5 calendar rendering regressions, 1 complete public DOM navigation test, 3 actual Sharp image tests, and 9 API integration tests. API integration tests substitute an in-memory Blobs adapter; they **do not verify hosted Netlify Blobs**. Sharp image tests used the available runtime Sharp 0.35.4, also pinned in package.json.

The integration flow covers unauthorized writes, CSRF and origin rejection, unpublished drafts, image upload and EXIF rotation, Before/After publication, month/statistics reads, image full/thumb decoding, edit conflict rejection, delete cleanup, and preview/production isolation. The test adapters live only under `tests/` and are never loaded by the deployed application. No demo records or images are seeded into the app.

Dependency installation and both Functions bundles were verified locally. Browser/mobile UI validation, hosted storage, Production E2E and redeploy persistence still require a real published deploy.

## Required production validation before closing this task

1. Confirm the public URL works in a logged-out browser with no password/SSO gate.
2. Attempt direct anonymous Add/Edit/Delete/Upload/Settings requests and confirm rejection.
3. Sign in on `/admin`, add a dated activity and upload a phone photo in Before and After.
4. Confirm WebP full dimensions ≤1920px and thumbnail dimensions ≤400px; inspect byte counts and visible quality.
5. Save/publish, reload, verify Calendar thumbnail, date detail, Before/After full images, viewer next/previous/zoom/close, Gallery thumbnails and all filters.
6. Verify summary and Statistics against the test activity, including a second activity on the same date.
7. Verify mobile/desktop layout and keyboard access. Confirm no full image requests occur in Calendar/Gallery.
8. Redeploy the same site and verify the previously saved records and photos survive.
9. Delete the exact test activity IDs, confirm their record and image keys are removed, confirm the public calendar and metrics return to the baseline, and verify no drafts remain from the test.
10. Record actual deployment ID, URL, verification outcomes and cleanup evidence. Do not declare Production completion based only on local tests or project creation.

## Safe editing and deletion

New photos uploaded while editing published evidence are staged privately under an edit batch. Public Calendar, Gallery, details and statistics continue to use committed photos until Save succeeds. Cancel discards only that edit batch. The tab retains its edit batch in session storage so reopening the editor after a refresh can resume or cancel staged uploads. Abandoned photos are never publicly served.

Record deletion first saves a non-public tombstone, removes all images under that record's unique prefix, and removes the JSON last. If a storage operation fails, Admin can retry Delete from the calendar. Cleanup never lists or deletes another record's prefix. Removed-image cleanup keys remain attached to the record so interrupted cleanup can be retried.
