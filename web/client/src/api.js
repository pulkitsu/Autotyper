class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return undefined;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? payload.error ?? "The request could not be completed.", response.status, payload);
  }
  return payload;
}

export const api = {
  getScripts(search = "") {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    return request(`/scripts${query}`);
  },
  createScript(script) {
    return request("/scripts", { method: "POST", body: JSON.stringify(script) });
  },
  updateScript(id, script) {
    return request(`/scripts/${id}`, { method: "PUT", body: JSON.stringify(script) });
  },
  deleteScript(id) {
    return request(`/scripts/${id}`, { method: "DELETE" });
  },
  getHistory() {
    return request("/history");
  },
  createHistory(entry) {
    return request("/history", { method: "POST", body: JSON.stringify(entry) });
  },
  clearHistory() {
    return request("/history", { method: "DELETE" });
  },
  getExport() {
    return request("/scripts/export");
  },
  importScripts(scripts) {
    return request("/scripts/import", { method: "POST", body: JSON.stringify({ scripts }) });
  },
};

export { ApiError };
