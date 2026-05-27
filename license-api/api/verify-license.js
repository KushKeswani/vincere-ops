const VALID_STATUSES = new Set(["active", "trialing", "completed"]);
const RESET_LICENSE_HELP_URL =
  "https://whop.com/joined/vincere-trading/tech-tutorials-please-watch-h4jL5pEVhsauxq/app/courses/cors_4CWAX5KDSF1rU/lessons/lesn_5KW4rCC5e2Ohn/";

function sendJson(res, statusCode, payload) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.status(statusCode).json(payload);
}

function readString(obj, ...path) {
  let current = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

function normalizeWhopMembership(body) {
  const root = body && typeof body === "object" && body.data && typeof body.data === "object"
    ? body.data
    : body;

  return {
    status: readString(root, "status"),
    membershipId: readString(root, "id"),
    productId: readString(root, "product", "id") || readString(root, "product_id"),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return sendJson(res, 405, { ok: false, message: "Use POST." });
  }

  const whopApiKey = process.env.WHOP_API_KEY;
  if (!whopApiKey) {
    return sendJson(res, 500, { ok: false, message: "License server is not configured." });
  }

  const licenseKey = String(req.body?.licenseKey || "").trim();
  if (!licenseKey) {
    return sendJson(res, 400, {
      ok: false,
      message: `License key is required. If the license key is invalid, reset it here: ${RESET_LICENSE_HELP_URL}`,
    });
  }

  const whopApiBaseUrl = (process.env.WHOP_API_BASE_URL || "https://api.whop.com/api/v1").replace(/\/+$/, "");
  const requiredProductId = process.env.WHOP_REQUIRED_PRODUCT_ID;
  const url = `${whopApiBaseUrl}/memberships/${encodeURIComponent(licenseKey)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${whopApiKey}`,
      },
    });

    if (response.status === 404) {
      return sendJson(res, 404, {
        ok: false,
        message: "License key was not found in Whop.",
      });
    }

    if (!response.ok) {
      return sendJson(res, 502, {
        ok: false,
        message: `Whop verification failed (${response.status}).`,
      });
    }

    const body = await response.json();
    const membership = normalizeWhopMembership(body);

    if (requiredProductId && membership.productId !== requiredProductId) {
      return sendJson(res, 403, {
        ok: false,
        message: "License key is not for the configured Whop product.",
        status: membership.status,
        membershipId: membership.membershipId,
      });
    }

    if (!membership.status || !VALID_STATUSES.has(membership.status.toLowerCase())) {
      return sendJson(res, 403, {
        ok: false,
        message: `Whop membership is not active. Status: ${membership.status || "unknown"}.`,
        status: membership.status,
        membershipId: membership.membershipId,
      });
    }

    return sendJson(res, 200, {
      ok: true,
      message: `License verified (${membership.status}).`,
      status: membership.status,
      membershipId: membership.membershipId,
    });
  } catch (error) {
    console.error("Whop license verification failed", error);
    return sendJson(res, 502, { ok: false, message: "Could not verify license with Whop." });
  }
};
