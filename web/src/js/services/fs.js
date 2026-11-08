/* =========================================================
   File systems: real folder (File System Access API) or in-memory copy
   ========================================================= */
import { dirName } from "../core/util.js";

export class HandleFS {
  constructor(root) { this.root = root; this.name = root.name; this.kind = "disk"; }
  async list() {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (name.startsWith(".")) continue;
        const p = prefix ? prefix + "/" + name : name;
        if (handle.kind === "directory") await walk(handle, p);
        else out.push({ path: p, handle });
      }
    };
    await walk(this.root, "");
    return out;
  }
  async dir(path, create) {
    let d = this.root;
    for (const seg of path.split("/").filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
    return d;
  }
  async fileHandle(path, create = false) {
    const d = await this.dir(dirName(path), create);
    return d.getFileHandle(path.split("/").pop(), { create });
  }
  async readFile(path) { return (await this.fileHandle(path)).getFile(); }
  async read(path) { return (await this.readFile(path)).text(); }
  async exists(path) { try { await this.fileHandle(path); return true; } catch { return false; } }
  async write(path, text) {
    const fh = await this.fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    return (await fh.getFile()).lastModified;
  }
  async remove(path) { const d = await this.dir(dirName(path), false); await d.removeEntry(path.split("/").pop()); }
  async listDir(path) { const d = await this.dir(path, false); const out = []; for await (const [name, hd] of d.entries()) if (hd.kind === "file") out.push(name); return out; }
  async removeDir(path) { const d = await this.dir(dirName(path), false); await d.removeEntry(path.split("/").pop(), { recursive: true }); }
}
export class MemoryFS {
  constructor(name, kind) { this.name = name; this.kind = kind; this.files = new Map(); }
  add(path, data, mtime = Date.now()) { this.files.set(path, { data, mtime }); }
  async list() { return [...this.files.keys()].filter((p) => !p.split("/").some((s) => s.startsWith("."))).map((path) => ({ path })); }
  async readFile(path) {
    const f = this.files.get(path);
    if (!f) throw new Error("not found");
    const blob = f.data instanceof Blob ? f.data : new Blob([f.data], { type: "text/markdown" });
    return Object.assign(blob, { lastModified: f.mtime });
  }
  async read(path) { const f = this.files.get(path); if (!f) throw new Error("not found"); return typeof f.data === "string" ? f.data : f.data.text(); }
  async exists(path) { return this.files.has(path); }
  async write(path, text) { const m = Date.now(); this.files.set(path, { data: text, mtime: m }); return m; }
  async remove(path) { this.files.delete(path); }
}

/* IndexedDB: remember the last opened folder handle */
const IDB_NAME = "supstack-standalone";
const OLD_IDB_NAME = "supsidian-standalone"; // versions up to 0.19; its values move on first read
export const idb = {
  open(name = IDB_NAME) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async read(name, k) { const db = await this.open(name); try { return await new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } finally { db.close(); } },
  async get(k) {
    try {
      const v = await this.read(IDB_NAME, k);
      if (v !== undefined || !indexedDB.databases) return v;
      if (!(await indexedDB.databases()).some((d) => d.name === OLD_IDB_NAME)) return undefined;
      const old = await this.read(OLD_IDB_NAME, k);
      if (old !== undefined) { await this.set(k, old); indexedDB.deleteDatabase(OLD_IDB_NAME); }
      return old;
    } catch { return undefined; }
  },
  async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = res; tx.onerror = res; }); } catch { /* ignore */ } },
};

