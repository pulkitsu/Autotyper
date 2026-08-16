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
  getMacros({ search = "", folder = "", tag = "" } = {}) {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (folder) query.set("folder", folder);
    if (tag) query.set("tag", tag);
    const suffix = query.size ? `?${query}` : "";
    return request(`/macros${suffix}`);
  },
  getMacro(id) {
    return request(`/macros/${id}`);
  },
  createMacro(macro) {
    return request("/macros", { method: "POST", body: JSON.stringify(macro) });
  },
  updateMacro(id, macro) {
    return request(`/macros/${id}`, { method: "PUT", body: JSON.stringify(macro) });
  },
  deleteMacro(id) {
    return request(`/macros/${id}`, { method: "DELETE" });
  },
  getMacroExport() {
    return request("/macros/export");
  },
  importMacros(macros, mode = "merge") {
    return request("/macros/import", { method: "POST", body: JSON.stringify({ macros, mode }) });
  },
  getMacroHistory({ limit, macroId } = {}) {
    const query = new URLSearchParams();
    if (limit) query.set("limit", String(limit));
    if (macroId) query.set("macroId", macroId);
    const suffix = query.size ? `?${query}` : "";
    return request(`/macro-history${suffix}`);
  },
  createMacroHistory(entry) {
    return request("/macro-history", { method: "POST", body: JSON.stringify(entry) });
  },
  clearMacroHistory() {
    return request("/macro-history", { method: "DELETE" });
  },
  getMacroAnalytics() {
    return request("/macro-analytics");
  },
  getMacroSchedules({ macroId } = {}) {
    const suffix = macroId ? `?macroId=${encodeURIComponent(macroId)}` : "";
    return request(`/macro-schedules${suffix}`);
  },
  createMacroSchedule(schedule) {
    return request("/macro-schedules", { method: "POST", body: JSON.stringify(schedule) });
  },
  updateMacroSchedule(id, schedule) {
    return request(`/macro-schedules/${id}`, { method: "PUT", body: JSON.stringify(schedule) });
  },
  deleteMacroSchedule(id) {
    return request(`/macro-schedules/${id}`, { method: "DELETE" });
  },
  triggerMacroSchedule(id, payload = {}) {
    return request(`/macro-schedules/${id}/triggered`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

export { ApiError };
