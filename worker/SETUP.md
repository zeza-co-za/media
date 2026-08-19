# Secure media upload setup

The media portal does not contain a GitHub token. Uploads are handled by this Cloudflare Worker, which keeps the GitHub credential server-side.

## 1. Create a GitHub fine-grained token

Create a fine-grained Personal Access Token for the `zeza-co-za` account and restrict it to **only** the `zeza-co-za/media` repository.

Required repository permission:

- Contents: Read and write

Do not grant access to other repositories or unrelated permissions.

## 2. Add the token to Cloudflare

Create the Worker from `worker/wrangler.toml` and add the token as an encrypted secret:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Paste the token when prompted. Never commit the token to GitHub.

## 3. Configure the route

Route the Worker to:

```text
media.zeza.co.za/api/*
```

The static website continues to be served by GitHub Pages. Only `/api/*` is handled by the Worker.

## 4. Test the Worker

Open:

```text
https://media.zeza.co.za/api/health
```

Expected response:

```json
{"ok":true,"service":"zeza-media-upload","repository":"zeza-co-za/media","branch":"main"}
```

## Security model

- No GitHub credential is sent to the browser.
- The token is stored as a Cloudflare encrypted Worker secret.
- The token is restricted to the media repository.
- The Worker accepts uploads only from `https://media.zeza.co.za`.
- Uploads are limited to supported image MIME types.
- Maximum image size is 20 MB.
- Directory traversal is prevented by filename sanitisation.
- Existing files are not overwritten automatically.
- Public raw URLs remain read-only through GitHub's public raw content service.

## Recommended next hardening

For a private admin-only upload area, add Cloudflare Access in front of `/api/*` so only your authorised identity can upload. The public media URLs can remain accessible for blogs and social media.
