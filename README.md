# Simplest

A local CMS prototype for an employee experience workspace. It includes a library of workplace guides, FAQs, policies, and announcements. Content is stored in the Firestore database `simplest` (project `salessavvy-test`) through the server’s `/api/content` API, so edits are shared across devices. Anyone who can reach the site can edit; every change keeps the previous version in a `history` subcollection. Without `FIRESTORE_DATABASE` set, the server uses an in-memory store for local development.

Run locally against the shared Firestore data at http://localhost:4173 (needs `gcloud auth application-default login`; Glean settings are read from `../.env`, so local edits sync to Glean the same way as the live site):

```sh
npm run dev
```

Seed the bundled resources (never overwrites existing documents):

```sh
FIRESTORE_DATABASE=simplest GOOGLE_CLOUD_PROJECT=salessavvy-test node scripts/seed-firestore.mjs
```

## Run locally

From this folder, start the Node.js server:

```sh
npm start
```

Then open `http://localhost:8080`. The server uses Cloud Run's `PORT` value when set and defaults to `8080` locally.

## Cloud Run

Use the Dockerfile at `/Dockerfile` with build context `/`. It starts the Node.js 22 server, which listens on Cloud Run's `PORT` (default `8080`) and serves only the site files. Leave the container command and arguments blank. The Cloud Build trigger watches `main`, so each push starts a build and deployment.

## CMS features

- Overview, pages and guidance, announcements, newsletters, and insights views
- Create and edit content with audience, owner, and review-date metadata
- Save drafts, submit pages for review, and publish locally
- Search and filter the employee resource library
- Illustrative engagement metrics; live page views and newsletter opens are not collected

## Glean sandbox index

The browser app does not read credentials or update Glean. A local `.env` file lives in the parent project folder, outside the web root, and is excluded by `.gitignore`. Keep the Indexing API token in that file.

From the parent project folder, submit the published resource library:

```sh
node simplest/scripts/index-published-to-glean.mjs
```

The uploader performs a bulk refresh. It replaces the datasource document set with the published entries in `content.mjs`; do not add unrelated documents to this datasource. Browser edits do not sync automatically. The current datasource is enabled for all sandbox users and its documents use broad access, so only send content approved for that audience. The `GLEAN_ALLOWED_USERS` list registers test users; it is not the access boundary while datasource visibility is `ENABLED_FOR_ALL`.

The indexed page URLs use `localhost:4173`, so they open only on a machine running Simplest. Use an HTTPS-hosted URL before sharing the links across machines.

Request immediate processing for this datasource (rate-limited to one request per datasource every three hours):

```sh
node simplest/scripts/index-published-to-glean.mjs --process-now
```

Check upload and per-document indexing status without resubmitting content:

```sh
node simplest/scripts/index-published-to-glean.mjs --check-status
```
