/**
 * STORAGE SPIKE: prove the claude_storage primitive's core guarantees, headlessly.
 *
 * Exercises the REAL compiled StorageStore (dist/storage/store.js):
 *   1. set/get/list/delete round-trip for one origin
 *   2. ISOLATION — a second origin cannot see or read the first origin's records
 *   3. TRAVERSAL — keys that would escape the folder are rejected (../, absolute, separators)
 *   4. AUTO-ASSIGN — every origin gets a deterministic private sandbox with no config
 *   5. BIND + EXISTING DATA — bind an origin to a folder that already holds `workspace.json`
 *      (exactly brandbrain's on-disk shape) and read that data straight back. This is the
 *      "my existing project directory comes through" requirement, proven.
 *
 * Run: npm run build -w @relay/sidekick && node packages/sidekick/spike/storage-spike.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageStore, StorageKeyError, slugOrigin } from "../dist/storage/store.js";

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, ok: !!cond, detail }); console.error(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const stateDir = mkdtempSync(join(tmpdir(), "relay-storage-"));
const store = new StorageStore(stateDir);

const A = "https://brandbrain.localhost:5174";
const B = "https://evil.example";

// 1. round-trip -------------------------------------------------------------
store.set(A, "workspace", JSON.stringify({ brands: [{ id: "b1", name: "Acme" }], activeId: "b1", savedAt: 1 }));
store.set(A, "vendors", JSON.stringify({ vendors: { acme: { name: "Acme Co" } }, savedAt: 1 }));
const wsRaw = store.get(A, "workspace");
check("round-trip get returns what was set", wsRaw && JSON.parse(wsRaw).brands[0].name === "Acme");
check("list shows both keys, sorted", JSON.stringify(store.list(A)) === JSON.stringify(["vendors", "workspace"]));
check("delete removes a key", store.delete(A, "vendors") === true && store.get(A, "vendors") === null);
check("delete of missing key returns false", store.delete(A, "nope") === false);
check("get of missing key returns null", store.get(A, "ghost") === null);

// 2. isolation --------------------------------------------------------------
check("origin B sees none of A's keys", store.list(B).length === 0);
check("origin B cannot read A's workspace", store.get(B, "workspace") === null);
check("A and B resolve to different folders", store.folderFor(A).folder !== store.folderFor(B).folder);

// 3. traversal --------------------------------------------------------------
const rejects = (key) => { try { store.set(A, key, "x"); return false; } catch (e) { return e instanceof StorageKeyError; } };
check("rejects ../ traversal key", rejects("../escape"));
check("rejects nested-path key", rejects("sub/dir"));
check("rejects absolute-ish key", rejects("/etc/passwd"));
check("rejects empty key", rejects(""));
check("rejects dotfile-escape key", rejects("..%2f"));

// 4. auto-assign ------------------------------------------------------------
const infoA = store.info(A);
check("auto-assigned by default", infoA.autoAssigned === true);
check("sandbox lives under stateDir/storage", infoA.folder.startsWith(join(stateDir, "storage")));
check("sandbox folder is deterministic from origin", infoA.folder.endsWith(slugOrigin(A)));

// 5. bind + existing data ("same project directory comes through") ----------
// Simulate an EXISTING brandbrain project folder with real files already on disk.
const existingProject = join(mkdtempSync(join(tmpdir(), "brandbrain-")), ".data");
mkdirSync(existingProject, { recursive: true });
const existingWorkspace = { brands: [{ id: "real", name: "MyRealBrand" }, { id: "x2", name: "Second" }], activeId: "real", savedAt: 1720000000000 };
writeFileSync(join(existingProject, "workspace.json"), JSON.stringify(existingWorkspace));
writeFileSync(join(existingProject, "vendors.json"), JSON.stringify({ vendors: { supplier: { name: "Supplier Inc" } }, savedAt: 1 }));

// The user consents to bind (consent is the Broker's job; here we call the authorized bind directly).
store.bind(A, existingProject);
const bound = store.info(A);
check("bind flips autoAssigned to false", bound.autoAssigned === false);
check("bound folder is the real project dir", bound.folder === existingProject);

// The EXISTING files now appear as records — zero migration.
check("existing workspace.json appears as a record", store.list(A).includes("workspace"));
const throughWs = store.get(A, "workspace");
check("existing brand data reads straight through bind", throughWs && JSON.parse(throughWs).brands[0].name === "MyRealBrand");
check("existing vendors.json appears too", store.get(A, "vendors") !== null);

// And a write through the bound store lands in the real file the app already uses.
store.set(A, "workspace", JSON.stringify({ ...existingWorkspace, activeId: "x2" }));
const onDisk = JSON.parse(readFileSync(join(existingProject, "workspace.json"), "utf8"));
check("write through bound store updates the real workspace.json", onDisk.activeId === "x2");

// bindings persist across a fresh StorageStore (daemon restart) ------------
const store2 = new StorageStore(stateDir);
check("binding survives a daemon restart", store2.info(A).folder === existingProject);

// verdict -------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.error(`\n${failed.length === 0 ? "✅ STORAGE SPIKE PASSED" : `❌ ${failed.length} FAILED`} — ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
