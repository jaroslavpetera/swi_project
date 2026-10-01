const api = {
  async get(url) {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, body: await res.json() };
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  },
};

let users = [];
let resources = [];
let menuItems = [];
let reservations = [];

function fillSelect(select, items, labelFn) {
  const previous = select.value;
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = labelFn(item);
    select.appendChild(option);
  }
  if ([...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

async function loadUsers() {
  const { body } = await api.get("/users");
  users = body;
  document.getElementById("user-list").innerHTML = users
    .map((u) => `<li>${u.name} — ${u.email} <code>${u.id}</code></li>`)
    .join("");
  fillSelect(document.getElementById("reservation-user"), users, (u) => `${u.name} (${u.email})`);
}

async function loadResources() {
  const { body } = await api.get("/resources");
  resources = body;
  document.getElementById("resource-list").innerHTML = resources
    .map((r) => `<li>${r.name} — kapacita ${r.capacity} <code>${r.id}</code></li>`)
    .join("");
  const labelFn = (r) => `${r.name} (kap. ${r.capacity})${r.requiresApproval ? " — schválení" : ""}`;
  fillSelect(document.getElementById("reservation-resource"), resources, labelFn);
  fillSelect(document.getElementById("availability-resource"), resources, labelFn);
  fillSelect(document.getElementById("reservations-resource"), resources, labelFn);
}

function toIsoOrEmpty(localDatetimeValue) {
  return localDatetimeValue ? new Date(localDatetimeValue).toISOString() : "";
}

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, body } = await api.post("/users", {
    name: form.get("name"),
    email: form.get("email"),
  });
  if (ok) {
    e.target.reset();
    await loadUsers();
  } else {
    alert("Chyba: " + JSON.stringify(body));
  }
});

document.getElementById("resource-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, body } = await api.post("/resources", {
    name: form.get("name"),
    capacity: Number(form.get("capacity")),
    requiresApproval: form.has("requiresApproval"),
  });
  if (ok) {
    e.target.reset();
    await loadResources();
  } else {
    alert("Chyba: " + JSON.stringify(body));
  }
});

document.getElementById("reservation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, status, body } = await api.post("/reservations", {
    resourceId: form.get("resourceId"),
    userId: form.get("userId"),
    startsAt: toIsoOrEmpty(form.get("startsAt")),
    endsAt: toIsoOrEmpty(form.get("endsAt")),
  });
  document.getElementById("reservation-result").textContent = `HTTP ${status}\n${JSON.stringify(body, null, 2)}`;
  if (ok) await loadReservations();
});

