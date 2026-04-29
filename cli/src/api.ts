import type { VaultConfig } from "./config.js";

export interface ManifestEntry {
  path: string;
  etag: string;
  size: number;
  mtime: number;
  content_type: string;
}

export class ApiClient {
  constructor(private cfg: VaultConfig) {}

  async getManifest(): Promise<ManifestEntry[]> {
    const res = await fetch(this.url("/api/manifest"), { headers: this.headers() });
    if (!res.ok) throw new Error(`GET /api/manifest failed: ${res.status} ${await res.text()}`);
    const { files } = (await res.json()) as { files: ManifestEntry[] };
    return files;
  }

  async putSource(path: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    const res = await fetch(this.url(`/admin/source/${encodePath(path)}`), {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": contentType },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`);
  }

  async deleteSource(path: string): Promise<void> {
    const res = await fetch(this.url(`/admin/source/${encodePath(path)}`), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
    }
  }

  private url(path: string): string {
    const base = this.cfg.url.replace(/\/$/, "");
    return `${base}${path}`;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}` };
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
