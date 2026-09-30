# Simplest

A local CMS prototype for an employee experience workspace. It includes a library of workplace guides, FAQs, policies, announcements, and community updates. Browser edits are saved in `localStorage`.

## Run locally

From this folder, start a local server:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## CMS features

- Overview, pages and guidance, newsletters, communities, and insights views
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
