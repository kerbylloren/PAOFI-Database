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

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
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

function createServer(database) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      if (pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true });
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
        sendJson(res, 200, { user: await database.saveUser(payload) });
        return;
      }

      if (pathname.startsWith("/api/") && !requireSession(req, res)) {
        return;
      }

      if (pathname === "/api/metadata" && req.method === "GET") {
        sendJson(res, 200, {
          fields: BENEFICIARY_FIELDS,
          sections: fieldSectionMap()
        });
        return;
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        sendJson(res, 200, await database.stats());
        return;
      }

      if (pathname === "/api/next-control-no" && req.method === "GET") {
        const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
        sendJson(res, 200, { controlNo: await database.nextControlNo(year) });
        return;
      }

      if (pathname === "/api/records" && req.method === "GET") {
        sendJson(res, 200, {
          records: await database.listRecords({
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || 50,
            detail: url.searchParams.get("detail") || "summary"
          })
        });
        return;
      }

      if (pathname === "/api/records" && req.method === "POST") {
        const payload = await readJsonBody(req);
        sendJson(res, 200, { record: await database.saveRecord(payload) });
        return;
      }

      if (pathname.startsWith("/api/records/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/records/");
        const record = id ? await database.getRecord(id) : null;

        if (!record) {
          sendError(res, 404, "Record was not found.");
          return;
        }

        sendJson(res, 200, { record });
        return;
      }

      if (pathname.startsWith("/api/records/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/records/");
        const record = id ? await database.deleteRecord(id) : null;

        if (!record) {
          sendError(res, 404, "Record was not found.");
          return;
        }

        sendJson(res, 200, { record });
        return;
      }

      if (pathname === "/api/monitoring/reports" && req.method === "GET") {
        sendJson(res, 200, {
          reports: await database.listMonitoringReports({
            search: url.searchParams.get("search") || "",
            beneficiaryId: url.searchParams.get("beneficiaryId") || "",
            limit: url.searchParams.get("limit") || 200
          })
        });
        return;
      }

      if (pathname === "/api/monitoring/reports" && req.method === "POST") {
        const payload = await readJsonBody(req);
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
        const report = id ? await database.getMonitoringReport(id) : null;

        if (!report) {
          sendError(res, 404, "Monitoring report was not found.");
          return;
        }

        sendJson(res, 200, { report });
        return;
      }

      if (pathname.startsWith("/api/monitoring/reports/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/monitoring/reports/");
        const report = id ? await database.deleteMonitoringReport(id) : null;

        if (!report) {
          sendError(res, 404, "Monitoring report was not found.");
          return;
        }

        sendJson(res, 200, { report });
        return;
      }

      if (pathname === "/api/nutrition/overview" && req.method === "GET") {
        sendJson(res, 200, await database.nutritionOverview());
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
        sendJson(res, 200, await database.nutritionCgsReference());
        return;
      }

      if (pathname === "/api/nutrition/growth/reports" && req.method === "GET") {
        sendJson(res, 200, {
          reports: await database.listNutritionGrowthReports({
            search: url.searchParams.get("search") || "",
            centerId: url.searchParams.get("centerId") || "",
            limit: url.searchParams.get("limit") || 200
          })
        });
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
        sendJson(res, 200, { report: await database.saveNutritionGrowthReport(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/growth/reports/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/growth/reports/");
        const report = id ? await database.getNutritionGrowthReport(id) : null;

        if (!report) {
          sendError(res, 404, "Growth monitoring report was not found.");
          return;
        }

        sendJson(res, 200, { report });
        return;
      }

      if (pathname.startsWith("/api/nutrition/growth/reports/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/growth/reports/");
        const report = id ? await database.deleteNutritionGrowthReport(id) : null;

        if (!report) {
          sendError(res, 404, "Growth monitoring report was not found.");
          return;
        }

        sendJson(res, 200, { report });
        return;
      }

      if (pathname === "/api/nutrition/centers" && req.method === "GET") {
        sendJson(res, 200, {
          centers: await database.listNutritionCenters({
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || 200
          })
        });
        return;
      }

      if (pathname === "/api/nutrition/centers" && req.method === "POST") {
        const payload = await readJsonBody(req);
        sendJson(res, 200, { center: await database.saveNutritionCenter(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/centers/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/centers/");
        const center = id ? await database.getNutritionCenter(id) : null;

        if (!center) {
          sendError(res, 404, "Feeding center was not found.");
          return;
        }

        sendJson(res, 200, { center });
        return;
      }

      if (pathname.startsWith("/api/nutrition/centers/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/centers/");
        const center = id ? await database.deleteNutritionCenter(id) : null;

        if (!center) {
          sendError(res, 404, "Feeding center was not found.");
          return;
        }

        sendJson(res, 200, { center });
        return;
      }

      if (pathname === "/api/nutrition/beneficiaries" && req.method === "GET") {
        sendJson(res, 200, {
          beneficiaries: await database.listNutritionBeneficiaries({
            search: url.searchParams.get("search") || "",
            centerId: url.searchParams.get("centerId") || "",
            limit: url.searchParams.get("limit") || 200
          })
        });
        return;
      }

      if (pathname === "/api/nutrition/beneficiaries" && req.method === "POST") {
        const payload = await readJsonBody(req);
        sendJson(res, 200, { beneficiary: await database.saveNutritionBeneficiary(payload) });
        return;
      }

      if (pathname.startsWith("/api/nutrition/beneficiaries/") && req.method === "GET") {
        const id = recordIdFromPath(pathname, "/api/nutrition/beneficiaries/");
        const beneficiary = id ? await database.getNutritionBeneficiary(id) : null;

        if (!beneficiary) {
          sendError(res, 404, "Nutrition beneficiary was not found.");
          return;
        }

        sendJson(res, 200, { beneficiary });
        return;
      }

      if (pathname.startsWith("/api/nutrition/beneficiaries/") && req.method === "DELETE") {
        const id = recordIdFromPath(pathname, "/api/nutrition/beneficiaries/");
        const beneficiary = id ? await database.deleteNutritionBeneficiary(id) : null;

        if (!beneficiary) {
          sendError(res, 404, "Nutrition beneficiary was not found.");
          return;
        }

        sendJson(res, 200, { beneficiary });
        return;
      }

      if (pathname === "/api/bin" && req.method === "GET") {
        sendJson(res, 200, { records: await database.listDeletedRecords() });
        return;
      }

      if (pathname.startsWith("/api/bin/") && pathname.endsWith("/restore") && req.method === "POST") {
        const id = recordIdFromPath(pathname, "/api/bin/");
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
      sendError(res, 500, error.message || "Unexpected server error.");
    }
  });
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
  const database = await createDatabase();
  const server = createServer(database);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`PAOFI Database is running at ${url}`);
    console.log(`Database: ${database.dbPath}`);
    openBrowser(url);
  });

  process.on("SIGINT", () => {
    Promise.resolve(database.close()).finally(() => {
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
