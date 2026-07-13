const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createDatabase } = require("./src/database-factory");
const { BENEFICIARY_FIELDS, fieldSectionMap } = require("./src/metadata");
const { recognizeNutritionProfile } = require("./src/nutrition-ocr");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3417);
const PUBLIC_DIR = path.join(__dirname, "public");
const BODY_LIMIT_BYTES = 40 * 1024 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
const responseCache = new Map();
const SHORT_CACHE_MS = 15 * 1000;
const MEDIUM_CACHE_MS = 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function sendCachedJson(res, key, ttlMs, producer) {
  const now = Date.now();
  const cached = responseCache.get(key);

  if (cached && cached.expiresAt > now) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const payload = await producer();
  responseCache.set(key, {
    payload,
    expiresAt: now + ttlMs
  });
  sendJson(res, 200, payload);
}

async function sendRecordFromCache(req, res, url, producer, payloadKey = "record") {
  const key = cacheKey(req, url);
  const now = Date.now();
  const cached = responseCache.get(key);

  if (cached && cached.expiresAt > now) {
    sendJson(res, 200, cached.payload);
    return cached.payload[payloadKey] || null;
  }

  const record = await producer();
  if (!record) return null;

  const payload = { [payloadKey]: record };
  responseCache.set(key, {
    payload,
    expiresAt: now + SHORT_CACHE_MS
  });
  sendJson(res, 200, payload);
  return record;
}

function cacheKey(req, url) {
  return `${req.method}:${url.pathname}?${url.searchParams.toString()}`;
}

function clearResponseCache() {
  responseCache.clear();
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function databaseConnectionMessage(error) {
  const message = String(error?.message || "");
  const cause = String(error?.cause?.message || "");

  if (/fetch failed|timeout|connect/i.test(`${message} ${cause}`)) {
    return "Cloud database connection failed. Check the internet connection and try again.";
  }

  return message ? `Database connection failed: ${message}` : "Database connection failed.";
}

function statusCodeForError(error) {
  const message = String(error?.message || "");
  const cause = String(error?.cause?.message || "");

  if (message === "Invalid username or password.") return 401;
  if (message === "Invalid JSON body.") return 400;
  if (message === "Request is too large.") return 413;
  if (/fetch failed|timeout|connect|econnreset|econnrefused|socket|network/i.test(`${message} ${cause}`)) {
    return 503;
  }

  return 500;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = {
    token,
    user,
    expiresAt: Date.now() + SESSION_TTL_MS
  };

  sessions.set(token, session);
  return session;
}

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : "";
}

function getSession(req) {
  const token = readBearerToken(req);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireSession(req, res) {
  const session = getSession(req);

  if (!session) {
    sendError(res, 401, "Please sign in to continue.");
    return null;
  }

  return session;
}

function requireSuperadmin(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;

  if (session.user.role !== "superadmin") {
    sendError(res, 403, "Only the superadmin can manage accounts.");
    return null;
  }

  return session;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (Buffer.byteLength(body) > BODY_LIMIT_BYTES) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(requestedPath)));
  const relativePath = path.relative(PUBLIC_DIR, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      sendError(res, 404, "Not found.");
      return;
    }

    const mimeType = MIME_TYPES[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": data.length
    });
    res.end(data);
  });
}

