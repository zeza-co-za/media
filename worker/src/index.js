const OWNER = "zeza-co-za";
const REPO = "media";
const BRANCH = "main";
const MEDIA_ROOT = "media";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif", "image/bmp", "image/x-icon"
]);
const ALLOWED_ORIGINS = new Set([
  "https://media.zeza.co.za",
  "https://www.media.zeza.co.za"
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://media.zeza.co.za";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) }
  });
}

function cleanSegment(value, fallback) {
  const cleaned = String(value || fallback)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function buildPath(folder, filename) {
  const folderParts = String(folder || "")
    .split("/")
    .map(s => cleanSegment(s, ""))
    .filter(Boolean)
    .slice(0, 6);
  const safeName = cleanSegment(filename, "upload.jpg");
  return [MEDIA_ROOT, ...folderParts, safeName].join("/");
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function github(url, env, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  return fetch(`https://api.github.com${url}`, { ...init, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "zeza-media-upload", repository: `${OWNER}/${REPO}`, branch: BRANCH }, 200, origin);
    }

    if (url.pathname !== "/api/upload" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, origin);
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength && contentLength > MAX_BYTES + 1024 * 1024) {
      return json({ error: "File exceeds the 20 MB limit" }, 413, origin);
    }

    try {
      const form = await request.formData();
      const file = form.get("file");
      const folder = form.get("folder") || "";
      const requestedName = form.get("filename") || "";

      if (!(file instanceof File)) return json({ error: "No image file supplied" }, 400, origin);
      if (!ALLOWED_TYPES.has(file.type)) return json({ error: "Only supported image formats may be uploaded" }, 415, origin);
      if (file.size <= 0 || file.size > MAX_BYTES) return json({ error: "Image must be between 1 byte and 20 MB" }, 413, origin);

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const defaultName = `image-${Date.now()}.${ext}`;
      const filename = requestedName ? requestedName : file.name;
      const path = buildPath(folder, filename || defaultName);

      const existing = await github(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`, env);
      if (existing.ok) {
        return json({ error: "A file with that name already exists. Choose a different filename." }, 409, origin);
      }
      if (existing.status !== 404) {
        return json({ error: "Could not verify the destination file" }, 502, origin);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = toBase64(bytes);
      const response = await github(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Upload media: ${path.replace(/^media\//, "")}`,
          content,
          branch: BRANCH
        })
      });

      const result = await response.json();
      if (!response.ok) {
        return json({ error: result.message || "GitHub upload failed" }, response.status === 422 ? 422 : 502, origin);
      }

      return json({
        ok: true,
        path,
        rawUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path.split("/").map(encodeURIComponent).join("/")}`,
        commit: result.commit?.sha || null
      }, 201, origin);
    } catch (error) {
      return json({ error: "Upload failed", detail: error instanceof Error ? error.message : "Unknown error" }, 500, origin);
    }
  }
};