document.getElementById("availability-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const resourceId = form.get("resourceId");
  const start = toIsoOrEmpty(form.get("start"));
  const end = toIsoOrEmpty(form.get("end"));
  const { status, body } = await api.get(
    `/resources/${resourceId}/availability?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
  document.getElementById("availability-result").textContent = `HTTP ${status}\n${JSON.stringify(body, null, 2)}`;
});

async function loadReservations() {
  const resourceId = document.getElementById("reservations-resource").value;
  if (!resourceId) return;
  const { body } = await api.get(`/resources/${resourceId}/reservations`);
  reservations = body;
  fillSelect(
    document.getElementById("order-reservation"),
    reservations,
    (r) => `${new Date(r.startsAt).toLocaleString()} – ${r.state}`
  );
  const tbody = document.querySelector("#reservation-table tbody");
  tbody.innerHTML = body
    .map(
      (r) => `
      <tr>
        <td>${new Date(r.startsAt).toLocaleString()}</td>
        <td>${new Date(r.endsAt).toLocaleString()}</td>
        <td class="state-${r.state}">${r.state}</td>
        <td>
          <button data-action="confirm" data-id="${r.id}" ${r.state !== "DRAFT" ? "disabled" : ""}>Confirm</button>
          <button data-action="approve" data-id="${r.id}" ${r.state !== "PENDING_APPROVAL" ? "disabled" : ""}>Approve</button>
          <button data-action="reject" data-id="${r.id}" ${r.state !== "PENDING_APPROVAL" ? "disabled" : ""}>Reject</button>
          <button data-action="cancel" data-id="${r.id}" ${!["DRAFT", "CONFIRMED", "PENDING_APPROVAL"].includes(r.state) || Date.now() >= new Date(r.startsAt).getTime() ? "disabled" : ""}>Cancel</button>
        </td>
      </tr>`
    )
    .join("");
}

document.querySelector("#reservation-table tbody").addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const { ok, status, body } = await api.post(`/reservations/${id}/${action}`, {});
  document.getElementById("reservation-action-result").textContent = `HTTP ${status}\n${JSON.stringify(body, null, 2)}`;
  if (!ok) alert("Chyba: " + JSON.stringify(body));
  await loadReservations();
});

document.getElementById("refresh-reservations").addEventListener("click", loadReservations);
document.getElementById("reservations-resource").addEventListener("change", loadReservations);

// --- Objednávky jídla a pití (OP-06) ---

function formatCzk(cents) {
  return (cents / 100).toLocaleString("cs-CZ", { style: "currency", currency: "CZK" });
}

async function loadMenu() {
  const { body } = await api.get("/menu-items");
  menuItems = body;
  document.getElementById("menu-list").innerHTML = menuItems
    .map(
      (item) => `
      <label class="menu-row ${item.available ? "" : "sold-out"}">
        <span>${item.name} — ${formatCzk(item.priceCents)}</span>
        <input type="number" min="0" value="0" data-menu-item="${item.id}" ${item.available ? "" : "disabled"} />
      </label>`
    )
    .join("");
}

function selectedOrderLines() {
  return [...document.querySelectorAll("#menu-list input[data-menu-item]")]
    .map((input) => ({ menuItemId: input.dataset.menuItem, quantity: Number(input.value) }))
    .filter((line) => line.quantity > 0);
}

document.getElementById("place-order").addEventListener("click", async () => {
  const reservationId = document.getElementById("order-reservation").value;
  if (!reservationId) return;
  const { status, body } = await api.post(`/reservations/${reservationId}/orders`, {
    items: selectedOrderLines(),
  });
  document.getElementById("order-result").textContent = `HTTP ${status}
${JSON.stringify(body, null, 2)}`;
  if (status === 201) {
    document.querySelectorAll("#menu-list input[data-menu-item]").forEach((i) => (i.value = 0));
    await loadTab();
  }
});

async function loadTab() {
  const reservationId = document.getElementById("order-reservation").value;
  if (!reservationId) return;
  const { status, body } = await api.get(`/reservations/${reservationId}/tab`);
  const tbody = document.querySelector("#tab-table tbody");
  if (status !== 200) {
    tbody.innerHTML = "";
    document.getElementById("tab-summary").textContent = `HTTP ${status}
${JSON.stringify(body, null, 2)}`;
    return;
  }
  tbody.innerHTML = body.orders
    .map(
      (order) => `
      <tr>
        <td><code>${order.id.slice(0, 8)}</code></td>
        <td>${order.lines.map((l) => `${l.quantity}× ${l.name}`).join("<br/>")}</td>
        <td>${formatCzk(order.totalCents)}</td>
        <td class="state-${order.state}">${order.state}</td>
        <td>
          <button data-order-action="serve" data-id="${order.id}" ${order.state !== "PLACED" ? "disabled" : ""}>Podáno</button>
          <button data-order-action="pay" data-id="${order.id}" ${order.state !== "SERVED" ? "disabled" : ""}>Zaplaceno</button>
        </td>
      </tr>`
    )
    .join("");
  document.getElementById("tab-summary").textContent =
    `Nezaplaceno: ${formatCzk(body.unpaidCents)} · zaplaceno: ${formatCzk(body.paidCents)} · celkem: ${formatCzk(body.totalCents)}`;
}

document.querySelector("#tab-table tbody").addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-order-action]");
  if (!button) return;
  const { orderAction, id } = button.dataset;
  const { status, body } = await api.post(`/orders/${id}/${orderAction}`, {});
  if (status !== 200) {
    document.getElementById("order-result").textContent = `HTTP ${status}
${JSON.stringify(body, null, 2)}`;
  }
  await loadTab();
});

document.getElementById("refresh-tab").addEventListener("click", loadTab);
document.getElementById("order-reservation").addEventListener("change", loadTab);

(async function init() {
  await Promise.all([loadUsers(), loadResources(), loadMenu()]);
})();