function recordIdFromPath(pathname, prefix) {
  const rest = pathname.slice(prefix.length);
  const firstPart = rest.split("/")[0];
  const id = Number(firstPart);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function createServer(database, startupError = null, reconnectDatabase = null) {
  let databaseError = startupError;

  async function requireDatabaseConnection(res) {
    if (database) return database;

    if (typeof reconnectDatabase === "function") {
      try {
        database = await reconnectDatabase();
        databaseError = null;
        return database;
      } catch (error) {
        databaseError = error;
      }
    }

    sendError(res, 503, databaseConnectionMessage(databaseError));
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      if (pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          database: Boolean(database),
          error: database ? "" : databaseConnectionMessage(databaseError)
        });
        return;
      }

      if (pathname.startsWith("/api/") && !await requireDatabaseConnection(res)) {
        return;
      }

      if (pathname === "/api/auth/login" && req.method === "POST") {
        const payload = await readJsonBody(req);
        const user = await database.authenticateUser(payload.username, payload.password);
        const session = createSession(user);
        sendJson(res, 200, { token: session.token, user: session.user });
        return;
      }

      if (pathname === "/api/auth/logout" && req.method === "POST") {
        const token = readBearerToken(req);
        if (token) sessions.delete(token);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/auth/me" && req.method === "GET") {
        const session = requireSession(req, res);
        if (!session) return;
        sendJson(res, 200, { user: session.user });
        return;
      }

      if (pathname === "/api/users" && req.method === "GET") {
        if (!requireSuperadmin(req, res)) return;
        sendJson(res, 200, { users: await database.listUsers() });
        return;
      }

      if (pathname === "/api/users" && req.method === "POST") {
        if (!requireSuperadmin(req, res)) return;
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { user: await database.saveUser(payload) });
        return;
      }

      if (pathname.startsWith("/api/") && !requireSession(req, res)) {
        return;
      }

      if (pathname === "/api/metadata" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), MEDIUM_CACHE_MS, async () => ({
          fields: BENEFICIARY_FIELDS,
          sections: fieldSectionMap()
        }));
        return;
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, () => database.stats());
        return;
      }

      if (pathname === "/api/next-control-no" && req.method === "GET") {
        const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({ controlNo: await database.nextControlNo(year) }));
        return;
      }

      if (pathname === "/api/records" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          records: await database.listRecords({
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || 50,
            offset: url.searchParams.get("offset") || 0,
            detail: url.searchParams.get("detail") || "summary"
          }),
          total: typeof database.countRecords === "function"
            ? await database.countRecords({ search: url.searchParams.get("search") || "" })
            : 0
        }));
        return;
      }

      if (pathname === "/api/records" && req.method === "POST") {
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { record: await database.saveRecord(payload) });
        return;
      }

      if (pathname.startsWith("/api/records/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/records/");
        const record = id ? await sendRecordFromCache(req, res, url, () => database.getRecord(id)) : null;

        if (!record) {
          sendError(res, 404, "Record was not found.");
          return;
        }

        return;
      }

      if (pathname.startsWith("/api/records/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/records/");
        const record = id ? await database.deleteRecord(id) : null;

        if (!record) {
          sendError(res, 404, "Record was not found.");
          return;
        }

        clearResponseCache();
        sendJson(res, 200, { record });
        return;
      }

      if (pathname === "/api/monitoring/reports" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          reports: await database.listMonitoringReports({
            search: url.searchParams.get("search") || "",
            beneficiaryId: url.searchParams.get("beneficiaryId") || "",
            limit: url.searchParams.get("limit") || 200,
            offset: url.searchParams.get("offset") || 0
          }),
          total: typeof database.countMonitoringReports === "function"
            ? await database.countMonitoringReports({
              search: url.searchParams.get("search") || "",
              beneficiaryId: url.searchParams.get("beneficiaryId") || ""
            })
            : 0
        }));
        return;
      }

      if (pathname === "/api/monitoring/reports" && req.method === "POST") {
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { report: await database.saveMonitoringReport(payload) });
        return;
      }

      if (pathname === "/api/monitoring/forwarded-balance" && req.method === "GET") {
        sendJson(res, 200, await database.getMonitoringForwardedBalance({
          beneficiaryId: url.searchParams.get("beneficiaryId") || "",
          reportMonth: url.searchParams.get("reportMonth") || "",
          excludeId: url.searchParams.get("excludeId") || 0
        }));
        return;
      }

      if (pathname.startsWith("/api/monitoring/reports/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/monitoring/reports/");
        const report = id ? await sendRecordFromCache(req, res, url, () => database.getMonitoringReport(id), "report") : null;

        if (!report) {
          sendError(res, 404, "Monitoring report was not found.");
          return;
        }

        return;
      }

      if (pathname.startsWith("/api/monitoring/reports/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/monitoring/reports/");
        const report = id ? await database.deleteMonitoringReport(id) : null;

        if (!report) {
          sendError(res, 404, "Monitoring report was not found.");
          return;
        }

        clearResponseCache();
        sendJson(res, 200, { report });
        return;
      }

      if (pathname === "/api/nutrition/overview" && req.method === "GET") {
        if (url.searchParams.get("summary") === "dashboard" && typeof database.nutritionDashboardSummary === "function") {
          await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, () => database.nutritionDashboardSummary());
          return;
        }
        await sendCachedJson(res, cacheKey(req, url), MEDIUM_CACHE_MS, () => database.nutritionOverview());
        return;
      }

      if (pathname === "/api/nutrition/next-beneficiary-no" && req.method === "GET") {
        const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
        sendJson(res, 200, { beneficiaryNo: await database.nextNutritionBeneficiaryNo(year) });
        return;
      }

      if (pathname === "/api/nutrition/ocr-profile" && req.method === "POST") {
        const payload = await readJsonBody(req);
        sendJson(res, 200, await recognizeNutritionProfile(payload.imageData));
        return;
      }

      if (pathname === "/api/nutrition/growth/cgs" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), MEDIUM_CACHE_MS, () => database.nutritionCgsReference());
        return;
      }

      if (pathname === "/api/nutrition/growth/reports" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          reports: await database.listNutritionGrowthReports({
            search: url.searchParams.get("search") || "",
            centerId: url.searchParams.get("centerId") || "",
            limit: url.searchParams.get("limit") || 200,
            offset: url.searchParams.get("offset") || 0
          }),
          total: typeof database.countNutritionGrowthReports === "function"
            ? await database.countNutritionGrowthReports({
              search: url.searchParams.get("search") || "",
              centerId: url.searchParams.get("centerId") || ""
            })
            : 0
        }));
        return;
      }

      if (pathname === "/api/nutrition/growth/draft" && req.method === "GET") {
        sendJson(res, 200, {
          report: await database.buildNutritionGrowthDraft({
            id: url.searchParams.get("id") || "",
            center_id: url.searchParams.get("centerId") || "",
            submitted_date: url.searchParams.get("submittedDate") || "",
            report_month: url.searchParams.get("reportMonth") || ""
          })
        });
        return;
      }

      if (pathname === "/api/nutrition/growth/reports" && req.method === "POST") {
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { report: await database.saveNutritionGrowthReport(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/growth/reports/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/growth/reports/");
        const report = id ? await sendRecordFromCache(req, res, url, () => database.getNutritionGrowthReport(id), "report") : null;

        if (!report) {
          sendError(res, 404, "Growth monitoring report was not found.");
          return;
        }

        return;
      }

      if (pathname.startsWith("/api/nutrition/growth/reports/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/growth/reports/");
        const report = id ? await database.deleteNutritionGrowthReport(id) : null;

        if (!report) {
          sendError(res, 404, "Growth monitoring report was not found.");
          return;
        }

        clearResponseCache();
        sendJson(res, 200, { report });
        return;
      }

      if (pathname === "/api/nutrition/centers" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          centers: await database.listNutritionCenters({
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || 200,
            offset: url.searchParams.get("offset") || 0
          })
        }));
        return;
      }

      if (pathname === "/api/nutrition/centers" && req.method === "POST") {
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { center: await database.saveNutritionCenter(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/centers/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/centers/");
        const center = id ? await sendRecordFromCache(req, res, url, () => database.getNutritionCenter(id), "center") : null;

        if (!center) {
          sendError(res, 404, "Feeding center was not found.");
          return;
        }

        return;
      }

      if (pathname.startsWith("/api/nutrition/centers/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/centers/");
        const center = id ? await database.deleteNutritionCenter(id) : null;

        if (!center) {
          sendError(res, 404, "Feeding center was not found.");
          return;
        }

        clearResponseCache();
        sendJson(res, 200, { center });
        return;
      }

      if (pathname === "/api/nutrition/beneficiaries" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          beneficiaries: await database.listNutritionBeneficiaries({
            search: url.searchParams.get("search") || "",
            centerId: url.searchParams.get("centerId") || "",
            limit: url.searchParams.get("limit") || 200,
            offset: url.searchParams.get("offset") || 0
          }),
          total: typeof database.countNutritionBeneficiaries === "function"
            ? await database.countNutritionBeneficiaries({
              search: url.searchParams.get("search") || "",
              centerId: url.searchParams.get("centerId") || ""
            })
            : 0
        }));
        return;
      }

      if (pathname === "/api/nutrition/beneficiaries" && req.method === "POST") {
        const payload = await readJsonBody(req);
        clearResponseCache();
        sendJson(res, 200, { beneficiary: await database.saveNutritionBeneficiary(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/beneficiaries/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/beneficiaries/");
        const beneficiary = id ? await sendRecordFromCache(req, res, url, () => database.getNutritionBeneficiary(id), "beneficiary") : null;

        if (!beneficiary) {
          sendError(res, 404, "Nutrition beneficiary was not found.");
          return;
        }

        return;
      }

      if (pathname.startsWith("/api/nutrition/beneficiaries/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/beneficiaries/");
        const beneficiary = id ? await database.deleteNutritionBeneficiary(id) : null;

        if (!beneficiary) {
          sendError(res, 404, "Nutrition beneficiary was not found.");
          return;
        }

        clearResponseCache();
        sendJson(res, 200, { beneficiary });
        return;
      }

      if (pathname === "/api/bin" && req.method === "GET") {
        await sendCachedJson(res, cacheKey(req, url), SHORT_CACHE_MS, async () => ({
          records: await database.listDeletedRecords({
            limit: url.searchParams.get("limit") || 100,
            offset: url.searchParams.get("offset") || 0
          }),
          total: typeof database.countDeletedRecords === "function" ? await database.countDeletedRecords() : 0
        }));
        return;
      }

      if (pathname.startsWith("/api/bin/") && pathname.endsWith("/restore") && req.method === "POST") {
        const id = recordIdFromPath(pathname, "/api/bin/");
        clearResponseCache();
        sendJson(res, 200, { record: await database.restoreDeletedRecord(id) });
        return;
      }

      if (pathname === "/api/export" && req.method === "GET") {
        sendJson(res, 200, await database.exportData());
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendError(res, 404, "API endpoint was not found.");
        return;
      }

      sendStatic(req, res);
    } catch (error) {
      const statusCode = statusCodeForError(error);
      sendError(
        res,
        statusCode,
        statusCode === 503 ? databaseConnectionMessage(error) : error?.message || "Unexpected server error."
      );
    }
  });

  server.setDatabase = nextDatabase => {
    database = nextDatabase;
    databaseError = null;
  };

  server.setDatabaseError = error => {
    databaseError = error;
  };

  return server;
}

function openBrowser(url) {
  if (process.env.NO_OPEN === "1" || process.argv.includes("--no-open")) return;

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
  }
}

async function main() {
  let activeDatabase = null;
  let startupError = null;
  let connectPromise = null;

  async function connectDatabase() {
    if (activeDatabase) return activeDatabase;
    if (connectPromise) return connectPromise;

    connectPromise = createDatabase()
      .then(async database => {
        await database.warmup?.();
        activeDatabase = database;
        server.setDatabase(database);
        console.log(`Database: ${activeDatabase.dbPath}`);
        return activeDatabase;
      })
      .catch(error => {
        startupError = error;
        server.setDatabaseError(error);
        console.error(error?.stack || error?.message || error);
        throw error;
      })
      .finally(() => {
        connectPromise = null;
      });

    return connectPromise;
  }

  const server = createServer(activeDatabase, startupError, connectDatabase);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`PAOFI Database is running at ${url}`);
    console.log("Database: Connecting");
    openBrowser(url);
    connectDatabase().catch(() => {});
  });

  process.on("SIGINT", () => {
    Promise.resolve(activeDatabase?.close?.()).finally(() => {
      server.close(() => process.exit(0));
    });
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  createServer
};
