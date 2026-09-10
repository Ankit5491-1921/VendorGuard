const fs = require("node:fs");
const path = require("node:path");

/** Tiny single-process JSON store. Save before changing memory, using atomic replacement.
 * Synchronous commits keep concurrent HTTP requests from overwriting one another.
 * Replace this module with database transactions for a multi-server deployment.
 */
class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "invoices.json");
    this.fresh = !fs.existsSync(this.file);
    this.records = this.fresh
      ? []
      : JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (
      !Array.isArray(this.records) ||
      this.records.some((r) => !r.id || !r.audit || !r.trace)
    ) {
      throw new Error(
        "Stored invoice data is invalid. Restore a backup or move the file aside before restarting.",
      );
    }
  }
  list() {
    return structuredClone(this.records);
  }
  get(id) {
    const row = this.records.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }
  commit(records) {
    fs.writeFileSync(
      `${this.file}.tmp`,
      JSON.stringify(records, null, 2),
      "utf8",
    );
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.records = structuredClone(records);
  }
  insert(record) {
    this.commit([record, ...this.records]);
  }
  update(record) {
    this.commit(this.records.map((r) => (r.id === record.id ? record : r)));
  }
}
module.exports = { Store };
